import type { PoolClient } from 'pg';
import { contexto } from './contexto';

/**
 * Registra una acción administrativa en la tabla `auditoria`, dentro de la MISMA
 * transacción que la acción: si la acción se revierte, su registro también; si se
 * confirma, queda registrada. La app solo puede insertar y leer (ni UPDATE ni DELETE).
 */
export async function auditar(
  c: PoolClient,
  actorId: string,
  accion: string,
  entidad: string,
  entidadId: string,
  detalle: Record<string, unknown>,
) {
  await c.query(
    `INSERT INTO auditoria (actor_id, accion, entidad, entidad_id, detalle, correlacion_id) VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorId, accion, entidad, entidadId, JSON.stringify(detalle), contexto.getStore()?.correlacionId ?? null],
  );
}
