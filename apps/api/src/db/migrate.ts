/**
 * Runner de migraciones. Se ejecuta en el servicio `migrate` de docker compose, antes
 * de que arranque la API, conectado como dueño del esquema.
 *
 * Garantías:
 *  - Advisory lock de sesión: si dos procesos migran a la vez (dos réplicas, un
 *    reinicio rápido), el segundo espera y luego ve todo aplicado. Nada se aplica dos veces.
 *  - Cada migración corre en su propia transacción junto con su registro en
 *    schema_migrations: o queda aplicada y registrada, o nada.
 *  - Checksum SHA-256: si alguien edita una migración ya aplicada, el runner se niega
 *    a continuar. Una migración aplicada no se edita; se escribe otra.
 *  - Orden estricto por número; una migración registrada que ya no existe en disco
 *    también detiene el proceso (base y código desincronizados).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { configDueno, leerSecreto, ROL_APP } from './config';

// Llave arbitraria pero fija para pg_advisory_lock; la semilla usa la misma.
export const LOCK_MIGRACIONES = 727_001;

const PATRON = /^(\d{4})_[a-z0-9_]+\.sql$/;

interface Migracion {
  version: string;
  nombre: string;
  sql: string;
  checksum: string;
}

function log(msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), servicio: 'migrate', msg, ...extra }));
}

export function leerMigraciones(dir: string): Migracion[] {
  const archivos = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const vistas = new Set<string>();
  return archivos.map((nombre) => {
    const m = PATRON.exec(nombre);
    if (!m) throw new Error(`Nombre de migración inválido: ${nombre} (esperado 0001_descripcion.sql)`);
    const version = m[1];
    if (vistas.has(version)) throw new Error(`Versión de migración duplicada: ${version}`);
    vistas.add(version);
    const sql = readFileSync(join(dir, nombre), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    return { version, nombre, sql, checksum };
  });
}

/**
 * El rol de aplicación se crea aquí y no en un .sql porque su contraseña vive en el
 * volumen de secretos. Se re-sincroniza en cada arranque: si el volumen se regenera,
 * la base acepta la contraseña nueva.
 */
async function asegurarRolApp(client: Client) {
  const password = leerSecreto('DB_APP_PASSWORD');
  const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROL_APP]);
  // CREATE/ALTER ROLE no aceptan parámetros: se escapa explícitamente.
  const pw = client.escapeLiteral(password);
  const rol = client.escapeIdentifier(ROL_APP);
  const atributos = 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  if (rowCount === 0) {
    await client.query(`CREATE ROLE ${rol} ${atributos} PASSWORD ${pw}`);
    log('rol_app_creado', { rol: ROL_APP });
  } else {
    await client.query(`ALTER ROLE ${rol} ${atributos} PASSWORD ${pw}`);
  }
  const db = client.escapeIdentifier(client.database ?? '');
  await client.query(`GRANT CONNECT ON DATABASE ${db} TO ${rol}`);
  // El rol de app no crea objetos: solo usa el esquema.
  await client.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${rol}`);
}

export async function migrar(client: Client, dir: string): Promise<number> {
  const migraciones = leerMigraciones(dir);

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     text PRIMARY KEY,
      nombre      text NOT NULL,
      checksum    text NOT NULL,
      aplicada_en timestamptz NOT NULL DEFAULT now()
    )`);
  // La API la lee en /ready para confirmar que el esquema coincide con su versión.
  await client.query(`GRANT SELECT ON schema_migrations TO ${client.escapeIdentifier(ROL_APP)}`);

  const { rows } = await client.query<{ version: string; nombre: string; checksum: string }>(
    'SELECT version, nombre, checksum FROM schema_migrations ORDER BY version',
  );
  const aplicadas = new Map(rows.map((r) => [r.version, r]));
  const enDisco = new Set(migraciones.map((m) => m.version));

  for (const r of rows) {
    if (!enDisco.has(r.version)) {
      throw new Error(`La migración ${r.nombre} está aplicada pero no existe en disco`);
    }
  }

  let nuevas = 0;
  for (const m of migraciones) {
    const previa = aplicadas.get(m.version);
    if (previa) {
      if (previa.checksum !== m.checksum) {
        throw new Error(
          `La migración ${m.nombre} cambió después de aplicarse (checksum distinto). ` +
            'Revierte el cambio y escribe una migración nueva.',
        );
      }
      continue;
    }
    const inicio = Date.now();
    await client.query('BEGIN');
    try {
      await client.query(m.sql);
      await client.query('INSERT INTO schema_migrations (version, nombre, checksum) VALUES ($1, $2, $3)', [
        m.version,
        m.nombre,
        m.checksum,
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Falló la migración ${m.nombre}: ${(err as Error).message}`, { cause: err });
    }
    nuevas++;
    log('migracion_aplicada', { migracion: m.nombre, ms: Date.now() - inicio });
  }
  return nuevas;
}

async function main() {
  const dir = resolve(process.env.MIGRATIONS_DIR ?? join(__dirname, '..', '..', 'migrations'));
  const client = new Client(configDueno());
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_MIGRACIONES]);
    await asegurarRolApp(client);
    const nuevas = await migrar(client, dir);
    log('migraciones_ok', { nuevas });
  } finally {
    // Cerrar la sesión libera el advisory lock aunque algo haya fallado.
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err: Error) => {
    log('migraciones_error', { error: err.message });
    process.exit(1);
  });
}
