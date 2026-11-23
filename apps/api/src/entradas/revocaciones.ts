import type { PoolClient } from 'pg';

const LOCK_REVOCACIONES = 727_003;

/**
 * Publica una revocación para los escáneres del evento.
 *
 * Los escáneres bajan "todo lo que tenga id > mi cursor". Un id de identidad NO se
 * confirma en orden: la transacción con id 10 puede hacer COMMIT después de que alguien
 * ya leyó el 11, y ese escáner nunca vería el 10. Para evitarlo, se toma un advisory lock
 * por evento hasta el COMMIT: dentro de un evento las revocaciones se insertan y confirman
 * de a una, y el orden de los ids coincide con el de confirmación.
 */
export async function publicarRevocacion(
  c: PoolClient,
  r: {
    eventoId: string;
    entradaId: string;
    tipo: 'version' | 'entrada';
    versionMinima?: number;
    motivo: 'transferencia' | 'dispositivo' | 'reembolso' | 'anulacion';
  },
) {
  await c.query('SELECT pg_advisory_xact_lock($1, $2::int)', [LOCK_REVOCACIONES, r.eventoId]);
  await c.query(
    `INSERT INTO revocaciones (evento_id, entrada_id, tipo, version_minima, motivo) VALUES ($1, $2, $3, $4, $5)`,
    [r.eventoId, r.entradaId, r.tipo, r.tipo === 'version' ? r.versionMinima : null, r.motivo],
  );
}
