import type { Pool, PoolClient } from 'pg';

/**
 * Ejecuta `fn` dentro de BEGIN/COMMIT con una conexión dedicada del pool.
 * Cualquier excepción hace ROLLBACK y se relanza. La conexión siempre vuelve al pool.
 */
export async function enTransaccion<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
