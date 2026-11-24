/**
 * Tests e2e del ingreso único con escáneres offline (invariante 4).
 *
 * Se simulan dos escáneres en dos puertas: cada uno verifica el código SIN red con
 * `verificarToken` (lo mismo que hará la app), guarda el escaneo con su propio
 * client_scan_id, y después sincroniza el lote con la API.
 */
import { generarToken, nuevoParDispositivo, verificarToken } from '@ticketing/shared';
import { randomUUID } from 'node:crypto';
import { comprarEntrada, crearZona, type Ctx, iniciar, login, STAFF_DEL_ORGANIZADOR, usuario } from './ayudantes';

const STAFF_2 = { id: '100304', email: 'staff4@ticketing.test', password: 'Staff2026!' }; // también de org.istmo

let ctx: Ctx;
let llaveServidor: string;
let staff1: string;
let staff2: string;

beforeAll(async () => {
  ctx = await iniciar();
  llaveServidor = (await ctx.http.get('/v1/escaner/llave').expect(200)).body.llave_publica;
  staff1 = await login(ctx, STAFF_DEL_ORGANIZADOR.email, STAFF_DEL_ORGANIZADOR.password);
  staff2 = await login(ctx, STAFF_2.email, STAFF_2.password);
});
afterAll(async () => {
  await ctx.app.close();
});

interface Escaner {
  auth: string;
  dispositivo: string;
  turno: string;
  /** escaneos guardados localmente mientras no hay red */
  pendientes: object[];
}

/** Evento con dos puertas, cada una con su staff, dispositivo y turno abierto. */
async function prepararEvento() {
  const { zona, evento } = await crearZona(ctx, 100);
  const puertas: string[] = [];
  for (const nombre of ['Puerta Norte', 'Puerta Sur']) {
    const { rows } = await ctx.pool.query<{ id: string }>('INSERT INTO puertas (evento_id, nombre) VALUES ($1, $2) RETURNING id', [evento, nombre]);
    puertas.push(rows[0].id);
  }
  for (const s of [STAFF_DEL_ORGANIZADOR.id, STAFF_2.id]) {
    await ctx.pool.query('INSERT INTO asignaciones_staff (evento_id, staff_id) VALUES ($1, $2)', [evento, s]);
  }
  const escaner = async (auth: string, puerta: string): Promise<Escaner> => {
    const dispositivo = randomUUID();
    await ctx.http.post('/v1/escaner/dispositivos').set('authorization', auth).send({ id: dispositivo, nombre: 'Pixel puerta' }).expect(200);
    const t = await ctx.http.post('/v1/escaner/turnos').set('authorization', auth)
      .send({ evento_id: evento, puerta_id: puerta, dispositivo_id: dispositivo }).expect(201);
    return { auth, dispositivo, turno: t.body.id, pendientes: [] };
  };
  return { zona, evento, norte: await escaner(staff1, puertas[0]), sur: await escaner(staff2, puertas[1]) };
}

/** Un asistente con una entrada y su código rotativo listo para mostrar. */
async function asistenteConEntrada(zona: string) {
  const a = await usuario(ctx);
  const entrada = await comprarEntrada(ctx, a.auth, zona);
  const tel = nuevoParDispositivo();
  const m = (await ctx.http.post(`/v1/entradas/${entrada}/material`).set('authorization', a.auth)
    .send({ dispositivo_pubkey: tel.publica }).expect(200)).body;
  return { entrada, codigo: () => generarToken(m, tel.privada, Math.floor(Date.now() / 1000)) };
}

/** Lo que hace el escáner SIN red: verifica, decide y guarda el escaneo localmente. */
function escanearOffline(e: Escaner, evento: string, token: string, yaVistas = new Set<string>()) {
  const r = verificarToken(token, { llavePublicaServidor: llaveServidor, eventoId: evento, ahora: Math.floor(Date.now() / 1000) });
  let resultado: 'valido' | 'rechazado' = r.ok ? 'valido' : 'rechazado';
  let motivo: string | undefined = r.ok ? undefined : r.motivo;
  if (r.ok && yaVistas.has(r.credencial.e)) {
    resultado = 'rechazado';
    motivo = 'ya_usada'; // rechazo LOCAL del duplicado en el mismo escáner
  }
  if (r.ok) yaVistas.add(r.credencial.e);
  const escaneo = {
    client_scan_id: randomUUID(),
    turno_id: e.turno,
    entrada_id: r.credencial?.e ?? null,
    version: r.credencial?.ver ?? null,
    resultado,
    motivo,
    escaneado_en: new Date().toISOString(),
  };
  e.pendientes.push(escaneo);
  return { resultado, motivo };
}

function sincronizar(e: Escaner, escaneos = e.pendientes) {
  return ctx.http.post('/v1/escaner/lotes').set('authorization', e.auth).send({ dispositivo_id: e.dispositivo, escaneos });
}

async function ingresos(entrada: string) {
  const { rows } = await ctx.pool.query<{ resultado: string; puerta_id: string }>(
    'SELECT resultado, puerta_id FROM ingresos WHERE entrada_id = $1 ORDER BY id',
    [entrada],
  );
  return rows;
}

// ---------------------------------------------------------------------------------------

describe('Invariante 4: una entrada entra una sola vez', () => {
  it('el mismo escáner rechaza localmente, sin red, una entrada que ya escaneó', async () => {
    const { zona, evento, norte } = await prepararEvento();
    const { codigo } = await asistenteConEntrada(zona);
    const vistas = new Set<string>();
    expect(escanearOffline(norte, evento, codigo(), vistas)).toEqual({ resultado: 'valido', motivo: undefined });
    expect(escanearOffline(norte, evento, codigo(), vistas)).toEqual({ resultado: 'rechazado', motivo: 'ya_usada' });
  });

  it('dos puertas offline con la misma entrada: al sincronizar, 1 válido, 1 duplicado y un incidente visible en el portal', async () => {
    const { zona, evento, norte, sur } = await prepararEvento();
    const { entrada, codigo } = await asistenteConEntrada(zona);

    // Sin red, cada puerta ve la entrada por primera vez y la deja pasar.
    expect(escanearOffline(norte, evento, codigo()).resultado).toBe('valido');
    expect(escanearOffline(sur, evento, codigo()).resultado).toBe('valido');

    const rNorte = await sincronizar(norte).expect(200);
    expect(rNorte.body.resultados[0]).toMatchObject({ resultado: 'valido', repetido: false });
    const rSur = await sincronizar(sur).expect(200);
    expect(rSur.body.resultados[0]).toMatchObject({ resultado: 'duplicado_offline', repetido: false });
    expect(rSur.body.resultados[0].incidente_id).toBeDefined();

    // Los dos ingresos quedan registrados: el segundo NO se borra.
    expect((await ingresos(entrada)).map((i) => i.resultado)).toEqual(['valido', 'duplicado_offline']);
    const { rows } = await ctx.pool.query('SELECT estado FROM entradas WHERE id = $1', [entrada]);
    expect(rows[0].estado).toBe('usada');

    // El organizador lo ve en el portal.
    const org = await login(ctx, 'org.istmo@ticketing.test', 'Organizador2026!');
    const inc = await ctx.http.get(`/v1/admin/eventos/${evento}/incidentes`).set('authorization', org).expect(200);
    expect(inc.body.items).toHaveLength(1);
    expect(inc.body.items[0]).toMatchObject({ tipo: 'doble_ingreso', estado: 'abierto', entrada_id: entrada, puerta: 'Puerta Sur' });
    expect(inc.body.items[0].detalle.ingreso_valido.puerta_id).toBeDefined();

    // Cada staff ve sus propias cifras del evento: el de la puerta sur, su doble ingreso.
    const cifras = async (auth: string) =>
      (await ctx.http.get('/v1/escaner/eventos').set('authorization', auth).expect(200)).body.find((e: { id: string }) => e.id === evento).mis_cifras;
    expect(await cifras(norte.auth)).toMatchObject({ validos: 1, rechazos: 0, dobles: 0, incidentes_abiertos: 0 });
    const sur2 = await cifras(sur.auth);
    expect(sur2).toMatchObject({ validos: 0, rechazos: 0, dobles: 1, incidentes_abiertos: 1 });
    expect(sur2.ultimo_escaneo).toBeTruthy();
  });

  it('reenviar el mismo lote no duplica ingresos ni incidentes', async () => {
    const { zona, evento, norte, sur } = await prepararEvento();
    const { entrada, codigo } = await asistenteConEntrada(zona);
    escanearOffline(norte, evento, codigo());
    escanearOffline(sur, evento, codigo());
    await sincronizar(norte).expect(200);
    const primera = await sincronizar(sur).expect(200);

    const otraVez = await Promise.all([sincronizar(norte), sincronizar(sur), sincronizar(sur)]);
    expect(otraVez.map((r) => r.body.resultados[0].repetido)).toEqual([true, true, true]);
    expect(otraVez[1].body.resultados[0]).toMatchObject({ resultado: 'duplicado_offline', incidente_id: primera.body.resultados[0].incidente_id });

    expect(await ingresos(entrada)).toHaveLength(2);
    const { rows } = await ctx.pool.query('SELECT count(*)::int AS n FROM incidentes WHERE entrada_id = $1', [entrada]);
    expect(rows[0].n).toBe(1);
  });

  it('dos puertas sincronizando AL MISMO TIEMPO: exactamente un ingreso válido', async () => {
    const { zona, evento, norte, sur } = await prepararEvento();
    const entradas = await Promise.all(Array.from({ length: 10 }, () => asistenteConEntrada(zona)));
    // Las dos puertas dejaron pasar las 10 entradas.
    for (const e of entradas) {
      escanearOffline(norte, evento, e.codigo());
      escanearOffline(sur, evento, e.codigo());
    }
    await Promise.all([sincronizar(norte).expect(200), sincronizar(sur).expect(200)]);

    for (const e of entradas) {
      const r = (await ingresos(e.entrada)).map((i) => i.resultado).sort();
      expect(r).toEqual(['duplicado_offline', 'valido']);
    }
    const { rows } = await ctx.pool.query(
      `SELECT count(*)::int AS n FROM incidentes WHERE evento_id = $1 AND tipo = 'doble_ingreso'`,
      [evento],
    );
    expect(rows[0].n).toBe(10);
  });

  it('los rechazos locales también se registran; una firma inválida abre un incidente', async () => {
    const { zona, evento, norte } = await prepararEvento();
    const { codigo } = await asistenteConEntrada(zona);
    const partes = codigo().split('.');
    const falsificado = [...partes.slice(0, 4), partes[2]].join('.'); // firma del dispositivo inválida
    expect(escanearOffline(norte, evento, falsificado)).toEqual({ resultado: 'rechazado', motivo: 'firma_invalida' });

    const r = await sincronizar(norte).expect(200);
    expect(r.body.resultados[0]).toMatchObject({ resultado: 'rechazado' });
    const { rows } = await ctx.pool.query(
      `SELECT tipo FROM incidentes WHERE evento_id = $1`,
      [evento],
    );
    expect(rows.map((x) => x.tipo)).toEqual(['firma_invalida']);
  });

  it('una entrada reembolsada que pasó por un escáner sin sincronizar: se registra y se avisa', async () => {
    const { zona, evento, norte } = await prepararEvento();
    const { entrada, codigo } = await asistenteConEntrada(zona);
    // Se reembolsó, pero el escáner todavía no bajó la revocación y la deja pasar.
    escanearOffline(norte, evento, codigo());
    await ctx.pool.query(`UPDATE entradas SET estado = 'reembolsada', anulada_en = now() WHERE id = $1`, [entrada]);

    const r = await sincronizar(norte).expect(200);
    expect(r.body.resultados[0].resultado).toBe('valido');
    const { rows } = await ctx.pool.query('SELECT tipo FROM incidentes WHERE entrada_id = $1', [entrada]);
    expect(rows.map((x) => x.tipo)).toEqual(['escaner_desincronizado']);
    const e = await ctx.pool.query('SELECT estado FROM entradas WHERE id = $1', [entrada]);
    expect(e.rows[0].estado).toBe('reembolsada');
  });
});

describe('Permisos del escáner y del portal', () => {
  it('el staff ve solo los eventos a los que está asignado, con sus puertas', async () => {
    const { evento } = await prepararEvento();
    const r = await ctx.http.get('/v1/escaner/eventos').set('authorization', staff1).expect(200);
    const ev = r.body.find((e: { id: string }) => e.id === evento);
    expect(ev.puertas.map((p: { nombre: string }) => p.nombre)).toEqual(['Puerta Norte', 'Puerta Sur']);
    const ajeno = await login(ctx, 'staff12@ticketing.test', 'Staff2026!');
    const r2 = await ctx.http.get('/v1/escaner/eventos').set('authorization', ajeno).expect(200);
    expect(r2.body.map((e: { id: string }) => e.id)).not.toContain(evento);
  });

  it('turnos, dispositivos y lotes solo con los recursos propios', async () => {
    const { evento, norte } = await prepararEvento();
    // Staff de otro organizador: no está asignado al evento.
    const ajeno = await login(ctx, 'staff12@ticketing.test', 'Staff2026!');
    const disp = randomUUID();
    await ctx.http.post('/v1/escaner/dispositivos').set('authorization', ajeno).send({ id: disp, nombre: 'x' }).expect(200);
    const { rows } = await ctx.pool.query('SELECT puerta_id FROM turnos WHERE id = $1', [norte.turno]);
    await ctx.http.post('/v1/escaner/turnos').set('authorization', ajeno)
      .send({ evento_id: evento, puerta_id: rows[0].puerta_id, dispositivo_id: disp }).expect(404);
    // No puede apropiarse del dispositivo de otro, ni subir lotes con él.
    await ctx.http.post('/v1/escaner/dispositivos').set('authorization', ajeno).send({ id: norte.dispositivo, nombre: 'mío' }).expect(409);
    await ctx.http.post('/v1/escaner/lotes').set('authorization', ajeno).send({
      dispositivo_id: norte.dispositivo,
      escaneos: [{ client_scan_id: randomUUID(), turno_id: norte.turno, entrada_id: null, version: null, resultado: 'rechazado', motivo: 'expirado', escaneado_en: new Date().toISOString() }],
    }).expect(404);
    // Un asistente no usa el modo escáner.
    const asistente = await usuario(ctx);
    await ctx.http.post('/v1/escaner/dispositivos').set('authorization', asistente.auth).send({ id: randomUUID(), nombre: 'x' }).expect(403);
  });

  it('organizador ajeno no ve los incidentes de otro evento (404, igual que inexistente)', async () => {
    const { evento } = await prepararEvento();
    const ajeno = await login(ctx, 'org.canal@ticketing.test', 'Organizador2026!');
    const r = await ctx.http.get(`/v1/admin/eventos/${evento}/incidentes`).set('authorization', ajeno).expect(404);
    expect(r.body.error.codigo).toBe('evento_no_encontrado');
    await ctx.http.get('/v1/admin/eventos/999999/incidentes').set('authorization', ajeno).expect(404);
    const admin = await login(ctx, 'admin@ticketing.test', 'Admin2026!');
    await ctx.http.get(`/v1/admin/eventos/${evento}/incidentes`).set('authorization', admin).expect(200);
  });
});
