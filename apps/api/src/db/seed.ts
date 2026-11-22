/**
 * Semilla automática e idempotente con el dataset oficial (datos-prueba-ticketing.json).
 * Corre en el servicio `migrate`, después de las migraciones, como dueño del esquema.
 *
 * Idempotencia: todo va en UNA transacción que termina registrando el dataset en la
 * tabla `semillas`. Si ya está registrado, no hace nada. Si falla a mitad, no queda nada
 * a medias y el próximo `docker compose up` lo reintenta. El advisory lock evita que
 * dos procesos siembren a la vez.
 *
 * Transformaciones (documentadas en el README):
 *  - IDs del personal: admin 101, organizadores 201-203 y staff 301-312 chocan con IDs de
 *    asistentes (1-600) en una tabla única de usuarios. Personal = 100000 + id original.
 *  - Fechas: el dataset es una foto al instante meta.referencia_temporal. Se desplazan
 *    todas por el mismo número de días enteros hasta hoy, para que el estado relativo se
 *    mantenga (el evento 4 sigue en venta y la zona 8 con 50 entradas restantes).
 *  - Contraseñas: se guardan con scrypt, nunca en claro.
 *  - Datos derivados que el dataset no trae: contadores de zonas, cupo por cuenta,
 *    versión de cada entrada (1 + transferencias aceptadas), fase y precio congelado de
 *    las reservas históricas, reembolsos y revocaciones de las entradas ya anuladas.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { hashPassword } from '../auth/password';
import { configDueno } from './config';
import { LOCK_MIGRACIONES } from './migrate';

const DATASET = 'datos-prueba-ticketing';
const OFFSET_PERSONAL = 100_000;
const DIA_MS = 86_400_000;

type Fila = Record<string, unknown>;

interface Dataset {
  meta: { referencia_temporal: string };
  usuarios_administrativos: Persona[];
  organizadores: Persona[];
  staff: (Persona & { organizador_id: number })[];
  asistentes: (Persona & { creado_en: string })[];
  eventos: Fila[];
  zonas: Fila[];
  fases_precio: { id: number; zona_id: number; fase: string; precio_centesimos: number; desde: string; hasta: string }[];
  puertas: Fila[];
  asignaciones_staff: { evento_id: number; staff_id: number }[];
  compras: Compra[];
  entradas: Entrada[];
  transferencias: { id: number; entrada_id: number; estado: string; creada_en: string; resuelta_en: string | null }[];
  ingresos: { id: number; entrada_id: number; staff_id: number; escaneado_en: string; sincronizado_en: string }[];
  reservas: { id: number; asistente_id: number; zona_id: number; cantidad: number; creada_en: string; expira_en: string; estado: string }[];
}
interface Persona { id: number; nombre: string; email: string; password: string; rol: string; activo?: boolean }
interface Compra { id: number; asistente_id: number; evento_id: number; zona_id: number; fase_precio_id: number; cantidad: number; precio_unitario_centesimos: number; monto_centesimos: number; idempotency_key: string; estado: string; pagada_en: string; reembolsada_en: string | null }
interface Entrada { id: number; compra_id: number; evento_id: number; zona_id: number; titular_id: number; comprador_id: number; estado: string; emitida_en: string }

function log(msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), servicio: 'seed', msg, ...extra }));
}

/**
 * INSERT masivo: las filas viajan como un único parámetro jsonb y PostgreSQL las expande
 * con jsonb_to_recordset. Tabla y columnas son constantes de este archivo (no hay
 * interpolación de datos); los valores siempre van como parámetro.
 */
async function insertar(client: Client, tabla: string, columnas: [string, string][], filas: Fila[]) {
  if (filas.length === 0) return;
  const nombres = columnas.map(([c]) => c).join(', ');
  const tipos = columnas.map(([c, t]) => `${c} ${t}`).join(', ');
  await client.query(
    `INSERT INTO ${tabla} (${nombres}) SELECT ${nombres} FROM jsonb_to_recordset($1::jsonb) AS x(${tipos})`,
    [JSON.stringify(filas)],
  );
  log('tabla_sembrada', { tabla, filas: filas.length });
}

export async function sembrar(client: Client, rutaDataset: string, ahora = new Date()): Promise<boolean> {
  const crudo = readFileSync(rutaDataset);
  const checksum = createHash('sha256').update(crudo).digest('hex');
  const d = JSON.parse(crudo.toString('utf8')) as Dataset;

  const ya = await client.query('SELECT checksum FROM semillas WHERE dataset = $1', [DATASET]);
  if (ya.rowCount) {
    if (ya.rows[0].checksum !== checksum) log('semilla_dataset_distinto', { aviso: 'el dataset cambió; no se resiembra' });
    log('semilla_ya_aplicada');
    return false;
  }

  // Días enteros: conserva la hora del día de cada fecha del dataset.
  const referencia = new Date(d.meta.referencia_temporal);
  const dias = Math.floor((ahora.getTime() - referencia.getTime()) / DIA_MS);
  const mover = (iso: string | null) => (iso === null ? null : new Date(new Date(iso).getTime() + dias * DIA_MS).toISOString());
  const personal = (id: number) => id + OFFSET_PERSONAL;

  // --- Usuarios (hash en paralelo: scrypt corre en el threadpool de libuv) ---
  const personas = [
    ...d.usuarios_administrativos.map((u) => ({ ...u, id: personal(u.id), organizador_id: null, creado_en: null })),
    ...d.organizadores.map((u) => ({ ...u, id: personal(u.id), organizador_id: null, creado_en: null })),
    ...d.staff.map((u) => ({ ...u, id: personal(u.id), organizador_id: personal(u.organizador_id), creado_en: null })),
    ...d.asistentes.map((u) => ({ ...u, organizador_id: null, creado_en: mover(u.creado_en) })),
  ];
  const usuarios = await Promise.all(
    personas.map(async (u) => ({
      id: u.id,
      nombre: u.nombre,
      email: u.email.trim().toLowerCase(),
      password_hash: await hashPassword(u.password),
      rol: u.rol,
      organizador_id: u.organizador_id,
      activo: u.activo ?? true,
      creado_en: u.creado_en ?? ahora.toISOString(),
    })),
  );

  // --- Derivados ---
  const zonaEvento = new Map(d.zonas.map((z) => [z.id as number, z.evento_id as number]));
  const compraPorId = new Map(d.compras.map((c) => [c.id, c]));
  const transferenciasAceptadas = new Map<number, number>();
  for (const t of d.transferencias) {
    if (t.estado === 'aceptada') transferenciasAceptadas.set(t.entrada_id, (transferenciasAceptadas.get(t.entrada_id) ?? 0) + 1);
  }
  const usadaEn = new Map(d.ingresos.map((i) => [i.entrada_id, i.escaneado_en]));

  const faseVigente = (zonaId: number, instante: string) => {
    const f = d.fases_precio.find((x) => x.zona_id === zonaId && x.desde <= instante && instante < x.hasta);
    if (!f) throw new Error(`Sin fase de precio vigente para zona ${zonaId} en ${instante}`);
    return f;
  };

  const entradas = d.entradas.map((e) => {
    const compra = compraPorId.get(e.compra_id)!;
    const anulada = e.estado === 'reembolsada';
    return {
      id: e.id,
      compra_id: e.compra_id,
      evento_id: e.evento_id,
      zona_id: e.zona_id,
      comprador_id: e.comprador_id,
      titular_id: e.titular_id,
      estado: e.estado,
      version: 1 + (transferenciasAceptadas.get(e.id) ?? 0),
      precio_centesimos: compra.precio_unitario_centesimos,
      emitida_en: mover(e.emitida_en),
      usada_en: e.estado === 'usada' ? mover(usadaEn.get(e.id) ?? null) : null,
      anulada_en: anulada ? mover(compra.reembolsada_en) : null,
    };
  });

  const reembolsadas = d.entradas.filter((e) => e.estado === 'reembolsada');

  await client.query('BEGIN');
  try {
    await insertar(client, 'usuarios', [
      ['id', 'bigint'], ['nombre', 'text'], ['email', 'text'], ['password_hash', 'text'], ['rol', 'text'],
      ['organizador_id', 'bigint'], ['activo', 'boolean'], ['creado_en', 'timestamptz'],
    ], usuarios);

    await insertar(client, 'eventos', [
      ['id', 'bigint'], ['codigo', 'text'], ['nombre', 'text'], ['organizador_id', 'bigint'], ['recinto', 'text'],
      ['fecha', 'timestamptz'], ['venta_abre', 'timestamptz'], ['reembolsable_hasta', 'timestamptz'],
      ['limite_por_cuenta', 'integer'], ['estado', 'text'],
    ], d.eventos.map((e) => ({
      id: e.id, codigo: e.codigo, nombre: e.nombre, organizador_id: personal(e.organizador_id as number), recinto: e.recinto,
      fecha: mover(e.fecha as string), venta_abre: mover(e.venta_abre as string),
      reembolsable_hasta: mover(e.reembolsable_hasta as string), limite_por_cuenta: e.limite_por_cuenta,
      // proximo / en_venta / finalizado se derivan de las fechas; aquí solo el estado administrativo.
      estado: 'publicado',
    })));

    await insertar(client, 'zonas', [['id', 'bigint'], ['evento_id', 'bigint'], ['nombre', 'text'], ['aforo', 'integer']], d.zonas);

    await insertar(client, 'fases_precio', [
      ['id', 'bigint'], ['zona_id', 'bigint'], ['fase', 'text'], ['precio_centesimos', 'integer'],
      ['desde', 'timestamptz'], ['hasta', 'timestamptz'],
    ], d.fases_precio.map((f) => ({ ...f, desde: mover(f.desde), hasta: mover(f.hasta) })));

    await insertar(client, 'puertas', [['id', 'bigint'], ['evento_id', 'bigint'], ['nombre', 'text']], d.puertas);

    await insertar(client, 'asignaciones_staff', [['evento_id', 'bigint'], ['staff_id', 'bigint']],
      d.asignaciones_staff.map((a) => ({ evento_id: a.evento_id, staff_id: personal(a.staff_id) })));

    await insertar(client, 'reservas', [
      ['id', 'bigint'], ['usuario_id', 'bigint'], ['evento_id', 'bigint'], ['zona_id', 'bigint'], ['fase_precio_id', 'bigint'],
      ['cantidad', 'integer'], ['precio_unitario_centesimos', 'integer'], ['monto_centesimos', 'bigint'],
      ['idempotency_key', 'text'], ['estado', 'text'], ['creada_en', 'timestamptz'], ['expira_en', 'timestamptz'],
      ['resuelta_en', 'timestamptz'],
    ], d.reservas.map((r) => {
      // El dataset no trae el precio de la reserva: se congela el de la fase vigente al crearla.
      const f = faseVigente(r.zona_id, r.creada_en);
      if (r.estado !== 'expirada') throw new Error(`Estado de reserva no soportado en semilla: ${r.estado}`);
      return {
        id: r.id, usuario_id: r.asistente_id, evento_id: zonaEvento.get(r.zona_id), zona_id: r.zona_id,
        fase_precio_id: f.id, cantidad: r.cantidad, precio_unitario_centesimos: f.precio_centesimos,
        monto_centesimos: r.cantidad * f.precio_centesimos, idempotency_key: `seed-reserva-${r.id}`,
        estado: r.estado, creada_en: mover(r.creada_en), expira_en: mover(r.expira_en), resuelta_en: mover(r.expira_en),
      };
    }));

    await insertar(client, 'compras', [
      ['id', 'bigint'], ['usuario_id', 'bigint'], ['evento_id', 'bigint'], ['zona_id', 'bigint'], ['fase_precio_id', 'bigint'],
      ['cantidad', 'integer'], ['precio_unitario_centesimos', 'integer'], ['monto_centesimos', 'bigint'],
      ['idempotency_key', 'text'], ['estado', 'text'], ['referencia_pago', 'text'], ['pagada_en', 'timestamptz'],
      ['reembolsada_en', 'timestamptz'],
    ], d.compras.map((c) => ({
      id: c.id, usuario_id: c.asistente_id, evento_id: c.evento_id, zona_id: c.zona_id, fase_precio_id: c.fase_precio_id,
      cantidad: c.cantidad, precio_unitario_centesimos: c.precio_unitario_centesimos, monto_centesimos: c.monto_centesimos,
      idempotency_key: c.idempotency_key, estado: c.estado, referencia_pago: `seed-${c.id}`,
      pagada_en: mover(c.pagada_en), reembolsada_en: mover(c.reembolsada_en),
    })));

    await insertar(client, 'entradas', [
      ['id', 'bigint'], ['compra_id', 'bigint'], ['evento_id', 'bigint'], ['zona_id', 'bigint'], ['comprador_id', 'bigint'],
      ['titular_id', 'bigint'], ['estado', 'text'], ['version', 'integer'], ['precio_centesimos', 'integer'],
      ['emitida_en', 'timestamptz'], ['usada_en', 'timestamptz'], ['anulada_en', 'timestamptz'],
    ], entradas);

    await insertar(client, 'transferencias', [
      ['id', 'bigint'], ['entrada_id', 'bigint'], ['de_usuario_id', 'bigint'], ['a_usuario_id', 'bigint'],
      ['estado', 'text'], ['creada_en', 'timestamptz'], ['resuelta_en', 'timestamptz'],
    ], d.transferencias.map((t) => ({ ...t, creada_en: mover(t.creada_en), resuelta_en: mover(t.resuelta_en) })));

    await insertar(client, 'reembolsos', [
      ['compra_id', 'bigint'], ['entrada_id', 'bigint'], ['monto_centesimos', 'bigint'], ['motivo', 'text'], ['creado_en', 'timestamptz'],
    ], reembolsadas.map((e) => {
      const c = compraPorId.get(e.compra_id)!;
      return {
        compra_id: c.id, entrada_id: e.id, monto_centesimos: c.precio_unitario_centesimos,
        motivo: 'Reembolso histórico (dataset)', creado_en: mover(c.reembolsada_en),
      };
    }));

    await insertar(client, 'ingresos', [
      ['id', 'bigint'], ['client_scan_id', 'text'], ['entrada_id', 'bigint'], ['evento_id', 'bigint'], ['puerta_id', 'bigint'],
      ['staff_id', 'bigint'], ['resultado', 'text'], ['escaneado_en', 'timestamptz'], ['sincronizado_en', 'timestamptz'],
    ], d.ingresos.map((i) => ({
      ...i, staff_id: personal(i.staff_id), escaneado_en: mover(i.escaneado_en), sincronizado_en: mover(i.sincronizado_en),
    })));

    // Revocaciones de lo que ya está fuera de circulación, en orden cronológico, para que
    // un escáner que sincroniza desde cero conozca las credenciales viejas y las anuladas.
    const revocaciones = [
      ...d.transferencias.filter((t) => t.estado === 'aceptada').map((t) => {
        const e = entradas.find((x) => x.id === t.entrada_id)!;
        return { evento_id: e.evento_id, entrada_id: e.id, tipo: 'version', version_minima: e.version, motivo: 'transferencia', creada_en: mover(t.resuelta_en) };
      }),
      ...reembolsadas.map((e) => ({
        evento_id: e.evento_id, entrada_id: e.id, tipo: 'entrada', version_minima: null, motivo: 'reembolso',
        creada_en: mover(compraPorId.get(e.compra_id)!.reembolsada_en),
      })),
    ].sort((a, b) => a.creada_en!.localeCompare(b.creada_en!));
    await insertar(client, 'revocaciones', [
      ['evento_id', 'bigint'], ['entrada_id', 'bigint'], ['tipo', 'text'], ['version_minima', 'integer'],
      ['motivo', 'text'], ['creada_en', 'timestamptz'],
    ], revocaciones);

    // Contadores del invariante 1, derivados de las entradas vigentes. Ninguna reserva
    // del dataset está activa, así que `reservadas` queda en 0.
    await client.query(`
      UPDATE zonas z SET vendidas = v.n
        FROM (SELECT zona_id, count(*)::int AS n FROM entradas
               WHERE estado IN ('pagada', 'transferida', 'usada') GROUP BY zona_id) v
       WHERE z.id = v.zona_id`);
    await client.query(`
      INSERT INTO cupo_cuenta (usuario_id, evento_id, usadas)
      SELECT comprador_id, evento_id, count(*)::int FROM entradas
       WHERE estado IN ('pagada', 'transferida', 'usada')
       GROUP BY comprador_id, evento_id`);

    // Las secuencias de identidad siguen después del último ID sembrado.
    for (const tabla of ['usuarios', 'eventos', 'zonas', 'fases_precio', 'puertas', 'reservas', 'compras',
      'entradas', 'transferencias', 'reembolsos', 'ingresos']) {
      await client.query(
        `SELECT setval(pg_get_serial_sequence($1, 'id'), (SELECT COALESCE(max(id), 0) + 1 FROM ${tabla}), false)`,
        [tabla],
      );
    }

    await client.query(
      `INSERT INTO auditoria (accion, entidad, detalle) VALUES ('semilla_aplicada', 'semillas', $1::jsonb)`,
      [JSON.stringify({ dataset: DATASET, checksum, desplazamiento_dias: dias })],
    );
    await client.query(
      `INSERT INTO semillas (dataset, checksum, desplazamiento) VALUES ($1, $2, make_interval(days => $3))`,
      [DATASET, checksum, dias],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
  await client.query('ANALYZE');
  log('semilla_aplicada', { desplazamiento_dias: dias, usuarios: usuarios.length });
  return true;
}

async function main() {
  const ruta = resolve(process.env.SEED_FILE ?? join(__dirname, '..', '..', 'seed', 'datos-prueba-ticketing.json'));
  const client = new Client(configDueno());
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_MIGRACIONES]);
    await sembrar(client, ruta);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err: Error) => {
    log('semilla_error', { error: err.message });
    process.exit(1);
  });
}
