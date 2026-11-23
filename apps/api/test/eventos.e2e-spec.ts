/**
 * Tests e2e de la cartelera pública y la administración de eventos (caso 8: un
 * organizador no puede ver ni modificar eventos ajenos).
 */
import { clave, type Ctx, iniciar, login, pagar, PRECIO, reservar, usuario } from './ayudantes';

let ctx: Ctx;
let istmo: string; // org.istmo (100201)
let canal: string; // org.canal (100202)

beforeAll(async () => {
  ctx = await iniciar();
  istmo = await login(ctx, 'org.istmo@ticketing.test', 'Organizador2026!');
  canal = await login(ctx, 'org.canal@ticketing.test', 'Organizador2026!');
});
afterAll(async () => {
  await ctx.app.close();
});

const dias = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const admin = (auth: string) => ({
  get: (p: string) => ctx.http.get(`/v1/admin${p}`).set('authorization', auth),
  post: (p: string, b: object = {}) => ctx.http.post(`/v1/admin${p}`).set('authorization', auth).send(b),
  patch: (p: string, b: object) => ctx.http.patch(`/v1/admin${p}`).set('authorization', auth).send(b),
  put: (p: string) => ctx.http.put(`/v1/admin${p}`).set('authorization', auth),
});

/** Evento completo creado por org.istmo desde la API del portal. */
async function eventoDeIstmo(estado: 'borrador' | 'publicado' = 'publicado') {
  const a = admin(istmo);
  const ev = await a.post('/eventos', {
    codigo: `P-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, nombre: 'Concierto portal', recinto: 'Teatro',
    fecha: dias(30), venta_abre: dias(-1), reembolsable_hasta: dias(28), limite_por_cuenta: 4, estado,
  }).expect(201);
  const zona = await a.post(`/eventos/${ev.body.id}/zonas`, { nombre: 'Platea', aforo: 10 }).expect(201);
  const fase = await a.post(`/zonas/${zona.body.id}/fases`, { fase: 'general', precio_centesimos: PRECIO, desde: dias(-1), hasta: dias(29) }).expect(201);
  return { evento: ev.body.id as string, zona: zona.body.id as string, fase: fase.body.id as string };
}

describe('Cartelera pública', () => {
  it('muestra disponibilidad por zona y fase vigente; un borrador no es visible', async () => {
    const { evento } = await eventoDeIstmo();
    const d = await ctx.http.get(`/v1/eventos/${evento}`).expect(200);
    expect(d.headers['cache-control']).toBe('public, max-age=1');
    expect(d.body).toMatchObject({ id: evento, estado_venta: 'en_venta' });
    expect(d.body.zonas[0]).toMatchObject({ nombre: 'Platea', aforo: 10, vendidas: 0, disponibles: 10, fase_vigente: { fase: 'general', precio_centesimos: PRECIO } });

    const borrador = await eventoDeIstmo('borrador');
    await ctx.http.get(`/v1/eventos/${borrador.evento}`).expect(404);
  });

  it('paginación por cursor sin repetidos ni saltos', async () => {
    const vistos: string[] = [];
    let cursor: string | null = null;
    do {
      const r: { body: { items: { id: string }[]; siguiente_cursor: string | null } } = await ctx.http.get(`/v1/eventos${cursor ? `?cursor=${cursor}` : ''}`).expect(200);
      vistos.push(...r.body.items.map((e) => e.id));
      cursor = r.body.siguiente_cursor;
    } while (cursor);
    expect(new Set(vistos).size).toBe(vistos.length);
    const { rows } = await ctx.pool.query(`SELECT count(*)::int AS n FROM eventos WHERE estado = 'publicado' AND fecha > now()`);
    expect(vistos.length).toBe(rows[0].n);
    await ctx.http.get('/v1/eventos?cursor=basura').expect(400);
  });

  it('la disponibilidad se cachea a lo sumo ~1 s', async () => {
    const { evento, zona } = await eventoDeIstmo();
    const antes = (await ctx.http.get(`/v1/eventos/${evento}`)).body.zonas[0].disponibles;
    const u = await usuario(ctx);
    await reservar(ctx, u.auth, zona, 2).expect(201);

    const enCache = (await ctx.http.get(`/v1/eventos/${evento}`)).body.zonas[0].disponibles;
    await new Promise((r) => setTimeout(r, 1100));
    const fresco = (await ctx.http.get(`/v1/eventos/${evento}`)).body.zonas[0].disponibles;
    expect(enCache).toBe(antes); // dentro del segundo: dato cacheado
    expect(fresco).toBe(antes - 2); // pasado el segundo: dato real
  });
});

describe('Administración de eventos', () => {
  it('un evento creado en borrador se publica y se puede comprar; todo queda en la auditoría', async () => {
    const { evento, zona } = await eventoDeIstmo('borrador');
    await admin(istmo).post(`/eventos/${evento}/puertas`, { nombre: 'Puerta 1' }).expect(201);
    await admin(istmo).put(`/eventos/${evento}/staff/100301`).expect(200);
    await admin(istmo).patch(`/eventos/${evento}`, { estado: 'publicado' }).expect(200);

    const u = await usuario(ctx);
    await reservar(ctx, u.auth, zona, 1).expect(201);

    const det = await admin(istmo).get(`/eventos/${evento}`).expect(200);
    expect(det.body).toMatchObject({ estado: 'publicado', puertas: [{ nombre: 'Puerta 1' }], staff: [{ id: '100301' }] });
    const { rows } = await ctx.pool.query(
      `SELECT accion FROM auditoria WHERE (entidad = 'evento' AND entidad_id = $1) OR detalle->>'evento_id' = $1 ORDER BY id`,
      [evento],
    );
    expect(rows.map((r) => r.accion)).toEqual(['evento_creado', 'zona_creada', 'puerta_creada', 'staff_asignado', 'evento_actualizado']);
  });

  it('las reglas de la base llegan como errores claros', async () => {
    const { evento, zona } = await eventoDeIstmo();
    const a = admin(istmo);
    const u = await usuario(ctx);
    const r = await reservar(ctx, u.auth, zona, 3).expect(201);
    await pagar(ctx, u.auth, r.body.id).expect(201);

    expect((await a.patch(`/zonas/${zona}`, { aforo: 2 }).expect(409)).body.error.codigo).toBe('aforo_menor_que_ocupado');
    await a.patch(`/zonas/${zona}`, { aforo: 3 }).expect(200); // justo lo vendido: permitido
    expect((await a.post(`/zonas/${zona}/fases`, { fase: 'taquilla', precio_centesimos: 1, desde: dias(5), hasta: dias(6) }).expect(409)).body.error.codigo).toBe('fases_solapadas');
    expect((await a.post(`/eventos/${evento}/zonas`, { nombre: 'Platea', aforo: 5 }).expect(409)).body.error.codigo).toBe('zona_duplicada');
    expect((await a.patch(`/eventos/${evento}`, { venta_abre: dias(40) }).expect(400)).body.error.codigo).toBe('fechas_invalidas');
    expect((await a.put(`/eventos/${evento}/staff/100302`).expect(404)).body.error.codigo).toBe('staff_no_encontrado'); // staff de org.canal
  });

  it('cambiar el precio no afecta una reserva ya hecha (precio congelado)', async () => {
    const { zona, fase } = await eventoDeIstmo();
    const u = await usuario(ctx);
    const r = await reservar(ctx, u.auth, zona, 1).expect(201);
    await admin(istmo).patch(`/fases/${fase}`, { precio_centesimos: PRECIO * 10 }).expect(200);
    const p = await pagar(ctx, u.auth, r.body.id, clave('pago')).expect(201);
    expect(p.body.monto_centesimos).toBe(PRECIO);
  });
});

describe('Caso 8: organizador ajeno', () => {
  it('no ve ni modifica el evento, las zonas, las fases ni el staff de otro organizador', async () => {
    const { evento, zona, fase } = await eventoDeIstmo();
    const ajeno = admin(canal);

    const respuestas = await Promise.all([
      ajeno.get(`/eventos/${evento}`),
      ajeno.patch(`/eventos/${evento}`, { nombre: 'Hackeado', limite_por_cuenta: 100 }),
      ajeno.post(`/eventos/${evento}/zonas`, { nombre: 'Zona pirata', aforo: 1000 }),
      ajeno.patch(`/zonas/${zona}`, { aforo: 10_000 }),
      ajeno.post(`/zonas/${zona}/fases`, { fase: 'preventa', precio_centesimos: 1, desde: dias(-3), hasta: dias(-2) }),
      ajeno.patch(`/fases/${fase}`, { precio_centesimos: 1 }),
      ajeno.post(`/eventos/${evento}/puertas`, { nombre: 'Puerta pirata' }),
      ajeno.put(`/eventos/${evento}/staff/100302`),
    ]);
    expect(respuestas.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404, 404, 404]);

    // Nada cambió.
    const { rows } = await ctx.pool.query(
      `SELECT e.nombre, e.limite_por_cuenta, z.aforo, f.precio_centesimos,
              (SELECT count(*)::int FROM zonas WHERE evento_id = e.id) AS zonas,
              (SELECT count(*)::int FROM puertas WHERE evento_id = e.id) AS puertas
         FROM eventos e JOIN zonas z ON z.evento_id = e.id JOIN fases_precio f ON f.zona_id = z.id WHERE e.id = $1`,
      [evento],
    );
    expect(rows[0]).toEqual({ nombre: 'Concierto portal', limite_por_cuenta: 4, aforo: 10, precio_centesimos: PRECIO, zonas: 1, puertas: 0 });
    // Y no aparece en su listado.
    const lista = await ajeno.get('/eventos').expect(200);
    expect(lista.body.map((e: { id: string }) => e.id)).not.toContain(evento);
  });

  it('un asistente no entra al portal; el admin ve y edita todo', async () => {
    const { evento } = await eventoDeIstmo();
    const u = await usuario(ctx);
    await admin(u.auth).get('/eventos').expect(403);
    const adm = await login(ctx, 'admin@ticketing.test', 'Admin2026!');
    await admin(adm).patch(`/eventos/${evento}`, { nombre: 'Editado por admin' }).expect(200);
  });
});
