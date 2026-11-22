import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { log } from '../common/contexto';
import { ErrorApi } from '../common/errores';
import { PG_POOL } from '../db/db.module';
import type { Resultado } from './idempotencia.service';

/** Duración de la reserva. Configurable para poder demostrar la expiración sin esperar 10 min. */
export const RESERVA_TTL_S = Number(process.env.RESERVA_TTL_S ?? 600);

interface FilaReserva {
  id: string;
  usuario_id: string;
  evento_id: string;
  zona_id: string;
  fase_precio_id: string;
  cantidad: number;
  precio_unitario_centesimos: number;
  monto_centesimos: string;
  estado: 'activa' | 'pagada' | 'expirada' | 'cancelada';
  creada_en: Date;
  expira_en: Date;
}

const COLUMNAS_RESERVA = `id, usuario_id, evento_id, zona_id, fase_precio_id, cantidad, precio_unitario_centesimos,
  monto_centesimos, estado, creada_en, expira_en`;

/**
 * Motor de compra. ORDEN DE LOCKS en todos los caminos: reservas -> cupo_cuenta -> zonas.
 * Con un orden único dos transacciones nunca se esperan en círculo (sin deadlocks).
 *
 * Ninguna decisión de cupo se toma leyendo y después escribiendo: siempre es un
 * UPDATE/UPSERT con la condición en el WHERE, que PostgreSQL evalúa con la fila bloqueada.
 */
@Injectable()
export class CompraService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Reservar: retiene cupo y congela el precio de la fase vigente AHORA. */
  async reservar(c: PoolClient, usuarioId: string, zonaId: string, cantidad: number, clave: string): Promise<Resultado> {
    // 1. Zona en venta y fase vigente. El precio lo decide el servidor; el cliente no
    //    manda montos (y si los manda, el esquema de entrada los descarta).
    const { rows: venta } = await c.query<{ evento_id: string; fase_precio_id: string; precio: number }>(
      `SELECT z.evento_id, f.id AS fase_precio_id, f.precio_centesimos AS precio
         FROM zonas z
         JOIN eventos e ON e.id = z.evento_id
         JOIN fases_precio f ON f.zona_id = z.id AND f.desde <= now() AND now() < f.hasta
        WHERE z.id = $1 AND e.estado = 'publicado' AND e.venta_abre <= now() AND now() < e.fecha`,
      [zonaId],
    );
    if (venta.length === 0) {
      const existe = await c.query('SELECT 1 FROM zonas WHERE id = $1', [zonaId]);
      if (!existe.rowCount) throw new ErrorApi(404, 'zona_no_encontrada', 'La zona no existe');
      throw new ErrorApi(409, 'fuera_de_venta', 'La zona no está a la venta en este momento');
    }
    const { evento_id: eventoId, fase_precio_id: faseId, precio } = venta[0];

    // 2. Límite por cuenta (UPSERT condicional atómico). Dos compras simultáneas del mismo
    //    usuario chocan en esta fila y se serializan; la que excede el límite no afecta filas.
    await this.tomarCupoCuenta(c, usuarioId, eventoId, cantidad);

    // 3. Aforo (invariante 1). El WHERE se evalúa con la fila de la zona bloqueada: si no
    //    entran `cantidad` lugares, 0 filas y 409. El CHECK de la tabla es la red de seguridad.
    await this.tomarAforo(c, zonaId, cantidad, 'reservadas');

    // 4. La reserva, con el precio congelado.
    const { rows } = await c.query<FilaReserva>(
      `INSERT INTO reservas (usuario_id, evento_id, zona_id, fase_precio_id, cantidad,
                             precio_unitario_centesimos, monto_centesimos, idempotency_key, expira_en)
       VALUES ($1, $2, $3, $4, $5::int, $6::int, $5::int::bigint * $6::int, $7, now() + make_interval(secs => $8))
       RETURNING ${COLUMNAS_RESERVA}`,
      [usuarioId, eventoId, zonaId, faseId, cantidad, precio, clave, RESERVA_TTL_S],
    );
    log('info', 'reserva_creada', { reserva: rows[0].id, zona: zonaId, cantidad });
    return { status: 201, body: vistaReserva(rows[0]) };
  }

  /** Estado de una reserva propia, con los segundos restantes para el contador de la app. */
  async consultar(usuarioId: string, reservaId: string) {
    const { rows } = await this.pool.query<FilaReserva>(
      `SELECT ${COLUMNAS_RESERVA} FROM reservas WHERE id = $1 AND usuario_id = $2`,
      [reservaId, usuarioId],
    );
    // Una reserva ajena responde igual que una inexistente: no se revela que existe.
    if (!rows[0]) throw new ErrorApi(404, 'reserva_no_encontrada', 'La reserva no existe');
    return vistaReserva(rows[0]);
  }

  async cancelar(c: PoolClient, usuarioId: string, reservaId: string): Promise<Resultado> {
    const r = await this.bloquearReserva(c, usuarioId, reservaId);
    if (r.estado === 'pagada') throw new ErrorApi(409, 'reserva_pagada', 'La reserva ya fue pagada; usa el reembolso');
    if (r.estado === 'activa') {
      await c.query(`UPDATE reservas SET estado = 'cancelada', resuelta_en = now() WHERE id = $1`, [r.id]);
      await this.liberar(c, r.usuario_id, r.evento_id, r.zona_id, r.cantidad);
      r.estado = 'cancelada';
      log('info', 'reserva_cancelada', { reserva: r.id });
    }
    // Cancelar algo ya cancelado o expirado no es error: el resultado es el mismo.
    return { status: 200, body: vistaReserva(r) };
  }

  /**
   * Pago simulado + emisión. Casos:
   *  - Ya existe la compra de esta reserva (aunque sea con otra clave): se devuelve esa.
   *  - Reserva activa (aunque haya vencido y el barrido no haya pasado aún, el cupo sigue
   *    retenido): reservadas -> vendidas y se emiten las entradas.
   *  - Reserva expirada y ya liberada (pago tardío): se intenta recuperar el cupo con los
   *    mismos UPDATE condicionales. Si hay cupo se emite; si no, la compra queda
   *    'reembolso_automatico': se registra el cobro y su devolución, sin entradas.
   *  - Reserva cancelada: 409.
   */
  async pagar(c: PoolClient, usuarioId: string, reservaId: string, clave: string): Promise<Resultado> {
    const r = await this.bloquearReserva(c, usuarioId, reservaId);

    const previa = await c.query<{ id: string }>('SELECT id FROM compras WHERE reserva_id = $1', [r.id]);
    if (previa.rowCount) return { status: 200, body: await this.vistaCompra(c, previa.rows[0].id) };

    if (r.estado === 'cancelada') throw new ErrorApi(409, 'reserva_cancelada', 'La reserva fue cancelada');

    let tardio = false;
    if (r.estado === 'activa') {
      // Lo reservado pasa a vendido en un solo UPDATE (la suma no cambia, el CHECK se mantiene).
      await c.query(
        `UPDATE zonas SET reservadas = reservadas - $2, vendidas = vendidas + $2 WHERE id = $1`,
        [r.zona_id, r.cantidad],
      );
    } else {
      tardio = true;
      const recuperado = await this.intentarRecuperar(c, r);
      if (!recuperado) return { status: 200, body: await this.reembolsoAutomatico(c, r, clave) };
    }

    await c.query(`UPDATE reservas SET estado = 'pagada', resuelta_en = now() WHERE id = $1`, [r.id]);
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO compras (usuario_id, evento_id, zona_id, reserva_id, fase_precio_id, cantidad,
                            precio_unitario_centesimos, monto_centesimos, idempotency_key, estado, referencia_pago)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pagada', $10)
       RETURNING id`,
      [r.usuario_id, r.evento_id, r.zona_id, r.id, r.fase_precio_id, r.cantidad,
        r.precio_unitario_centesimos, r.monto_centesimos, clave, `sim-${randomUUID()}`],
    );
    const compraId = rows[0].id;
    await c.query(
      `INSERT INTO entradas (compra_id, evento_id, zona_id, comprador_id, titular_id, estado, precio_centesimos)
       SELECT $1, $2, $3, $4, $4, 'pagada', $5 FROM generate_series(1, $6::int)`,
      [compraId, r.evento_id, r.zona_id, r.usuario_id, r.precio_unitario_centesimos, r.cantidad],
    );
    log('info', 'compra_pagada', { compra: compraId, reserva: r.id, cantidad: r.cantidad, tardio });
    return { status: 201, body: await this.vistaCompra(c, compraId) };
  }

  // ---------------------------------------------------------------------------

  private async bloquearReserva(c: PoolClient, usuarioId: string, reservaId: string): Promise<FilaReserva> {
    const { rows } = await c.query<FilaReserva>(
      `SELECT ${COLUMNAS_RESERVA} FROM reservas WHERE id = $1 AND usuario_id = $2 FOR UPDATE`,
      [reservaId, usuarioId],
    );
    if (!rows[0]) throw new ErrorApi(404, 'reserva_no_encontrada', 'La reserva no existe');
    return rows[0];
  }

  private async tomarCupoCuenta(c: PoolClient, usuarioId: string, eventoId: string, cantidad: number) {
    const { rowCount } = await c.query(
      `INSERT INTO cupo_cuenta (usuario_id, evento_id, usadas)
       SELECT $1, $2, $3 FROM eventos WHERE id = $2 AND $3 <= limite_por_cuenta
       ON CONFLICT (usuario_id, evento_id) DO UPDATE
         SET usadas = cupo_cuenta.usadas + EXCLUDED.usadas
         WHERE cupo_cuenta.usadas + EXCLUDED.usadas <= (SELECT limite_por_cuenta FROM eventos WHERE id = $2)`,
      [usuarioId, eventoId, cantidad],
    );
    if (!rowCount) throw new ErrorApi(409, 'limite_por_cuenta', 'Superas el máximo de entradas por cuenta para este evento');
  }

  private async tomarAforo(c: PoolClient, zonaId: string, cantidad: number, columna: 'reservadas' | 'vendidas') {
    const { rowCount } = await c.query(
      `UPDATE zonas SET ${columna} = ${columna} + $2 WHERE id = $1 AND vendidas + reservadas + $2 <= aforo`,
      [zonaId, cantidad],
    );
    if (!rowCount) throw new ErrorApi(409, 'cupo_agotado', 'No quedan entradas suficientes en esta zona');
  }

  /** Devuelve cupo retenido: primero la cuenta, después la zona (orden de locks). */
  async liberar(c: PoolClient, usuarioId: string, eventoId: string, zonaId: string, cantidad: number) {
    await c.query(
      'UPDATE cupo_cuenta SET usadas = usadas - $3 WHERE usuario_id = $1 AND evento_id = $2',
      [usuarioId, eventoId, cantidad],
    );
    await c.query('UPDATE zonas SET reservadas = reservadas - $2 WHERE id = $1', [zonaId, cantidad]);
  }

  /** Pago tardío: vuelve a tomar cupo de cuenta y aforo directamente como vendido. */
  private async intentarRecuperar(c: PoolClient, r: FilaReserva): Promise<boolean> {
    await c.query('SAVEPOINT recuperar');
    try {
      await this.tomarCupoCuenta(c, r.usuario_id, r.evento_id, r.cantidad);
      await this.tomarAforo(c, r.zona_id, r.cantidad, 'vendidas');
      await c.query('RELEASE SAVEPOINT recuperar');
      return true;
    } catch (e) {
      if (!(e instanceof ErrorApi)) throw e;
      await c.query('ROLLBACK TO SAVEPOINT recuperar');
      return false;
    }
  }

  private async reembolsoAutomatico(c: PoolClient, r: FilaReserva, clave: string) {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO compras (usuario_id, evento_id, zona_id, reserva_id, fase_precio_id, cantidad,
                            precio_unitario_centesimos, monto_centesimos, idempotency_key, estado,
                            referencia_pago, reembolsada_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'reembolso_automatico', $10, now())
       RETURNING id`,
      [r.usuario_id, r.evento_id, r.zona_id, r.id, r.fase_precio_id, r.cantidad,
        r.precio_unitario_centesimos, r.monto_centesimos, clave, `sim-${randomUUID()}`],
    );
    await c.query(
      `INSERT INTO reembolsos (compra_id, monto_centesimos, motivo)
       VALUES ($1, $2, 'Pago recibido después de vencer la reserva y sin cupo disponible')`,
      [rows[0].id, r.monto_centesimos],
    );
    log('warn', 'pago_tardio_reembolsado', { compra: rows[0].id, reserva: r.id });
    return this.vistaCompra(c, rows[0].id);
  }

  private async vistaCompra(c: PoolClient, compraId: string) {
    const { rows } = await c.query(
      `SELECT c.id, c.reserva_id, c.evento_id, c.zona_id, c.cantidad, c.precio_unitario_centesimos,
              c.monto_centesimos, c.estado, c.referencia_pago, c.pagada_en, c.reembolsada_en,
              COALESCE(json_agg(json_build_object('id', e.id, 'estado', e.estado) ORDER BY e.id)
                       FILTER (WHERE e.id IS NOT NULL), '[]') AS entradas
         FROM compras c LEFT JOIN entradas e ON e.compra_id = c.id
        WHERE c.id = $1 GROUP BY c.id`,
      [compraId],
    );
    // bigint llega como string desde pg; los montos reales caben de sobra en un número JS.
    return { ...rows[0], monto_centesimos: Number(rows[0].monto_centesimos) };
  }
}

function vistaReserva(r: FilaReserva) {
  const restantes = Math.max(0, Math.floor((r.expira_en.getTime() - Date.now()) / 1000));
  return {
    id: r.id,
    evento_id: r.evento_id,
    zona_id: r.zona_id,
    cantidad: r.cantidad,
    precio_unitario_centesimos: r.precio_unitario_centesimos,
    monto_centesimos: Number(r.monto_centesimos),
    estado: r.estado,
    creada_en: r.creada_en,
    expira_en: r.expira_en,
    segundos_restantes: r.estado === 'activa' ? restantes : 0,
  };
}
