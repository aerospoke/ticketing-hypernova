import { Body, Controller, Get, Headers, Inject, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { Roles, SesionActual } from '../auth/auth.guard';
import type { Sesion } from '../auth/tokens';
import { exigirAccesoEvento } from '../common/acceso';
import { exigirClave, IdempotenciaService, responder } from '../compra/idempotencia.service';
import { PG_POOL } from '../db/db.module';
import { ReembolsosService } from '../entradas/reembolsos.service';

const Id = z.string().regex(/^[1-9]\d{0,17}$/, 'id inválido');
const Filtro = z.object({
  estado: z.enum(['abierto', 'resuelto']).optional(),
  cursor: Id.optional(),
});
const PAGINA = 50;
// Motivo obligatorio: queda en el reembolso y en la auditoría.
const ConMotivo = z.object({ motivo: z.string().trim().min(3).max(500) });

/**
 * Portal de administración. Cada ruta valida en el servidor que el evento sea del
 * organizador (o que sea admin): probar con el id de un evento ajeno da 404.
 */
@Roles('organizador', 'admin')
@Controller('admin')
export class AdminController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly reembolsos: ReembolsosService,
    private readonly idem: IdempotenciaService,
  ) {}

  /** Reembolso administrativo (con motivo y autor). Sin fecha límite; nunca si está usada. */
  @Post('entradas/:id/reembolso')
  async reembolsar(
    @SesionActual() s: Sesion,
    @Headers('idempotency-key') clave: string | undefined,
    @Param('id', { schema: Id }) id: string,
    @Body({ schema: ConMotivo }) b: z.infer<typeof ConMotivo>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const k = exigirClave(clave);
    const r = await this.idem.ejecutar(s.usuarioId, 'admin_reembolsar', k, { id, motivo: b.motivo }, (c) =>
      this.reembolsos.porAdministracion(c, s, id, 'reembolsada', b.motivo),
    );
    return responder(res, r);
  }

  /** Anulación (sin devolución de dinero), p. ej. por fraude. Con motivo y autor. */
  @Post('entradas/:id/anular')
  async anular(
    @SesionActual() s: Sesion,
    @Headers('idempotency-key') clave: string | undefined,
    @Param('id', { schema: Id }) id: string,
    @Body({ schema: ConMotivo }) b: z.infer<typeof ConMotivo>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const k = exigirClave(clave);
    const r = await this.idem.ejecutar(s.usuarioId, 'admin_anular', k, { id, motivo: b.motivo }, (c) =>
      this.reembolsos.porAdministracion(c, s, id, 'anulada', b.motivo),
    );
    return responder(res, r);
  }

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
