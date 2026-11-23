import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { Sesion } from '../auth/tokens';
import { exigirAccesoEvento } from '../common/acceso';
import { auditar } from '../common/auditoria';
import { ErrorApi } from '../common/errores';
import { PG_POOL } from '../db/db.module';
import { enTransaccion } from '../db/transaccion';

const PAGINA = 50;

/** Reportes del portal. Todo de solo lectura salvo resolver incidentes. */
@Injectable()
export class ReportesService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Ventas por zona en tiempo casi real. Los contadores salen de `zonas` (proyección
   * mantenida por cada transacción); el dinero, de compras y reembolsos.
   */
  async ventas(s: Sesion, eventoId: string) {
    await exigirAccesoEvento(this.pool, s, eventoId, { staff: false });
    const { rows } = await this.pool.query(
      `SELECT z.id, z.nombre, z.aforo, z.vendidas, z.reservadas, z.aforo - z.vendidas - z.reservadas AS disponibles,
              (SELECT f.precio_centesimos FROM fases_precio f WHERE f.zona_id = z.id AND f.desde <= now() AND now() < f.hasta) AS precio_vigente,
              COALESCE((SELECT sum(c.monto_centesimos) FROM compras c WHERE c.zona_id = z.id AND c.estado <> 'reembolso_automatico'), 0)::bigint AS cobrado,
              COALESCE((SELECT sum(r.monto_centesimos) FROM reembolsos r JOIN compras c ON c.id = r.compra_id
                         WHERE c.zona_id = z.id AND r.entrada_id IS NOT NULL), 0)::bigint AS reembolsado,
              (SELECT count(*) FROM entradas e WHERE e.zona_id = z.id AND e.estado = 'usada')::int AS ingresaron
         FROM zonas z WHERE z.evento_id = $1 ORDER BY z.id`,
      [eventoId],
    );
    const zonas = rows.map((r) => ({
      ...r,
      cobrado_centesimos: Number(r.cobrado),
      reembolsado_centesimos: Number(r.reembolsado),
      neto_centesimos: Number(r.cobrado) - Number(r.reembolsado),
      cobrado: undefined,
      reembolsado: undefined,
    }));
    const total = (k: string) => zonas.reduce((a, z) => a + Number((z as Record<string, unknown>)[k] ?? 0), 0);
    return {
      consultado_en: new Date().toISOString(),
      zonas,
      totales: {
        aforo: total('aforo'), vendidas: total('vendidas'), reservadas: total('reservadas'), disponibles: total('disponibles'),
        cobrado_centesimos: total('cobrado_centesimos'), reembolsado_centesimos: total('reembolsado_centesimos'),
        neto_centesimos: total('neto_centesimos'), ingresaron: total('ingresaron'),
      },
    };
  }

  /** Accesos: por puerta, por hora, aforo dentro del recinto y estado de los dispositivos. */
  async accesos(s: Sesion, eventoId: string) {
    await exigirAccesoEvento(this.pool, s, eventoId, { staff: false });
    const [puertas, horas, dispositivos] = await Promise.all([
      this.pool.query(
        `SELECT p.id, p.nombre,
                count(i.id) FILTER (WHERE i.resultado = 'valido')::int AS validos,
                count(i.id) FILTER (WHERE i.resultado = 'duplicado_offline')::int AS duplicados,
                count(i.id) FILTER (WHERE i.resultado = 'rechazado')::int AS rechazados
           FROM puertas p LEFT JOIN ingresos i ON i.puerta_id = p.id
          WHERE p.evento_id = $1 GROUP BY p.id ORDER BY p.id`,
        [eventoId],
      ),
      this.pool.query(
        `SELECT date_trunc('hour', escaneado_en) AS hora, count(*)::int AS validos
           FROM ingresos WHERE evento_id = $1 AND resultado = 'valido'
          GROUP BY 1 ORDER BY 1`,
        [eventoId],
      ),
      this.pool.query(
        `SELECT d.id, d.nombre, u.nombre AS staff, d.ultima_sync,
                floor(extract(epoch FROM now() - d.ultima_sync) / 60)::int AS minutos_sin_sync, p.nombre AS puerta, (t.fin IS NULL) AS turno_abierto,
                (SELECT count(*) FROM ingresos i WHERE i.dispositivo_id = d.id AND i.evento_id = $1)::int AS escaneos
           FROM turnos t
           JOIN dispositivos d ON d.id = t.dispositivo_id
           JOIN usuarios u ON u.id = t.staff_id
           JOIN puertas p ON p.id = t.puerta_id
          WHERE t.evento_id = $1
            AND t.inicio = (SELECT max(t2.inicio) FROM turnos t2 WHERE t2.dispositivo_id = t.dispositivo_id AND t2.evento_id = $1)
          ORDER BY d.ultima_sync DESC NULLS LAST`,
        [eventoId],
      ),
    ]);
    const dentro = puertas.rows.reduce((a, p) => a + p.validos, 0);
    return { dentro_del_recinto: dentro, por_puerta: puertas.rows, por_hora: horas.rows, dispositivos: dispositivos.rows };
  }

  /** Buscar entradas por correo o nombre del comprador o del titular. Cursor por id. */
  async entradas(s: Sesion, eventoId: string, q: string | undefined, cursor: string | undefined) {
    await exigirAccesoEvento(this.pool, s, eventoId, { staff: false });
    const patron = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
    const { rows } = await this.pool.query(
      `SELECT e.id, e.estado, e.version, z.nombre AS zona, e.precio_centesimos, e.emitida_en, e.usada_en,
              c.email AS comprador_email, c.nombre AS comprador, t.email AS titular_email, t.nombre AS titular
         FROM entradas e
         JOIN zonas z ON z.id = e.zona_id
         JOIN usuarios c ON c.id = e.comprador_id
         JOIN usuarios t ON t.id = e.titular_id
        WHERE e.evento_id = $1
          AND ($2::text IS NULL OR c.email ILIKE $2 OR c.nombre ILIKE $2 OR t.email ILIKE $2 OR t.nombre ILIKE $2 OR e.id::text = $3)
          AND ($4::bigint IS NULL OR e.id < $4)
        ORDER BY e.id DESC
        LIMIT $5`,
      [eventoId, patron, q ?? null, cursor ?? null, PAGINA + 1],
    );
    const hayMas = rows.length > PAGINA;
    const items = rows.slice(0, PAGINA);
    return { items, siguiente_cursor: hayMas ? items.at(-1).id : null };
  }

  /** Auditoría: el admin ve todo; un organizador, las acciones que hizo él. */
  async auditoria(s: Sesion, cursor: string | undefined) {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.accion, a.entidad, a.entidad_id, a.detalle, a.creado_en, a.correlacion_id,
              u.email AS actor_email, u.rol AS actor_rol
         FROM auditoria a LEFT JOIN usuarios u ON u.id = a.actor_id
        WHERE ($1::bigint IS NULL OR a.actor_id = $1) AND ($2::bigint IS NULL OR a.id < $2)
        ORDER BY a.id DESC
        LIMIT $3`,
      [s.rol === 'admin' ? null : s.usuarioId, cursor ?? null, PAGINA + 1],
    );
    const hayMas = rows.length > PAGINA;
    const items = rows.slice(0, PAGINA);
    return { items, siguiente_cursor: hayMas ? items.at(-1).id : null };
  }

  async resolverIncidente(s: Sesion, incidenteId: string, nota: string) {
    return enTransaccion(this.pool, async (c) => {
      const { rows } = await c.query<{ evento_id: string; estado: string }>(
        'SELECT evento_id, estado FROM incidentes WHERE id = $1 FOR UPDATE',
        [incidenteId],
      );
      if (!rows[0]) throw new ErrorApi(404, 'incidente_no_encontrado', 'El incidente no existe');
      await exigirAccesoEvento(c, s, rows[0].evento_id, { staff: false }).catch(() => {
        throw new ErrorApi(404, 'incidente_no_encontrado', 'El incidente no existe');
      });
      if (rows[0].estado === 'resuelto') throw new ErrorApi(409, 'incidente_resuelto', 'El incidente ya estaba resuelto');
      await c.query(
        `UPDATE incidentes SET estado = 'resuelto', resuelto_en = now(), resuelto_por = $2,
                detalle = detalle || jsonb_build_object('nota_resolucion', $3::text)
          WHERE id = $1`,
        [incidenteId, s.usuarioId, nota],
      );
      await auditar(c, s.usuarioId, 'incidente_resuelto', 'incidente', incidenteId, { nota, evento_id: rows[0].evento_id });
      return { id: incidenteId, estado: 'resuelto' };
    });
  }
}
