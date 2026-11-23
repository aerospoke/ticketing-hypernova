import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import type { Pool } from 'pg';
import { z } from 'zod';
import { Roles, SesionActual } from '../auth/auth.guard';
import type { Sesion } from '../auth/tokens';
import { exigirAccesoEvento } from '../common/acceso';
import { PG_POOL } from '../db/db.module';

const Id = z.string().regex(/^[1-9]\d{0,17}$/, 'id inválido');
const Filtro = z.object({
  estado: z.enum(['abierto', 'resuelto']).optional(),
  cursor: Id.optional(),
});
const PAGINA = 50;

/**
 * Portal de administración. Cada ruta valida en el servidor que el evento sea del
 * organizador (o que sea admin): probar con el id de un evento ajeno da 404.
 */
@Roles('organizador', 'admin')
@Controller('admin')
export class AdminController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Incidentes del evento (doble ingreso, firma inválida, escáner desincronizado...). */
  @Get('eventos/:id/incidentes')
  async incidentes(
    @SesionActual() s: Sesion,
    @Param('id', { schema: Id }) eventoId: string,
    @Query({ schema: Filtro }) q: z.infer<typeof Filtro>,
  ) {
    await exigirAccesoEvento(this.pool, s, eventoId, { staff: false });
    const { rows } = await this.pool.query(
      `SELECT i.id, i.tipo, i.estado, i.entrada_id, i.ingreso_id, i.dispositivo_id, i.detalle, i.creado_en,
              p.nombre AS puerta
         FROM incidentes i
         LEFT JOIN ingresos g ON g.id = i.ingreso_id
         LEFT JOIN puertas p ON p.id = g.puerta_id
        WHERE i.evento_id = $1 AND ($2::text IS NULL OR i.estado = $2) AND ($3::bigint IS NULL OR i.id < $3)
        ORDER BY i.id DESC
        LIMIT $4`,
      [eventoId, q.estado ?? null, q.cursor ?? null, PAGINA + 1],
    );
    const hayMas = rows.length > PAGINA;
    const items = rows.slice(0, PAGINA);
    return { items, siguiente_cursor: hayMas ? items.at(-1).id : null };
  }
}
