/**
 * Tests e2e de entradas, código rotativo y transferencias (invariante 3).
 * La verificación usa `verificarToken` de @ticketing/shared: la MISMA función que corre
 * offline en el escáner. Las credenciales las firma la API con node:crypto y se
 * verifican con @noble/curves: también se prueba que ambas implementaciones coinciden.
 */
import {
  codificarCredencial,
  generarToken,
  type MaterialQr,
  nuevoParDispositivo,
  type Revocacion,
  verificarToken,
} from '@ticketing/shared';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  comprarEntrada,
  crearZona,
  type Ctx,
  iniciar,
  login,
  STAFF_DEL_ORGANIZADOR,
  usuario,
} from './ayudantes';

let ctx: Ctx;
let llaveServidor: string;
let staff: string;

beforeAll(async () => {
  ctx = await iniciar();
  llaveServidor = (await ctx.http.get('/v1/escaner/llave').expect(200)).body.llave_publica;
  staff = await login(ctx, STAFF_DEL_ORGANIZADOR.email, STAFF_DEL_ORGANIZADOR.password);
});
afterAll(async () => {
  await ctx.app.close();
});

const ahora = () => Math.floor(Date.now() / 1000);

/** Evento nuevo con una entrada comprada por un asistente nuevo, y el staff asignado. */
async function escenario() {
  const { zona, evento } = await crearZona(ctx, 50);
  await ctx.pool.query('INSERT INTO asignaciones_staff (evento_id, staff_id) VALUES ($1, $2)', [evento, STAFF_DEL_ORGANIZADOR.id]);
  const duenio = await usuario(ctx);
  const entrada = await comprarEntrada(ctx, duenio.auth, zona);
  return { zona, evento, duenio, entrada };
}

function material(auth: string, entrada: string, pubkey: string) {
  return ctx.http.post(`/v1/entradas/${entrada}/material`).set('authorization', auth).send({ dispositivo_pubkey: pubkey });
}

/** Lo que hace el escáner al sincronizar: baja las revocaciones y arma su mapa local. */
async function sincronizarRevocaciones(evento: string): Promise<(id: string) => Revocacion | undefined> {
  const r = await ctx.http.get(`/v1/escaner/eventos/${evento}/revocaciones?desde=0`).set('authorization', staff).expect(200);
  const mapa = new Map<string, Revocacion>();
  for (const it of r.body.items as { entrada_id: string; tipo: string; version_minima: number | null }[]) {
    const prev = mapa.get(it.entrada_id) ?? { anulada: false, versionMinima: 1 };
    if (it.tipo === 'entrada') prev.anulada = true;
    else prev.versionMinima = Math.max(prev.versionMinima, it.version_minima!);
    mapa.set(it.entrada_id, prev);
  }
  return (id) => mapa.get(id);
}

const verificar = (token: string, evento: string, extra: object = {}) =>
  verificarToken(token, { llavePublicaServidor: llaveServidor, eventoId: evento, ahora: ahora(), ...extra });

// ---------------------------------------------------------------------------------------

describe('Billetera', () => {
  it('el titular ve su entrada; otro usuario no la ve ni puede pedir su material', async () => {
    const { entrada, duenio } = await escenario();
    const otro = await usuario(ctx);

    const mia = await ctx.http.get('/v1/me/entradas').set('authorization', duenio.auth).expect(200);
    expect(mia.body.items.map((e: { id: string }) => e.id)).toContain(entrada);
    const ajena = await ctx.http.get('/v1/me/entradas').set('authorization', otro.auth).expect(200);
    expect(ajena.body.items).toHaveLength(0);

    await material(otro.auth, entrada, nuevoParDispositivo().publica).expect(404);
  });
});

describe('Invariante 3: código firmado y rotativo, verificado offline', () => {
  it('un código recién generado por el dispositivo vinculado es válido', async () => {
    const { entrada, evento, duenio, zona } = await escenario();
    const tel = nuevoParDispositivo();
    const m = (await material(duenio.auth, entrada, tel.publica).expect(200)).body as MaterialQr & { rotacion_segundos: number };
    expect(m.rotacion_segundos).toBe(15);

    const r = verificar(generarToken(m, tel.privada, ahora()), evento, { zonas: [zona] });
    expect(r).toMatchObject({ ok: true, credencial: { e: entrada, ev: evento, z: zona, ver: 1 } });
  });

  it('captura de pantalla de hace 1 minuto: se rechaza como expirado', async () => {
    const { entrada, evento, duenio } = await escenario();
    const tel = nuevoParDispositivo();
    const m = (await material(duenio.auth, entrada, tel.publica).expect(200)).body;

    const captura = generarToken(m, tel.privada, ahora() - 60);
    expect(verificar(captura, evento)).toMatchObject({ ok: false, motivo: 'expirado' });
    // Dentro de la ventana (rotó hace 15 s) sigue valiendo.
    expect(verificar(generarToken(m, tel.privada, ahora() - 15), evento).ok).toBe(true);
  });

  it('credencial copiada a otro teléfono: sin la llave del dispositivo vinculado, firma inválida', async () => {
    const { entrada, evento, duenio } = await escenario();
    const original = nuevoParDispositivo();
    const m = (await material(duenio.auth, entrada, original.publica).expect(200)).body;

    const copia = generarToken(m, nuevoParDispositivo().privada, ahora());
    expect(verificar(copia, evento)).toMatchObject({ ok: false, motivo: 'firma_invalida' });
  });

  it('credencial alterada o falsificada: firma inválida', async () => {
    const { entrada, evento, duenio } = await escenario();
    const tel = nuevoParDispositivo();
    const m = (await material(duenio.auth, entrada, tel.publica).expect(200)).body as MaterialQr;

    // Alterar la zona manteniendo la firma original del servidor.
    const cred = JSON.parse(Buffer.from(m.credencial, 'base64url').toString());
    const alterada = { ...m, credencial: codificarCredencial({ ...cred, z: '999' }) };
    expect(verificar(generarToken(alterada, tel.privada, ahora()), evento)).toMatchObject({ ok: false, motivo: 'firma_invalida' });

    // Credencial "emitida" con una llave que no es la del servidor.
    const falsa = generateKeyPairSync('ed25519').privateKey;
    const credFalsa = codificarCredencial({ ...cred, e: '1' });
    const firmaFalsa = sign(null, Buffer.from(`tkt-cred-v1|${credFalsa}`), falsa).toString('base64url');
    const tokenFalso = generarToken({ credencial: credFalsa, firma_servidor: firmaFalsa }, tel.privada, ahora());
    expect(verificar(tokenFalso, evento)).toMatchObject({ ok: false, motivo: 'firma_invalida' });
  });

  it('otro evento u otra zona: se rechaza', async () => {
    const { entrada, evento, duenio, zona } = await escenario();
    const tel = nuevoParDispositivo();
    const m = (await material(duenio.auth, entrada, tel.publica).expect(200)).body;
    const token = generarToken(m, tel.privada, ahora());

    expect(verificar(token, '999999')).toMatchObject({ ok: false, motivo: 'otro_evento' });
    expect(verificar(token, evento, { zonas: [`${zona}0`] })).toMatchObject({ ok: false, motivo: 'otra_zona' });
  });

  it('cambiar de teléfono sube la versión y revoca el código del teléfono anterior', async () => {
    const { entrada, evento, duenio } = await escenario();
    const viejo = nuevoParDispositivo();
    const nuevo = nuevoParDispositivo();
    const m1 = (await material(duenio.auth, entrada, viejo.publica).expect(200)).body;
    const m2 = (await material(duenio.auth, entrada, nuevo.publica).expect(200)).body;
    expect(m2.version).toBe(2);

    const revocacion = await sincronizarRevocaciones(evento);
    expect(verificar(generarToken(m1, viejo.privada, ahora()), evento, { revocacion })).toMatchObject({ ok: false, motivo: 'revocada' });
    expect(verificar(generarToken(m2, nuevo.privada, ahora()), evento, { revocacion }).ok).toBe(true);
  });
});

describe('Transferencias', () => {
  it('al aceptar, el código del dueño anterior deja de servir y el nuevo dueño tiene el suyo', async () => {
    const { entrada, evento, duenio } = await escenario();
    const destino = await usuario(ctx);
    const telA = nuevoParDispositivo();
    const mA = (await material(duenio.auth, entrada, telA.publica).expect(200)).body;
    const codigoAnterior = generarToken(mA, telA.privada, ahora());

    const t = await ctx.http.post(`/v1/entradas/${entrada}/transferencias`).set('authorization', duenio.auth)
      .send({ email: destino.email.toUpperCase() }).expect(201);
    expect(t.body.estado).toBe('pendiente');
    // Mientras está pendiente, el dueño sigue siendo el original.
    expect(verificar(codigoAnterior, evento, { revocacion: await sincronizarRevocaciones(evento) }).ok).toBe(true);

    const a = await ctx.http.post(`/v1/transferencias/${t.body.id}/aceptar`).set('authorization', destino.auth).expect(200);
    expect(a.body).toMatchObject({ estado: 'aceptada', version: 2 });

    const revocacion = await sincronizarRevocaciones(evento);
    expect(verificar(codigoAnterior, evento, { revocacion })).toMatchObject({ ok: false, motivo: 'revocada' });

    // El dueño anterior ya no puede pedir material; el nuevo sí, y su código vale.
    await material(duenio.auth, entrada, telA.publica).expect(404);
    const telB = nuevoParDispositivo();
    const mB = (await material(destino.auth, entrada, telB.publica).expect(200)).body;
    expect(verificar(generarToken(mB, telB.privada, ahora()), evento, { revocacion })).toMatchObject({ ok: true, credencial: { ver: 2 } });

    const billetera = await ctx.http.get('/v1/me/entradas').set('authorization', destino.auth).expect(200);
    expect(billetera.body.items[0]).toMatchObject({ id: entrada, estado: 'transferida', recibida_por_transferencia: true });
  });

  it('reglas: una sola pendiente, cancelable, rechazable, no a sí mismo, solo a asistentes registrados', async () => {
    const { entrada, duenio } = await escenario();
    const destino = await usuario(ctx);
    const transferir = (email: string) =>
      ctx.http.post(`/v1/entradas/${entrada}/transferencias`).set('authorization', duenio.auth).send({ email });

    const t1 = await transferir(destino.email).expect(201);
    expect((await transferir(destino.email).expect(409)).body.error.codigo).toBe('transferencia_pendiente');

    // El emisor cancela; ya se puede transferir de nuevo. El destinatario no puede aceptar una cancelada.
    await ctx.http.post(`/v1/transferencias/${t1.body.id}/cancelar`).set('authorization', duenio.auth).expect(200);
    await ctx.http.post(`/v1/transferencias/${t1.body.id}/aceptar`).set('authorization', destino.auth).expect(409);
    const t2 = await transferir(destino.email).expect(201);
    await ctx.http.post(`/v1/transferencias/${t2.body.id}/rechazar`).set('authorization', destino.auth).expect(200);

    expect((await transferir(duenio.email).expect(409)).body.error.codigo).toBe('transferencia_a_si_mismo');
    expect((await transferir('nadie@correo.test').expect(404)).body.error.codigo).toBe('destinatario_no_encontrado');
    await transferir(STAFF_DEL_ORGANIZADOR.email).expect(404);
    // Un tercero no puede aceptar una transferencia que no es para él.
    const t3 = await transferir(destino.email).expect(201);
    await ctx.http.post(`/v1/transferencias/${t3.body.id}/aceptar`).set('authorization', duenio.auth).expect(404);
  });

  it('no se puede transferir una entrada usada ni pedir su código', async () => {
    const { entrada, duenio } = await escenario();
    const destino = await usuario(ctx);
    await ctx.pool.query(`UPDATE entradas SET estado = 'usada', usada_en = now() WHERE id = $1`, [entrada]);

    const r = await ctx.http.post(`/v1/entradas/${entrada}/transferencias`).set('authorization', duenio.auth)
      .send({ email: destino.email }).expect(409);
    expect(r.body.error.codigo).toBe('entrada_usada');
    await material(duenio.auth, entrada, nuevoParDispositivo().publica).expect(409);
  });
});

describe('Revocaciones del escáner', () => {
  it('solo staff asignado (u organizador/admin); el cursor devuelve solo lo nuevo', async () => {
    const { entrada, evento, duenio } = await escenario();
    await material(duenio.auth, entrada, nuevoParDispositivo().publica).expect(200);
    await material(duenio.auth, entrada, nuevoParDispositivo().publica).expect(200); // revoca v1

    await ctx.http.get(`/v1/escaner/eventos/${evento}/revocaciones`).set('authorization', duenio.auth).expect(403);
    const otroStaff = await login(ctx, 'staff12@ticketing.test', 'Staff2026!');
    await ctx.http.get(`/v1/escaner/eventos/${evento}/revocaciones`).set('authorization', otroStaff).expect(404);

    const r1 = await ctx.http.get(`/v1/escaner/eventos/${evento}/revocaciones?desde=0`).set('authorization', staff).expect(200);
    expect(r1.body.items).toHaveLength(1);
    const r2 = await ctx.http.get(`/v1/escaner/eventos/${evento}/revocaciones?desde=${r1.body.cursor}`).set('authorization', staff).expect(200);
    expect(r2.body).toMatchObject({ items: [], cursor: r1.body.cursor, hay_mas: false });
  });
});
