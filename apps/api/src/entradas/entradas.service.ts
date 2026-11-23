import { Inject, Injectable } from '@nestjs/common';
import { desdeBase64url, TOKEN_ROTACION_SEGUNDOS, VENTANA_SEGUNDOS } from '@ticketing/shared';
import type { Pool, PoolClient } from 'pg';
import { log } from '../common/contexto';
import { ErrorApi } from '../common/errores';
import { PG_POOL } from '../db/db.module';
import { enTransaccion } from '../db/transaccion';
import { FIRMA_ENTRADAS, type FirmaEntradas } from './firma';
import { publicarRevocacion } from './revocaciones';

const VIGENTES = ['pagada', 'transferida'];
const PAGINA = 50;
// La credencial vale hasta unas horas después del inicio del evento.
const GRACIA_CREDENCIAL_S = 12 * 3600;

interface FilaEntrada {
  id: string;
  evento_id: string;
  zona_id: string;
  comprador_id: string;
  titular_id: string;
  estado: string;
  version: number;
  dispositivo_pubkey: Buffer | null;
  fecha_evento: Date;
}

/**
 * Entradas: billetera, material del código rotativo y transferencias.
 *
 * ORDEN DE LOCKS: entradas -> transferencias, en todos los caminos (también en aceptar,
 * que primero averigua la entrada y la bloquea antes que la transferencia). El reembolso
 * seguirá el mismo orden, así una transferencia y un reembolso simultáneos no se trancan.
 */
@Injectable()
export class EntradasService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(FIRMA_ENTRADAS) private readonly firma: FirmaEntradas,
  ) {}

  /** Billetera: entradas cuyo titular es el usuario. Paginación por cursor (id descendente). */
  async misEntradas(usuarioId: string, cursor?: string) {
    const { rows } = await this.pool.query(
      `SELECT e.id, e.estado, e.version, e.evento_id, ev.nombre AS evento, ev.fecha, ev.recinto,
              e.zona_id, z.nombre AS zona, e.precio_centesimos, e.emitida_en, e.usada_en,
              (e.comprador_id <> e.titular_id) AS recibida_por_transferencia,
              t.id AS transferencia_pendiente_id
         FROM entradas e
         JOIN eventos ev ON ev.id = e.evento_id
         JOIN zonas z ON z.id = e.zona_id
         LEFT JOIN transferencias t ON t.entrada_id = e.id AND t.estado = 'pendiente'
        WHERE e.titular_id = $1 AND ($2::bigint IS NULL OR e.id < $2)
        ORDER BY e.id DESC
        LIMIT $3`,
      [usuarioId, cursor ?? null, PAGINA + 1],
    );
    const hayMas = rows.length > PAGINA;
    const items = rows.slice(0, PAGINA);
    return { items, siguiente_cursor: hayMas ? items.at(-1).id : null };
  }

  /**
   * Material para el código rotativo. El teléfono manda la llave PÚBLICA de su par
   * Ed25519 (la privada nunca sale del dispositivo). Si es otro dispositivo que el
   * vinculado, sube la versión y la credencial del dispositivo anterior queda revocada:
   * una entrada vale en un solo teléfono a la vez.
   */
  async material(usuarioId: string, entradaId: string, pubkeyB64: string) {
    const pubkey = Buffer.from(desdeBase64url(pubkeyB64));
    if (pubkey.length !== 32) throw new ErrorApi(400, 'llave_invalida', 'La llave del dispositivo debe ser Ed25519 (32 bytes)');

    return enTransaccion(this.pool, async (c) => {
      const e = await this.bloquearPropia(c, usuarioId, entradaId);
      if (!VIGENTES.includes(e.estado)) {
        throw new ErrorApi(409, `entrada_${e.estado}`, `La entrada está ${e.estado}: no genera código`);
      }

      let version = e.version;
      if (!e.dispositivo_pubkey || !e.dispositivo_pubkey.equals(pubkey)) {
        if (e.dispositivo_pubkey) {
          version += 1;
          await publicarRevocacion(c, {
            eventoId: e.evento_id, entradaId: e.id, tipo: 'version', versionMinima: version, motivo: 'dispositivo',
          });
          log('info', 'entrada_cambio_dispositivo', { entrada: e.id, version });
        }
        await c.query('UPDATE entradas SET dispositivo_pubkey = $2, version = $3 WHERE id = $1', [e.id, pubkey, version]);
      }

      const exp = Math.floor(e.fecha_evento.getTime() / 1000) + GRACIA_CREDENCIAL_S;
      const material = this.firma.firmar({
        v: 1, e: e.id, ev: e.evento_id, z: e.zona_id, ver: version, pk: pubkey.toString('base64url'), exp,
      });
      return {
        ...material,
        version,
        expira_en: new Date(exp * 1000).toISOString(),
        rotacion_segundos: TOKEN_ROTACION_SEGUNDOS,
        ventana_segundos: VENTANA_SEGUNDOS,
      };
    });
  }

  /** Inicia una transferencia por correo. La entrada cambia de dueño recién al aceptar. */
  async transferir(usuarioId: string, entradaId: string, email: string) {
    return enTransaccion(this.pool, async (c) => {
      const e = await this.bloquearPropia(c, usuarioId, entradaId);
      if (!VIGENTES.includes(e.estado)) {
        throw new ErrorApi(409, `entrada_${e.estado}`, `No se puede transferir una entrada ${e.estado}`);
      }
      const destino = await c.query<{ id: string }>(
        `SELECT id FROM usuarios WHERE email = $1 AND rol = 'asistente' AND activo`,
        [email],
      );
      if (!destino.rows[0]) throw new ErrorApi(404, 'destinatario_no_encontrado', 'No hay una cuenta de asistente con ese correo');
      if (destino.rows[0].id === usuarioId) throw new ErrorApi(409, 'transferencia_a_si_mismo', 'No puedes transferirte una entrada a ti mismo');

      // El índice único parcial (una pendiente por entrada) es la garantía; el ON CONFLICT
      // convierte el choque en un 409 claro en lugar de un error de la base.
      const { rows } = await c.query(
        `INSERT INTO transferencias (entrada_id, de_usuario_id, a_usuario_id) VALUES ($1, $2, $3)
         ON CONFLICT (entrada_id) WHERE estado = 'pendiente' DO NOTHING
         RETURNING id, entrada_id, estado, creada_en`,
        [e.id, usuarioId, destino.rows[0].id],
      );
      if (!rows[0]) throw new ErrorApi(409, 'transferencia_pendiente', 'La entrada ya tiene una transferencia pendiente');
      log('info', 'transferencia_creada', { transferencia: rows[0].id, entrada: e.id });
      return { ...rows[0], a_email: email };
    });
  }

  /**
   * Aceptar: el destinatario pasa a ser titular, la versión sube y se revoca la anterior.
   * Desde que el escáner sincroniza, el código del dueño anterior deja de servir.
   */
  async aceptar(usuarioId: string, transferenciaId: string) {
    return enTransaccion(this.pool, async (c) => {
      const t = await this.bloquearTransferencia(c, transferenciaId, 'a_usuario_id', usuarioId);
      const { rows } = await c.query<FilaEntrada>(
        `SELECT id, evento_id, comprador_id, titular_id, estado, version FROM entradas WHERE id = $1`,
        [t.entrada_id],
      );
      const e = rows[0];
      // La entrada pudo cambiar mientras la transferencia esperaba (reembolso, uso...).
      if (e.titular_id !== t.de_usuario_id || !VIGENTES.includes(e.estado)) {
        await c.query(`UPDATE transferencias SET estado = 'cancelada', resuelta_en = now() WHERE id = $1`, [t.id]);
        throw new ErrorApi(409, 'transferencia_invalida', 'La entrada ya no se puede transferir');
      }
      const version = e.version + 1;
      await c.query(
        `UPDATE entradas
            SET titular_id = $2, version = $3, dispositivo_pubkey = NULL,
                estado = CASE WHEN comprador_id = $2 THEN 'pagada' ELSE 'transferida' END
          WHERE id = $1`,
        [e.id, usuarioId, version],
      );
      await c.query(`UPDATE transferencias SET estado = 'aceptada', resuelta_en = now() WHERE id = $1`, [t.id]);
      await publicarRevocacion(c, {
        eventoId: e.evento_id, entradaId: e.id, tipo: 'version', versionMinima: version, motivo: 'transferencia',
      });
      log('info', 'transferencia_aceptada', { transferencia: t.id, entrada: e.id, version });
      return { id: t.id, entrada_id: e.id, estado: 'aceptada', version };
    });
  }

  /** El emisor cancela o el destinatario rechaza una transferencia pendiente. */
  async resolverSinAceptar(usuarioId: string, transferenciaId: string, como: 'cancelada' | 'rechazada') {
    return enTransaccion(this.pool, async (c) => {
      const t = await this.bloquearTransferencia(
        c, transferenciaId, como === 'cancelada' ? 'de_usuario_id' : 'a_usuario_id', usuarioId,
      );
      await c.query(`UPDATE transferencias SET estado = $2, resuelta_en = now() WHERE id = $1`, [t.id, como]);
      return { id: t.id, entrada_id: t.entrada_id, estado: como };
    });
  }

  /** Historial de compras del usuario (paginación por cursor), con sus entradas y reembolsos. */
  async misCompras(usuarioId: string, cursor?: string) {
    const { rows } = await this.pool.query(
      `SELECT c.id, c.evento_id, ev.nombre AS evento, z.nombre AS zona, c.cantidad, c.precio_unitario_centesimos,
              c.monto_centesimos::text AS monto_centesimos, c.estado, c.pagada_en, c.reembolsada_en,
              COALESCE((SELECT sum(r.monto_centesimos) FROM reembolsos r WHERE r.compra_id = c.id), 0)::text
                AS reembolsado_centesimos,
              (SELECT json_agg(json_build_object('id', e.id::text, 'estado', e.estado) ORDER BY e.id)
                 FROM entradas e WHERE e.compra_id = c.id) AS entradas
         FROM compras c
         JOIN eventos ev ON ev.id = c.evento_id
         JOIN zonas z ON z.id = c.zona_id
        WHERE c.usuario_id = $1 AND ($2::bigint IS NULL OR c.id < $2)
        ORDER BY c.id DESC
        LIMIT $3`,
      [usuarioId, cursor ?? null, PAGINA + 1],
    );
    const hayMas = rows.length > PAGINA;
    const items = rows.slice(0, PAGINA).map((r) => ({
      ...r,
      monto_centesimos: Number(r.monto_centesimos),
      reembolsado_centesimos: Number(r.reembolsado_centesimos),
      entradas: r.entradas ?? [],
    }));
    return { items, siguiente_cursor: hayMas ? items.at(-1)!.id : null };
  }

  async misTransferencias(usuarioId: string) {
    const { rows } = await this.pool.query(
      `SELECT t.id, t.entrada_id, t.estado, t.creada_en, t.resuelta_en,
              CASE WHEN t.de_usuario_id = $1 THEN 'enviada' ELSE 'recibida' END AS direccion,
              de.email AS de_email, a.email AS a_email, ev.nombre AS evento
         FROM transferencias t
         JOIN usuarios de ON de.id = t.de_usuario_id
         JOIN usuarios a ON a.id = t.a_usuario_id
         JOIN entradas e ON e.id = t.entrada_id
         JOIN eventos ev ON ev.id = e.evento_id
        WHERE t.de_usuario_id = $1 OR t.a_usuario_id = $1
        ORDER BY t.creada_en DESC
        LIMIT 100`,
      [usuarioId],
    );
    return rows;
  }

  // ---------------------------------------------------------------------------

  private async bloquearPropia(c: PoolClient, usuarioId: string, entradaId: string): Promise<FilaEntrada> {
    const { rows } = await c.query<FilaEntrada>(
      `SELECT e.id, e.evento_id, e.zona_id, e.comprador_id, e.titular_id, e.estado, e.version,
              e.dispositivo_pubkey, ev.fecha AS fecha_evento
         FROM entradas e JOIN eventos ev ON ev.id = e.evento_id
        WHERE e.id = $1 AND e.titular_id = $2
        FOR UPDATE OF e`,
      [entradaId, usuarioId],
    );
    // Entrada ajena = inexistente: no se revela que existe.
    if (!rows[0]) throw new ErrorApi(404, 'entrada_no_encontrada', 'La entrada no existe');
    return rows[0];
  }

  /**
   * Bloquea entrada y transferencia EN ESE ORDEN. Primero se lee (sin lock) a qué entrada
   * pertenece la transferencia, se bloquea la entrada, y recién después la transferencia,
   * revalidando que siga pendiente y sea del usuario.
   */
  private async bloquearTransferencia(
    c: PoolClient, transferenciaId: string, columnaUsuario: 'de_usuario_id' | 'a_usuario_id', usuarioId: string,
  ) {
    const previa = await c.query<{ entrada_id: string }>(
      `SELECT entrada_id FROM transferencias WHERE id = $1 AND ${columnaUsuario} = $2`,
      [transferenciaId, usuarioId],
    );
    if (!previa.rows[0]) throw new ErrorApi(404, 'transferencia_no_encontrada', 'La transferencia no existe');
    await c.query('SELECT 1 FROM entradas WHERE id = $1 FOR UPDATE', [previa.rows[0].entrada_id]);
    const { rows } = await c.query<{ id: string; entrada_id: string; de_usuario_id: string; estado: string }>(
      `SELECT id, entrada_id, de_usuario_id, estado FROM transferencias WHERE id = $1 FOR UPDATE`,
      [transferenciaId],
    );
    if (rows[0].estado !== 'pendiente') {
      throw new ErrorApi(409, `transferencia_${rows[0].estado}`, `La transferencia ya está ${rows[0].estado}`);
    }
    return rows[0];
  }
}
