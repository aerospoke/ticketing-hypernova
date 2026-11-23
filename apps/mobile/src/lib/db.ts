/**
 * Base local SQLite: caché de la billetera (para mostrar el QR sin red) y el almacén del
 * escáner (miles de escaneos pendientes y la lista de revocaciones). Esquema versionado
 * con PRAGMA user_version.
 */
import { openDatabaseSync } from 'expo-sqlite';

export const db = openDatabaseSync('ticketing.db');

const VERSION = 1;

export function migrar() {
  db.execSync('PRAGMA journal_mode = WAL;');
  const fila = db.getFirstSync<{ user_version: number }>('PRAGMA user_version');
  if ((fila?.user_version ?? 0) >= VERSION) return;
  db.execSync(`
    -- Billetera: la última lista conocida y el material firmado de cada entrada.
    CREATE TABLE IF NOT EXISTS billetera (
      usuario_id TEXT NOT NULL,
      datos      TEXT NOT NULL,
      guardada   INTEGER NOT NULL,
      PRIMARY KEY (usuario_id)
    );
    CREATE TABLE IF NOT EXISTS material (
      entrada_id     TEXT PRIMARY KEY,
      usuario_id     TEXT NOT NULL,
      credencial     TEXT NOT NULL,
      firma_servidor TEXT NOT NULL,
      version        INTEGER NOT NULL,
      pk             TEXT NOT NULL,
      expira_en      TEXT NOT NULL
    );

    -- Escáner: cada escaneo con su client_scan_id; 'sincronizado' = ya lo confirmó el servidor.
    CREATE TABLE IF NOT EXISTS escaneos (
      client_scan_id TEXT PRIMARY KEY,
      turno_id       TEXT NOT NULL,
      entrada_id     TEXT,
      version        INTEGER,
      resultado      TEXT NOT NULL,
      motivo         TEXT,
      escaneado_en   TEXT NOT NULL,
      sincronizado   INTEGER NOT NULL DEFAULT 0,
      resultado_servidor TEXT
    );
    -- "¿Ya dejé pasar esta entrada?" en microsegundos, aunque haya miles de escaneos.
    CREATE INDEX IF NOT EXISTS escaneos_validos ON escaneos (entrada_id) WHERE resultado = 'valido';
    CREATE INDEX IF NOT EXISTS escaneos_pendientes ON escaneos (sincronizado, escaneado_en);

    CREATE TABLE IF NOT EXISTS revocaciones (
      entrada_id     TEXT PRIMARY KEY,
      anulada        INTEGER NOT NULL DEFAULT 0,
      version_minima INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
  `);
  db.execSync(`PRAGMA user_version = ${VERSION}`);
}

export function leerAjuste(clave: string): string | null {
  return db.getFirstSync<{ valor: string }>('SELECT valor FROM ajustes WHERE clave = ?', clave)?.valor ?? null;
}

export function guardarAjuste(clave: string, valor: string) {
  db.runSync('INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor', clave, valor);
}
