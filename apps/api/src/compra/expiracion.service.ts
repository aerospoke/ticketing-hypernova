import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { Pool } from 'pg';
import { log } from '../common/contexto';
import { PG_POOL } from '../db/db.module';
import { enTransaccion } from '../db/transaccion';

const INTERVALO_MS = Number(process.env.BARRIDO_INTERVALO_MS ?? 5_000);
const LOTE = 500;
// Llave del advisory lock del barrido: con varias instancias de la API, solo una barre a la vez.
const LOCK_BARRIDO = 727_002;

/**
 * Libera el cupo de las reservas vencidas.
 *
 * Es confiable aunque el proceso se reinicie porque no guarda nada en memoria: el estado
 * está en la tabla (`estado = 'activa' AND expira_en <= now()`). Al arrancar barre de
 * inmediato y después cada INTERVALO_MS. Si el proceso muere a mitad de un lote, la
 * transacción se revierte y el siguiente barrido la retoma.
 *
 * Además, la vigencia también se respeta por consulta: el pago de una reserva vencida
 * sigue la política de pago tardío aunque el barrido todavía no haya pasado.
 */
@Injectable()
export class ExpiracionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private corriendo = false;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  onApplicationBootstrap() {
    if (INTERVALO_MS <= 0) return; // desactivable en tests
    void this.barrer();
    this.timer = setInterval(() => void this.barrer(), INTERVALO_MS);
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  /** Devuelve cuántas reservas liberó. Público para poder probarlo directamente. */
  async barrer(): Promise<number> {
    if (this.corriendo) return 0; // un barrido largo no se solapa con el siguiente
    this.corriendo = true;
    let total = 0;
    try {
      for (;;) {
        const liberadas = await enTransaccion(this.pool, async (c) => {
          const lock = await c.query<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS ok', [LOCK_BARRIDO]);
          if (!lock.rows[0].ok) return 0;

          // SKIP LOCKED: si un pago o una cancelación tiene tomada una reserva, no la
          // esperamos; ese camino la resuelve y el barrido sigue con las demás.
          const { rows } = await c.query<{ usuario_id: string; evento_id: string; zona_id: string; cantidad: number }>(
            `WITH vencidas AS (
               SELECT id FROM reservas
                WHERE estado = 'activa' AND expira_en <= now()
                ORDER BY expira_en
                LIMIT $1
                FOR UPDATE SKIP LOCKED)
             UPDATE reservas r SET estado = 'expirada', resuelta_en = now()
               FROM vencidas v WHERE r.id = v.id
             RETURNING r.usuario_id, r.evento_id, r.zona_id, r.cantidad`,
            [LOTE],
          );
          if (rows.length === 0) return 0;

          // Mismo orden de locks que el resto del motor: cupo_cuenta y después zonas.
          // Se agrupa para tocar cada fila una sola vez.
          await c.query(
            `UPDATE cupo_cuenta c SET usadas = c.usadas - v.n
               FROM (SELECT x.usuario_id::bigint AS usuario_id, x.evento_id::bigint AS evento_id, sum(x.cantidad)::int AS n
                       FROM jsonb_to_recordset($1::jsonb) AS x(usuario_id text, evento_id text, cantidad int)
                      GROUP BY 1, 2 ORDER BY 1, 2) v
              WHERE c.usuario_id = v.usuario_id AND c.evento_id = v.evento_id`,
            [JSON.stringify(rows)],
          );
          await c.query(
            `UPDATE zonas z SET reservadas = z.reservadas - v.n
               FROM (SELECT x.zona_id::bigint AS zona_id, sum(x.cantidad)::int AS n
                       FROM jsonb_to_recordset($1::jsonb) AS x(zona_id text, cantidad int)
                      GROUP BY 1 ORDER BY 1) v
              WHERE z.id = v.zona_id`,
            [JSON.stringify(rows)],
          );
          return rows.length;
        });
        total += liberadas;
        if (liberadas < LOTE) break;
      }
      if (total > 0) log('info', 'reservas_expiradas', { liberadas: total });
      // Limpieza de claves de idempotencia vencidas (24 h).
      await this.pool.query('DELETE FROM idempotency_keys WHERE expira_en < now()');
    } catch (e) {
      log('error', 'barrido_fallido', { error: (e as Error).message });
    } finally {
      this.corriendo = false;
    }
    return total;
  }
}
