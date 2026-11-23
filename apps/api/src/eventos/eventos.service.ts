import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { ErrorApi } from '../common/errores';
import { PG_POOL } from '../db/db.module';

/** Vida del micro-cache del detalle. Es el máximo que la disponibilidad puede mostrarse vieja. */
export const CACHE_DISPONIBILIDAD_MS = Number(process.env.CACHE_DISPONIBILIDAD_MS ?? 1000);
const PAGINA = 20;

// "Próximo / en venta / finalizado" se deriva del reloj: no se guarda, así nunca queda desfasado.
const ESTADO_VENTA = `CASE WHEN e.estado = 'cancelado' THEN 'cancelado'
                          WHEN now() < e.venta_abre THEN 'proximo'
                          WHEN now() >= e.fecha THEN 'finalizado'
                          ELSE 'en_venta' END`;

/**
 * Cartelera y disponibilidad. Aguantan mucho más tráfico que la compra porque:
 *  1. No cuentan filas: `zonas.vendidas` y `zonas.reservadas` son una proyección que cada
 *     compra/reserva/reembolso mantiene en su misma transacción. Disponibilidad = leer 1
 *     fila por zona.
 *  2. Micro-cache en memoria de CACHE_DISPONIBILIDAD_MS por evento (+ Cache-Control): si
 *     miles de clientes piden el mismo evento en el mismo segundo, la base recibe 1 consulta.
 * Lo mostrado puede tener como mucho ~1 s de antigüedad. Es informativo: quien decide si
 * hay lugar es el UPDATE atómico al reservar, nunca esta lectura.
 */
@Injectable()
export class EventosService {
  private readonly cache = new Map<string, { vence: number; valor: Promise<unknown> }>();

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Cartelera: eventos publicados que no terminaron, por fecha. Cursor = (fecha, id). */
  async cartelera(cursor?: string) {
    const [fecha, id] = cursor ? decodificarCursor(cursor) : [null, null];
    const { rows } = await this.pool.query(
      `SELECT e.id, e.codigo, e.nombre, e.recinto, e.fecha, e.venta_abre, ${ESTADO_VENTA} AS estado_venta,
              (SELECT min(f.precio_centesimos) FROM fases_precio f JOIN zonas z ON z.id = f.zona_id
                WHERE z.evento_id = e.id AND f.desde <= now() AND now() < f.hasta) AS precio_desde_centesimos,
              (SELECT sum(z.aforo - z.vendidas - z.reservadas)::int FROM zonas z WHERE z.evento_id = e.id) AS disponibles
         FROM eventos e
        WHERE e.estado = 'publicado' AND e.fecha > now()
          AND ($1::timestamptz IS NULL OR (e.fecha, e.id) > ($1::timestamptz, $2::bigint))
        ORDER BY e.fecha, e.id
        LIMIT $3`,
      [fecha, id, PAGINA + 1],
    );
    const hayMas = rows.length > PAGINA;
    const items = rows.slice(0, PAGINA);
    const ultimo = items.at(-1);
    return { items, siguiente_cursor: hayMas && ultimo ? codificarCursor(ultimo.fecha, ultimo.id) : null };
  }

  /** Detalle con disponibilidad por zona y fase vigente. Con micro-cache. */
  detalle(eventoId: string): Promise<unknown> {
    const ahora = Date.now();
    const hit = this.cache.get(eventoId);
    if (hit && hit.vence > ahora) return hit.valor;
    // Se cachea la PROMESA: las peticiones simultáneas comparten una sola consulta.
    const valor = this.consultarDetalle(eventoId);
    this.cache.set(eventoId, { vence: ahora + CACHE_DISPONIBILIDAD_MS, valor });
    valor.catch(() => this.cache.delete(eventoId));
    if (this.cache.size > 5_000) this.purgar(ahora);
    return valor;
  }

  private async consultarDetalle(eventoId: string) {
    const { rows } = await this.pool.query(
      `SELECT e.id, e.codigo, e.nombre, e.recinto, e.fecha, e.venta_abre, e.reembolsable_hasta,
              e.limite_por_cuenta, ${ESTADO_VENTA} AS estado_venta, now() AS consultado_en,
              COALESCE((
                SELECT json_agg(json_build_object(
                         'id', z.id::text, 'nombre', z.nombre, 'aforo', z.aforo,
                         'vendidas', z.vendidas, 'reservadas', z.reservadas,
                         'disponibles', z.aforo - z.vendidas - z.reservadas,
                         'fase_vigente', (SELECT json_build_object('fase', f.fase, 'precio_centesimos', f.precio_centesimos, 'hasta', f.hasta)
                                            FROM fases_precio f WHERE f.zona_id = z.id AND f.desde <= now() AND now() < f.hasta),
                         'fases', (SELECT json_agg(json_build_object('fase', f.fase, 'precio_centesimos', f.precio_centesimos,
                                                                     'desde', f.desde, 'hasta', f.hasta) ORDER BY f.desde)
                                     FROM fases_precio f WHERE f.zona_id = z.id))
                       ORDER BY z.id)
                  FROM zonas z WHERE z.evento_id = e.id), '[]') AS zonas
         FROM eventos e
        WHERE e.id = $1 AND e.estado <> 'borrador'`,
      [eventoId],
    );
    if (!rows[0]) throw new ErrorApi(404, 'evento_no_encontrado', 'El evento no existe');
    return rows[0];
  }

  private purgar(ahora: number) {
    for (const [k, v] of this.cache) if (v.vence <= ahora) this.cache.delete(k);
  }
}

function codificarCursor(fecha: Date, id: string): string {
  return Buffer.from(`${fecha.toISOString()}|${id}`).toString('base64url');
}

function decodificarCursor(cursor: string): [string, string] {
  const [fecha, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!fecha || !/^\d{1,18}$/.test(id ?? '') || Number.isNaN(Date.parse(fecha))) {
    throw new ErrorApi(400, 'cursor_invalido', 'El cursor no es válido');
  }
  return [fecha, id];
}
