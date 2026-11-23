import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import type { Sesion } from '../auth/tokens';
import { exigirAccesoEvento } from '../common/acceso';
import { auditar } from '../common/auditoria';
import { ErrorApi } from '../common/errores';
import { traducirPg } from '../common/pg-errores';
import { PG_POOL } from '../db/db.module';
import { enTransaccion } from '../db/transaccion';

export interface DatosEvento {
  codigo: string;
  nombre: string;
  recinto: string;
  fecha: string;
  venta_abre: string;
  reembolsable_hasta: string;
  limite_por_cuenta: number;
  estado?: 'borrador' | 'publicado' | 'cancelado';
  organizador_id?: string;
}
export interface DatosFase {
  fase: 'preventa' | 'general' | 'taquilla';
  precio_centesimos: number;
  desde: string;
  hasta: string;
}

// Columnas editables por PATCH (lista blanca: el nombre de columna nunca viene del cliente).
const EDITABLES_EVENTO = ['nombre', 'recinto', 'fecha', 'venta_abre', 'reembolsable_hasta', 'limite_por_cuenta', 'estado'] as const;
const EDITABLES_ZONA = ['nombre', 'aforo'] as const;
const EDITABLES_FASE = ['precio_centesimos', 'desde', 'hasta'] as const;

/**
 * Administración de eventos, zonas, fases, puertas y staff.
 *
 * Cada operación: (1) verifica en el servidor que el evento sea del organizador (o admin)
 * -> un evento ajeno responde 404 igual que uno inexistente; (2) aplica el cambio dejando
 * que la base imponga las reglas (CHECK de aforo, EXCLUDE de fases, UNIQUE de nombres),
 * traducidas a 409/400 legibles; (3) lo registra en la auditoría en la misma transacción.
 */
@Injectable()
export class AdminEventosService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Eventos propios (admin: todos) con un resumen de ventas por evento. */
  async listar(s: Sesion) {
    const { rows } = await this.pool.query(
      `SELECT e.id, e.codigo, e.nombre, e.recinto, e.fecha, e.venta_abre, e.estado, e.organizador_id,
              COALESCE(sum(z.aforo), 0)::int AS aforo, COALESCE(sum(z.vendidas), 0)::int AS vendidas,
              COALESCE(sum(z.reservadas), 0)::int AS reservadas,
              COALESCE(sum(z.aforo - z.vendidas - z.reservadas), 0)::int AS disponibles
         FROM eventos e LEFT JOIN zonas z ON z.evento_id = e.id
        WHERE $1::bigint IS NULL OR e.organizador_id = $1
        GROUP BY e.id
        ORDER BY e.fecha DESC`,
      [s.rol === 'admin' ? null : s.usuarioId],
    );
    return rows;
  }

  async detalle(s: Sesion, eventoId: string) {
    await exigirAccesoEvento(this.pool, s, eventoId, { staff: false });
    const { rows } = await this.pool.query(
      `SELECT e.*,
              COALESCE((SELECT json_agg(json_build_object(
                  'id', z.id::text, 'nombre', z.nombre, 'aforo', z.aforo, 'vendidas', z.vendidas, 'reservadas', z.reservadas,
                  'fases', COALESCE((SELECT json_agg(json_build_object('id', f.id::text, 'fase', f.fase,
                              'precio_centesimos', f.precio_centesimos, 'desde', f.desde, 'hasta', f.hasta) ORDER BY f.desde)
                            FROM fases_precio f WHERE f.zona_id = z.id), '[]')) ORDER BY z.id)
                 FROM zonas z WHERE z.evento_id = e.id), '[]') AS zonas,
              COALESCE((SELECT json_agg(json_build_object('id', p.id::text, 'nombre', p.nombre) ORDER BY p.id)
                 FROM puertas p WHERE p.evento_id = e.id), '[]') AS puertas,
              COALESCE((SELECT json_agg(json_build_object('id', u.id::text, 'nombre', u.nombre, 'email', u.email) ORDER BY u.id)
                 FROM asignaciones_staff a JOIN usuarios u ON u.id = a.staff_id WHERE a.evento_id = e.id), '[]') AS staff
         FROM eventos e WHERE e.id = $1`,
      [eventoId],
    );
    return rows[0];
  }

  async crearEvento(s: Sesion, d: DatosEvento) {
    // Un organizador crea eventos propios; el admin indica para qué organizador.
    let organizador = s.usuarioId;
    if (s.rol === 'admin') {
      if (!d.organizador_id) throw new ErrorApi(400, 'falta_organizador', 'El admin debe indicar organizador_id');
      organizador = d.organizador_id;
    }
    return this.tx(async (c) => {
      const org = await c.query(`SELECT 1 FROM usuarios WHERE id = $1 AND rol = 'organizador' AND activo`, [organizador]);
      if (!org.rowCount) throw new ErrorApi(404, 'organizador_no_encontrado', 'El organizador no existe');
      const { rows } = await c.query(
        `INSERT INTO eventos (codigo, nombre, organizador_id, recinto, fecha, venta_abre, reembolsable_hasta, limite_por_cuenta, estado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [d.codigo, d.nombre, organizador, d.recinto, d.fecha, d.venta_abre, d.reembolsable_hasta, d.limite_por_cuenta, d.estado ?? 'borrador'],
      );
      await auditar(c, s.usuarioId, 'evento_creado', 'evento', rows[0].id, { ...d, organizador_id: organizador });
      return rows[0];
    });
  }

  async actualizarEvento(s: Sesion, eventoId: string, cambios: Partial<DatosEvento>) {
    return this.tx(async (c) => {
      await exigirAccesoEvento(c, s, eventoId, { staff: false });
      return this.actualizar(c, s, 'eventos', 'evento', eventoId, EDITABLES_EVENTO, cambios);
    });
  }

  async crearZona(s: Sesion, eventoId: string, nombre: string, aforo: number) {
    return this.tx(async (c) => {
      await exigirAccesoEvento(c, s, eventoId, { staff: false });
      const { rows } = await c.query(
        'INSERT INTO zonas (evento_id, nombre, aforo) VALUES ($1, $2, $3) RETURNING *',
        [eventoId, nombre, aforo],
      );
      await auditar(c, s.usuarioId, 'zona_creada', 'zona', rows[0].id, { evento_id: eventoId, nombre, aforo });
      return rows[0];
    });
  }

  /** Bajar el aforo por debajo de vendidas + reservadas lo rechaza el CHECK de la tabla. */
  async actualizarZona(s: Sesion, zonaId: string, cambios: { nombre?: string; aforo?: number }) {
    return this.tx(async (c) => {
      await this.exigirPorPadre(c, s, 'SELECT evento_id FROM zonas WHERE id = $1', zonaId, 'zona_no_encontrada');
      return this.actualizar(c, s, 'zonas', 'zona', zonaId, EDITABLES_ZONA, cambios);
    });
  }

  async crearFase(s: Sesion, zonaId: string, d: DatosFase) {
    return this.tx(async (c) => {
      await this.exigirPorPadre(c, s, 'SELECT evento_id FROM zonas WHERE id = $1', zonaId, 'zona_no_encontrada');
      const { rows } = await c.query(
        `INSERT INTO fases_precio (zona_id, fase, precio_centesimos, desde, hasta) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [zonaId, d.fase, d.precio_centesimos, d.desde, d.hasta],
      );
      await auditar(c, s.usuarioId, 'fase_creada', 'fase_precio', rows[0].id, { zona_id: zonaId, ...d });
      return rows[0];
    });
  }

  /** Cambiar el precio no afecta reservas existentes: su precio quedó congelado al reservar. */
  async actualizarFase(s: Sesion, faseId: string, cambios: Partial<DatosFase>) {
    return this.tx(async (c) => {
      await this.exigirPorPadre(
        c, s, 'SELECT z.evento_id FROM fases_precio f JOIN zonas z ON z.id = f.zona_id WHERE f.id = $1', faseId, 'fase_no_encontrada',
      );
      return this.actualizar(c, s, 'fases_precio', 'fase_precio', faseId, EDITABLES_FASE, cambios);
    });
  }

  async crearPuerta(s: Sesion, eventoId: string, nombre: string) {
    return this.tx(async (c) => {
      await exigirAccesoEvento(c, s, eventoId, { staff: false });
      const { rows } = await c.query('INSERT INTO puertas (evento_id, nombre) VALUES ($1, $2) RETURNING *', [eventoId, nombre]);
      await auditar(c, s.usuarioId, 'puerta_creada', 'puerta', rows[0].id, { evento_id: eventoId, nombre });
      return rows[0];
    });
  }

  /** Solo staff del mismo organizador que el evento. */
  async asignarStaff(s: Sesion, eventoId: string, staffId: string, asignar: boolean) {
    return this.tx(async (c) => {
      await exigirAccesoEvento(c, s, eventoId, { staff: false });
      if (asignar) {
        const ok = await c.query(
          `SELECT 1 FROM usuarios u JOIN eventos e ON e.id = $1
            WHERE u.id = $2 AND u.rol = 'staff' AND u.activo AND u.organizador_id = e.organizador_id`,
          [eventoId, staffId],
        );
        if (!ok.rowCount) throw new ErrorApi(404, 'staff_no_encontrado', 'No hay staff de este organizador con ese id');
        await c.query('INSERT INTO asignaciones_staff (evento_id, staff_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [eventoId, staffId]);
      } else {
        await c.query('DELETE FROM asignaciones_staff WHERE evento_id = $1 AND staff_id = $2', [eventoId, staffId]);
      }
      await auditar(c, s.usuarioId, asignar ? 'staff_asignado' : 'staff_quitado', 'evento', eventoId, { staff_id: staffId });
      return { evento_id: eventoId, staff_id: staffId, asignado: asignar };
    });
  }

  // ---------------------------------------------------------------------------

  private tx<T>(fn: (c: PoolClient) => Promise<T>) {
    return traducirPg(() => enTransaccion(this.pool, fn));
  }

  /** Resuelve el evento dueño de una zona o fase y exige acceso a él (404 si no). */
  private async exigirPorPadre(c: PoolClient, s: Sesion, sql: string, id: string, codigo: string) {
    const { rows } = await c.query<{ evento_id: string }>(sql, [id]);
    if (!rows[0]) throw new ErrorApi(404, codigo, 'No existe o no tienes acceso');
    await exigirAccesoEvento(c, s, rows[0].evento_id, { staff: false }).catch(() => {
      throw new ErrorApi(404, codigo, 'No existe o no tienes acceso');
    });
  }

  /** UPDATE parcial con columnas de lista blanca; audita el antes y el después. */
  private async actualizar(
    c: PoolClient, s: Sesion, tabla: string, entidad: string, id: string,
    permitidas: readonly string[], cambios: Record<string, unknown>,
  ) {
    const cols = permitidas.filter((k) => cambios[k] !== undefined);
    if (cols.length === 0) throw new ErrorApi(400, 'sin_cambios', 'No hay campos para actualizar');
    const antes = await c.query(`SELECT ${cols.join(', ')} FROM ${tabla} WHERE id = $1 FOR UPDATE`, [id]);
    const sets = cols.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const { rows } = await c.query(`UPDATE ${tabla} SET ${sets} WHERE id = $1 RETURNING *`, [id, ...cols.map((k) => cambios[k])]);
    await auditar(c, s.usuarioId, `${entidad}_actualizado`, entidad, id, {
      antes: antes.rows[0], despues: Object.fromEntries(cols.map((k) => [k, cambios[k]])),
    });
    return rows[0];
  }
}
