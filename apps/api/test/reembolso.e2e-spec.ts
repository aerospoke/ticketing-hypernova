/**
 * Tests e2e de reembolsos y anulaciones.
 * Reglas: hasta la fecha límite (asistente), nunca si la entrada se usó, el cupo vuelve a
 * la venta, el dinero se devuelve una sola vez, y las acciones administrativas quedan
 * con motivo y autor en la auditoría inmutable.
 */
import { generarToken, nuevoParDispositivo, verificarToken } from '@ticketing/shared';
import {
  clave,
  comprarEntrada,
  crearZona,
  type Ctx,
  iniciar,
  login,
  ORGANIZADOR,
  PRECIO,
  pagar,
  reservar,
  STAFF_DEL_ORGANIZADOR,
  usuario,
} from './ayudantes';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await iniciar();
});
afterAll(async () => {
  await ctx.app.close();
});

const reembolsar = (auth: string, entrada: string, k = clave('reemb')) =>
  ctx.http.post(`/v1/entradas/${entrada}/reembolso`).set('authorization', auth).set('idempotency-key', k);
const adminAccion = (auth: string, entrada: string, accion: 'reembolso' | 'anular', motivo = 'Evento reprogramado', k = clave('adm')) =>
  ctx.http.post(`/v1/admin/entradas/${entrada}/${accion}`).set('authorization', auth).set('idempotency-key', k).send({ motivo });

async function estado(entrada: string) {
  const { rows } = await ctx.pool.query(
    `SELECT e.estado, z.vendidas, z.reservadas,
            (SELECT usadas FROM cupo_cuenta WHERE usuario_id = e.comprador_id AND evento_id = e.evento_id) AS cupo,
            (SELECT count(*)::int FROM reembolsos WHERE entrada_id = e.id) AS reembolsos,
            (SELECT estado FROM compras WHERE id = e.compra_id) AS compra
       FROM entradas e JOIN zonas z ON z.id = e.zona_id WHERE e.id = $1`,
    [entrada],
  );
  return rows[0];
}

describe('Reembolso por el asistente', () => {
  it('devuelve el dinero una vez, libera el cupo de la zona y de la cuenta, y revoca el código', async () => {
    const { zona, evento } = await crearZona(ctx, 1); // un solo lugar
    const comprador = await usuario(ctx);
    const entrada = await comprarEntrada(ctx, comprador.auth, zona);
    const tel = nuevoParDispositivo();
    const m = (await ctx.http.post(`/v1/entradas/${entrada}/material`).set('authorization', comprador.auth)
      .send({ dispositivo_pubkey: tel.publica }).expect(200)).body;
    expect(await estado(entrada)).toMatchObject({ estado: 'pagada', vendidas: 1, cupo: 1 });

    const r = await reembolsar(comprador.auth, entrada).expect(200);
    expect(r.body).toMatchObject({ estado: 'reembolsada', monto_reembolsado_centesimos: PRECIO });
    expect(await estado(entrada)).toEqual({ estado: 'reembolsada', vendidas: 0, reservadas: 0, cupo: 0, reembolsos: 1, compra: 'reembolsada' });

    // El lugar volvió a la venta: otra persona lo compra.
    const otro = await usuario(ctx);
    await comprarEntrada(ctx, otro.auth, zona);

    // El escáner que sincroniza deja de aceptar el código.
    await ctx.pool.query('INSERT INTO asignaciones_staff (evento_id, staff_id) VALUES ($1, $2)', [evento, STAFF_DEL_ORGANIZADOR.id]);
    const staff = await login(ctx, STAFF_DEL_ORGANIZADOR.email, STAFF_DEL_ORGANIZADOR.password);
    const rev = await ctx.http.get(`/v1/escaner/eventos/${evento}/revocaciones`).set('authorization', staff).expect(200);
    const llave = (await ctx.http.get('/v1/escaner/llave')).body.llave_publica;
    const v = verificarToken(generarToken(m, tel.privada, Math.floor(Date.now() / 1000)), {
      llavePublicaServidor: llave, eventoId: evento, ahora: Math.floor(Date.now() / 1000),
      revocacion: (id) => (rev.body.items.some((x: { entrada_id: string; tipo: string }) => x.entrada_id === id && x.tipo === 'entrada')
        ? { anulada: true, versionMinima: 1 } : undefined),
    });
    expect(v).toMatchObject({ ok: false, motivo: 'revocada' });
  });

  it('caso 7: una entrada ya usada no se reembolsa', async () => {
    const { zona } = await crearZona(ctx, 10);
    const u = await usuario(ctx);
    const entrada = await comprarEntrada(ctx, u.auth, zona);
    await ctx.pool.query(`UPDATE entradas SET estado = 'usada', usada_en = now() WHERE id = $1`, [entrada]);

    const r = await reembolsar(u.auth, entrada).expect(409);
    expect(r.body.error.codigo).toBe('entrada_usada');
    // Tampoco por administración.
    const org = await login(ctx, 'org.istmo@ticketing.test', 'Organizador2026!');
    expect((await adminAccion(org, entrada, 'reembolso').expect(409)).body.error.codigo).toBe('entrada_usada');
    expect(await estado(entrada)).toMatchObject({ estado: 'usada', vendidas: 1, reembolsos: 0 });
  });

  it('doble toque: misma clave = un solo reembolso; otra clave = 409 ya reembolsada', async () => {
    const { zona } = await crearZona(ctx, 10);
    const u = await usuario(ctx);
    const entrada = await comprarEntrada(ctx, u.auth, zona);
    const k = clave('reemb-doble');

    const rs = await Promise.all([reembolsar(u.auth, entrada, k), reembolsar(u.auth, entrada, k), reembolsar(u.auth, entrada, k)]);
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    expect((await reembolsar(u.auth, entrada).expect(409)).body.error.codigo).toBe('entrada_reembolsada');
    expect(await estado(entrada)).toMatchObject({ reembolsos: 1, vendidas: 0 });
  });

  it('fuera de plazo: el asistente no puede; el organizador sí, con motivo', async () => {
    const { zona, evento } = await crearZona(ctx, 10);
    const u = await usuario(ctx);
    const entrada = await comprarEntrada(ctx, u.auth, zona);
    await ctx.pool.query(`UPDATE eventos SET reembolsable_hasta = now() - interval '1 minute' WHERE id = $1`, [evento]);

    expect((await reembolsar(u.auth, entrada).expect(409)).body.error.codigo).toBe('fuera_de_plazo');
    const org = await login(ctx, 'org.istmo@ticketing.test', 'Organizador2026!');
    await adminAccion(org, entrada, 'reembolso', 'Cancelación de la zona').expect(200);
  });

  it('solo el comprador que sigue siendo titular; una transferencia pendiente se cancela', async () => {
    const { zona } = await crearZona(ctx, 10);
    const comprador = await usuario(ctx);
    const destino = await usuario(ctx);
    const [e1, e2] = [await comprarEntrada(ctx, comprador.auth, zona), await comprarEntrada(ctx, comprador.auth, zona)];

    // e1 transferida y aceptada: ni el comprador (ya no es titular) ni el nuevo titular (no pagó).
    const t1 = await ctx.http.post(`/v1/entradas/${e1}/transferencias`).set('authorization', comprador.auth).send({ email: destino.email }).expect(201);
    await ctx.http.post(`/v1/transferencias/${t1.body.id}/aceptar`).set('authorization', destino.auth).expect(200);
    await reembolsar(comprador.auth, e1).expect(404);
    expect((await reembolsar(destino.auth, e1).expect(409)).body.error.codigo).toBe('solo_el_comprador');

    // e2 con transferencia pendiente: el reembolso la cancela.
    const t2 = await ctx.http.post(`/v1/entradas/${e2}/transferencias`).set('authorization', comprador.auth).send({ email: destino.email }).expect(201);
    await reembolsar(comprador.auth, e2).expect(200);
    const { rows } = await ctx.pool.query('SELECT estado FROM transferencias WHERE id = $1', [t2.body.id]);
    expect(rows[0].estado).toBe('cancelada');
  });

  it('una compra de 2 entradas queda reembolsada solo cuando se reembolsan las dos', async () => {
    const { zona } = await crearZona(ctx, 10);
    const u = await usuario(ctx);
    const r = await reservar(ctx, u.auth, zona, 2).expect(201);
    const p = await pagar(ctx, u.auth, r.body.id).expect(201);
    const [a, b] = p.body.entradas.map((e: { id: string }) => e.id);

    await reembolsar(u.auth, a).expect(200);
    expect((await estado(a)).compra).toBe('pagada');
    await reembolsar(u.auth, b).expect(200);
    expect((await estado(b)).compra).toBe('reembolsada');

    const hist = await ctx.http.get('/v1/me/compras').set('authorization', u.auth).expect(200);
    expect(hist.body.items[0]).toMatchObject({ id: p.body.id, estado: 'reembolsada', reembolsado_centesimos: 2 * PRECIO });
    expect(hist.body.items[0].entradas.map((e: { estado: string }) => e.estado)).toEqual(['reembolsada', 'reembolsada']);
  });
});

describe('Administración', () => {
  it('reembolso y anulación con motivo y autor, registrados en la auditoría inmutable', async () => {
    const { zona } = await crearZona(ctx, 10);
    const u = await usuario(ctx);
    const [e1, e2] = [await comprarEntrada(ctx, u.auth, zona), await comprarEntrada(ctx, u.auth, zona)];
    const org = await login(ctx, 'org.istmo@ticketing.test', 'Organizador2026!');

    await adminAccion(org, e1, 'reembolso', 'Duplicada por error de caja').expect(200);
    await adminAccion(org, e2, 'anular', 'Compra fraudulenta').expect(200);
    expect(await estado(e1)).toMatchObject({ estado: 'reembolsada', reembolsos: 1 });
    expect(await estado(e2)).toMatchObject({ estado: 'anulada', reembolsos: 0, vendidas: 0 });

    const { rows: reemb } = await ctx.pool.query('SELECT motivo, autor_id FROM reembolsos WHERE entrada_id = $1', [e1]);
    expect(reemb[0]).toEqual({ motivo: 'Duplicada por error de caja', autor_id: ORGANIZADOR });
    const { rows: aud } = await ctx.pool.query(
      `SELECT accion, actor_id, detalle->>'motivo' AS motivo FROM auditoria WHERE entidad = 'entrada' AND entidad_id = ANY($1) ORDER BY id`,
      [[e1, e2]],
    );
    expect(aud).toEqual([
      { accion: 'entrada_reembolsada', actor_id: ORGANIZADOR, motivo: 'Duplicada por error de caja' },
      { accion: 'entrada_anulada', actor_id: ORGANIZADOR, motivo: 'Compra fraudulenta' },
    ]);
    // La auditoría no se puede alterar con el rol de la aplicación.
    await expect(ctx.pool.query(`UPDATE auditoria SET accion = 'x' WHERE entidad_id = $1`, [e1])).rejects.toThrow(/permission denied/);
  });

  it('organizador ajeno: 404; asistente: 403; sin motivo: 400', async () => {
    const { zona } = await crearZona(ctx, 10);
    const u = await usuario(ctx);
    const entrada = await comprarEntrada(ctx, u.auth, zona);
    const ajeno = await login(ctx, 'org.canal@ticketing.test', 'Organizador2026!');
    expect((await adminAccion(ajeno, entrada, 'reembolso').expect(404)).body.error.codigo).toBe('evento_no_encontrado');
    await adminAccion(u.auth, entrada, 'anular').expect(403);
    const org = await login(ctx, 'org.istmo@ticketing.test', 'Organizador2026!');
    await adminAccion(org, entrada, 'anular', '').expect(400);
    expect(await estado(entrada)).toMatchObject({ estado: 'pagada' });
  });
});
