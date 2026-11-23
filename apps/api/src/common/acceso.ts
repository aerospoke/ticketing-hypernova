import type { Pool, PoolClient } from 'pg';
import type { Sesion } from '../auth/tokens';
import { ErrorApi } from './errores';

/**
 * Autorización por evento, verificada en el servidor:
 *  - admin: todos los eventos;
 *  - organizador: solo los suyos (eventos.organizador_id);
 *  - staff: solo los eventos a los que está asignado (si `staff` es true).
 *
 * "No existe" y "no es tuyo" responden igual (404): probar con el id de un evento ajeno
 * no revela si ese evento existe.
 */
export async function exigirAccesoEvento(
  db: Pool | PoolClient,
  s: Sesion,
  eventoId: string,
  opciones: { staff: boolean },
): Promise<void> {
  if (s.rol === 'admin') {
    const { rowCount } = await db.query('SELECT 1 FROM eventos WHERE id = $1', [eventoId]);
    if (rowCount) return;
  } else if (s.rol === 'organizador') {
    const { rowCount } = await db.query('SELECT 1 FROM eventos WHERE id = $1 AND organizador_id = $2', [eventoId, s.usuarioId]);
    if (rowCount) return;
  } else if (s.rol === 'staff' && opciones.staff) {
    const { rowCount } = await db.query('SELECT 1 FROM asignaciones_staff WHERE evento_id = $1 AND staff_id = $2', [eventoId, s.usuarioId]);
    if (rowCount) return;
  }
  throw new ErrorApi(404, 'evento_no_encontrado', 'El evento no existe o no tienes acceso');
}
