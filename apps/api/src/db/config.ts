import { readFileSync } from 'node:fs';
import type { PoolConfig } from 'pg';

/**
 * Lee un secreto con la convención `_FILE`: si existe NOMBRE_FILE, el valor es el
 * contenido de ese archivo (volumen de secretos); si no, NOMBRE. No hay valores por
 * defecto: un secreto ausente detiene el arranque en vez de usar algo predecible.
 */
export function leerSecreto(nombre: string): string {
  const ruta = process.env[`${nombre}_FILE`];
  if (ruta) return readFileSync(ruta, 'utf8').trim();
  const valor = process.env[nombre];
  if (valor) return valor;
  throw new Error(`Falta el secreto ${nombre} (define ${nombre}_FILE o ${nombre})`);
}

export function requerido(nombre: string): string {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre}`);
  return valor;
}

/** Rol de aplicación: lo crea el runner y lo usan las migraciones en sus GRANT. */
export const ROL_APP = 'ticketing_app';

/** Conexión como dueño del esquema: solo para migraciones y semilla. */
export function configDueno(): PoolConfig {
  return {
    host: requerido('PGHOST'),
    port: Number(process.env.PGPORT ?? 5432),
    database: requerido('PGDATABASE'),
    user: requerido('DB_OWNER_USER'),
    password: leerSecreto('DB_OWNER_PASSWORD'),
    application_name: 'ticketing-migrate',
  };
}
