/** Tests e2e de los reportes del portal: ventas, accesos, búsqueda, auditoría e incidentes. */
import { randomUUID } from 'node:crypto';
import { clave, comprarEntrada, crearZona, type Ctx, iniciar, login, PRECIO, STAFF_DEL_ORGANIZADOR, usuario } from './ayudantes';

let ctx: Ctx;
let istmo: string;
let canal: string;
beforeAll(async () => {
  ctx = await iniciar();
  istmo = await login(ctx, 'org.istmo@ticketing.test', 'Organizador2026!');
  canal = await login(ctx, 'org.canal@ticketing.test', 'Organizador2026!');
});
afterAll(async () => {
  await ctx.app.close();
});

const get = (auth: string, ruta: string) => ctx.http.get(`/v1/admin${ruta}`).set('authorization', auth);

it('ventas por zona: vendidas, disponibles e ingresos netos de reembolsos', async () => {
  const { zona, evento } = await crearZona(ctx, 10);
  const u = await usuario(ctx);
  const [e1] = [await comprarEntrada(ctx, u.auth, zona), await comprarEntrada(ctx, u.auth, zona)];
  await ctx.http.post(`/v1/entradas/${e1}/reembolso`).set('authorization', u.auth).set('idempotency-key', clave('r')).expect(200);

  const r = await get(istmo, `/eventos/${evento}/ventas`).expect(200);
  expect(r.body.zonas[0]).toMatchObject({ aforo: 10, vendidas: 1, reservadas: 0, disponibles: 9, cobrado_centesimos: 2 * PRECIO, reembolsado_centesimos: PRECIO, neto_centesimos: PRECIO });
  expect(r.body.totales).toMatchObject({ vendidas: 1, neto_centesimos: PRECIO });
  await get(canal, `/eventos/${evento}/ventas`).expect(404);
});

it('accesos por puerta y por hora, aforo dentro y dispositivos con su última sincronización', async () => {
  const { zona, evento } = await crearZona(ctx, 10);
  const { rows } = await ctx.pool.query<{ id: string }>(`INSERT INTO puertas (evento_id, nombre) VALUES ($1, 'Norte') RETURNING id`, [evento]);
  await ctx.pool.query('INSERT INTO asignaciones_staff (evento_id, staff_id) VALUES ($1, $2)', [evento, STAFF_DEL_ORGANIZADOR.id]);
  const staff = await login(ctx, STAFF_DEL_ORGANIZADOR.email, STAFF_DEL_ORGANIZADOR.password);
  const disp = randomUUID();
  await ctx.http.post('/v1/escaner/dispositivos').set('authorization', staff).send({ id: disp, nombre: 'Pixel Norte' }).expect(200);
  const t = await ctx.http.post('/v1/escaner/turnos').set('authorization', staff).send({ evento_id: evento, puerta_id: rows[0].id, dispositivo_id: disp }).expect(201);
  const u = await usuario(ctx);
  const entradas = [await comprarEntrada(ctx, u.auth, zona), await comprarEntrada(ctx, u.auth, zona)];
  await ctx.http.post('/v1/escaner/lotes').set('authorization', staff).send({
    dispositivo_id: disp,
    escaneos: entradas.map((e) => ({ client_scan_id: randomUUID(), turno_id: t.body.id, entrada_id: e, version: 1, resultado: 'valido', escaneado_en: new Date().toISOString() })),
  }).expect(200);

  const r = await get(istmo, `/eventos/${evento}/accesos`).expect(200);
  expect(r.body.dentro_del_recinto).toBe(2);
  expect(r.body.por_puerta).toEqual([{ id: rows[0].id, nombre: 'Norte', validos: 2, duplicados: 0, rechazados: 0 }]);
  expect(r.body.por_hora[0].validos).toBe(2);
  expect(r.body.dispositivos[0]).toMatchObject({ nombre: 'Pixel Norte', puerta: 'Norte', turno_abierto: true, escaneos: 2 });
  expect(r.body.dispositivos[0].ultima_sync).not.toBeNull();
  await get(canal, `/eventos/${evento}/accesos`).expect(404);
});

it('buscar entradas por correo del comprador; organizador ajeno no puede', async () => {
  const { zona, evento } = await crearZona(ctx, 10);
  const a = await usuario(ctx);
  const b = await usuario(ctx);
  const ea = await comprarEntrada(ctx, a.auth, zona);
  await comprarEntrada(ctx, b.auth, zona);

  const r = await get(istmo, `/eventos/${evento}/entradas?q=${encodeURIComponent(a.email)}`).expect(200);
  expect(r.body.items.map((e: { id: string }) => e.id)).toEqual([ea]);
  expect(r.body.items[0]).toMatchObject({ comprador_email: a.email, estado: 'pagada' });
  // Por número de entrada (y un correo nunca se confunde con un número).
  expect((await get(istmo, `/eventos/${evento}/entradas?q=${ea}`).expect(200)).body.items.map((e: { id: string }) => e.id)).toEqual([ea]);
  // Los comodines de LIKE del usuario se escapan: "%" no devuelve todo.
  expect((await get(istmo, `/eventos/${evento}/entradas?q=%25`).expect(200)).body.items).toHaveLength(0);
  await get(canal, `/eventos/${evento}/entradas?q=a`).expect(404);
});

it('auditoría: el organizador ve solo sus acciones; el admin, todas', async () => {
  const { zona } = await crearZona(ctx, 10);
  const u = await usuario(ctx);
  const e = await comprarEntrada(ctx, u.auth, zona);
  await ctx.http.post(`/v1/admin/entradas/${e}/anular`).set('authorization', istmo).set('idempotency-key', clave('a')).send({ motivo: 'Prueba de auditoría' }).expect(200);

  const propia = await get(istmo, '/auditoria').expect(200);
  expect(propia.body.items[0]).toMatchObject({ accion: 'entrada_anulada', entidad_id: e, actor_email: 'org.istmo@ticketing.test' });
  expect(propia.body.items.every((x: { actor_email: string }) => x.actor_email === 'org.istmo@ticketing.test')).toBe(true);
  const ajena = await get(canal, '/auditoria').expect(200);
  expect(ajena.body.items.map((x: { entidad_id: string }) => x.entidad_id)).not.toContain(e);
  const adm = await login(ctx, 'admin@ticketing.test', 'Admin2026!');
  expect((await get(adm, '/auditoria').expect(200)).body.items.map((x: { entidad_id: string }) => x.entidad_id)).toContain(e);
});

it('resolver un incidente queda registrado; ajeno 404; dos veces 409', async () => {
  const { zona, evento } = await crearZona(ctx, 10);
  const u = await usuario(ctx);
  const e = await comprarEntrada(ctx, u.auth, zona);
  const { rows } = await ctx.pool.query<{ id: string }>(
    `INSERT INTO incidentes (tipo, evento_id, entrada_id, detalle) VALUES ('firma_invalida', $1, $2, '{}') RETURNING id`,
    [evento, e],
  );
  const resolver = (auth: string) => ctx.http.post(`/v1/admin/incidentes/${rows[0].id}/resolver`).set('authorization', auth).send({ nota: 'Revisado con el staff' });
  await resolver(canal).expect(404);
  await resolver(istmo).expect(200);
  await resolver(istmo).expect(409);
  const inc = await get(istmo, `/eventos/${evento}/incidentes`).expect(200);
  expect(inc.body.items[0]).toMatchObject({ estado: 'resuelto', detalle: { nota_resolucion: 'Revisado con el staff' } });
});
