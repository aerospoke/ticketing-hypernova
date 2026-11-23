import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type { Sesion } from '../auth/tokens';
import { exigirAccesoEvento } from '../common/acceso';
import { contexto, log } from '../common/contexto';
import { ErrorApi } from '../common/errores';
import type { Resultado } from '../compra/idempotencia.service';
import { PG_POOL } from '../db/db.module';
import { publicarRevocacion } from './revocaciones';

interface FilaEntrada {
  id: string;
  compra_id: string;
  evento_id: string;
  zona_id: string;
  comprador_id: string;
  titular_id: string;
  estado: string;
  precio_centesimos: number;
  reembolsable_hasta: Date;
}

/**
 * Reembolsos y anulaciones. Ambos sacan la entrada de circulación y devuelven el cupo
 * a la venta; el reembolso además registra la devolución del dinero.
 *
 * ORDEN DE LOCKS: entradas -> transferencias -> cupo_cuenta -> zonas (compatible con
 * compra: reservas -> cupo_cuenta -> zonas, y con transferencias: entradas -> transferencias).
 *
 * "Nunca después de usada" lo decide un UPDATE condicional: con la entrada 'usada' afecta
 * 0 filas y se responde 409. El escaneo bloquea la misma fila de la entrada, así que un
 * reembolso y un ingreso simultáneos se serializan: gana uno y el otro ve el resultado.
 */
@Injectable()
export class ReembolsosService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** El asistente reembolsa su entrada: debe ser el comprador, seguir siendo titular y estar en plazo. */
  async porAsistente(c: PoolClient, usuarioId: string, entradaId: string): Promise<Resultado> {
    const e = await this.bloquear(c, entradaId);
    if (!e || e.titular_id !== usuarioId) throw new ErrorApi(404, 'entrada_no_encontrada', 'La entrada no existe');
    if (e.comprador_id !== usuarioId) {
      throw new ErrorApi(409, 'solo_el_comprador', 'Solo quien pagó la entrada puede pedir su reembolso');
    }
    if (Date.now() > e.reembolsable_hasta.getTime()) {
      throw new ErrorApi(409, 'fuera_de_plazo', 'Ya pasó la fecha límite de reembolso del evento');
    }
    return this.sacarDeCirculacion(c, e, 'reembolsada', 'Reembolso solicitado por el comprador', null);
  }

  /** Organizador dueño del evento o admin: con motivo; sin fecha límite (nunca si está usada). */
  async porAdministracion(
    c: PoolClient, s: Sesion, entradaId: string, como: 'reembolsada' | 'anulada', motivo: string,
  ): Promise<Resultado> {
    const e = await this.bloquear(c, entradaId);
    if (!e) throw new ErrorApi(404, 'entrada_no_encontrada', 'La entrada no existe');
    await exigirAccesoEvento(c, s, e.evento_id, { staff: false });
    return this.sacarDeCirculacion(c, e, como, motivo, s.usuarioId);
  }

  // ---------------------------------------------------------------------------

  private async bloquear(c: PoolClient, entradaId: string): Promise<FilaEntrada | undefined> {
    const { rows } = await c.query<FilaEntrada>(
      `SELECT e.id, e.compra_id, e.evento_id, e.zona_id, e.comprador_id, e.titular_id, e.estado,
              e.precio_centesimos, ev.reembolsable_hasta
         FROM entradas e JOIN eventos ev ON ev.id = e.evento_id
        WHERE e.id = $1
        FOR UPDATE OF e`,
      [entradaId],
    );
    return rows[0];
  }

  private async sacarDeCirculacion(
    c: PoolClient, e: FilaEntrada, como: 'reembolsada' | 'anulada', motivo: string, autorId: string | null,
  ): Promise<Resultado> {
    // 1. La garantía: solo sale de circulación si está vigente (nunca si ya entró).
    const { rowCount } = await c.query(
      `UPDATE entradas SET estado = $2, anulada_en = now() WHERE id = $1 AND estado IN ('pagada', 'transferida')`,
      [e.id, como],
    );
    if (!rowCount) throw new ErrorApi(409, `entrada_${e.estado}`, `La entrada está ${e.estado}: no se puede ${como === 'reembolsada' ? 'reembolsar' : 'anular'}`);

    // 2. Una transferencia pendiente de esta entrada ya no tiene sentido.
    await c.query(
      `UPDATE transferencias SET estado = 'cancelada', resuelta_en = now() WHERE entrada_id = $1 AND estado = 'pendiente'`,
      [e.id],
    );
    // 3. El cupo vuelve: a la cuenta del comprador y a la venta de la zona.
    await c.query('UPDATE cupo_cuenta SET usadas = usadas - 1 WHERE usuario_id = $1 AND evento_id = $2', [e.comprador_id, e.evento_id]);
    await c.query('UPDATE zonas SET vendidas = vendidas - 1 WHERE id = $1', [e.zona_id]);

    // 4. El dinero (solo reembolso). UNIQUE (entrada_id): imposible reembolsar dos veces.
    if (como === 'reembolsada') {
      await c.query(
        `INSERT INTO reembolsos (compra_id, entrada_id, monto_centesimos, motivo, autor_id) VALUES ($1, $2, $3, $4, $5)`,
        [e.compra_id, e.id, e.precio_centesimos, motivo, autorId],
      );
    }
    // La compra queda 'reembolsada' cuando ya no le queda ninguna entrada vigente.
    await c.query(
      `UPDATE compras SET estado = 'reembolsada', reembolsada_en = now()
        WHERE id = $1 AND estado = 'pagada'
          AND NOT EXISTS (SELECT 1 FROM entradas WHERE compra_id = $1 AND estado IN ('pagada', 'transferida', 'usada'))`,
      [e.compra_id],
    );

    // 5. Los escáneres que sincronicen dejan de aceptarla.
    await publicarRevocacion(c, {
      eventoId: e.evento_id, entradaId: e.id, tipo: 'entrada', motivo: como === 'reembolsada' ? 'reembolso' : 'anulacion',
    });

    // 6. Acciones administrativas: al registro inmutable de auditoría.
    if (autorId) {
      await c.query(
        `INSERT INTO auditoria (actor_id, accion, entidad, entidad_id, detalle, correlacion_id)
         VALUES ($1, $2, 'entrada', $3, $4, $5)`,
        [autorId, como === 'reembolsada' ? 'entrada_reembolsada' : 'entrada_anulada', e.id,
          JSON.stringify({ motivo, monto_centesimos: como === 'reembolsada' ? e.precio_centesimos : 0, evento_id: e.evento_id }),
          contexto.getStore()?.correlacionId ?? null],
      );
    }
    log('info', `entrada_${como}`, { entrada: e.id, autor: autorId ?? 'comprador' });

    return {
      status: 200,
      body: {
        entrada_id: e.id,
        estado: como,
        monto_reembolsado_centesimos: como === 'reembolsada' ? e.precio_centesimos : 0,
        motivo,
      },
    };
  }
}
