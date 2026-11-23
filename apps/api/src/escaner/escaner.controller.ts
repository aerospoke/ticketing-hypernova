import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import type { Pool } from 'pg';
import { z } from 'zod';
import { Publico, Roles, SesionActual } from '../auth/auth.guard';
import type { Sesion } from '../auth/tokens';
import { ErrorApi } from '../common/errores';
import { PG_POOL } from '../db/db.module';
import { FIRMA_ENTRADAS, type FirmaEntradas } from '../entradas/firma';

const Id = z.string().regex(/^[1-9]\d{0,17}$/, 'id inválido');
const Desde = z.object({ desde: z.coerce.number().int().min(0).default(0) });
const PAGINA = 1000;

@Controller('escaner')
export class EscanerController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(FIRMA_ENTRADAS) private readonly firma: FirmaEntradas,
  ) {}

  /** Llave pública del servidor: el escáner la guarda y verifica credenciales sin red. */
  @Publico()
  @Get('llave')
  llave() {
    return { alg: 'Ed25519', llave_publica: this.firma.llavePublica };
  }

  /**
   * Revocaciones incrementales de un evento: todo lo publicado con id > `desde`.
   * El escáner guarda `cursor` y la próxima vez pide solo lo nuevo. Si `hay_mas`, repite.
   * Solo para staff asignado al evento, su organizador o admin.
   */
  @Roles('staff', 'organizador', 'admin')
  @Get('eventos/:id/revocaciones')
  async revocaciones(
    @SesionActual() s: Sesion,
    @Param('id', { schema: Id }) eventoId: string,
    @Query({ schema: Desde }) q: z.infer<typeof Desde>,
  ) {
    await this.exigirAcceso(s, eventoId);
    const { rows } = await this.pool.query<{ id: string; entrada_id: string; tipo: string; version_minima: number | null; motivo: string }>(
      `SELECT id, entrada_id, tipo, version_minima, motivo FROM revocaciones
        WHERE evento_id = $1 AND id > $2 ORDER BY id LIMIT $3`,
      [eventoId, q.desde, PAGINA + 1],
    );
    const hayMas = rows.length > PAGINA;
    const items = rows.slice(0, PAGINA);
    return { items, cursor: items.length ? Number(items.at(-1)!.id) : q.desde, hay_mas: hayMas };
  }

  private async exigirAcceso(s: Sesion, eventoId: string) {
    if (s.rol === 'admin') return;
    const { rowCount } = await this.pool.query(
      s.rol === 'organizador'
        ? 'SELECT 1 FROM eventos WHERE id = $1 AND organizador_id = $2'
        : 'SELECT 1 FROM asignaciones_staff WHERE evento_id = $1 AND staff_id = $2',
      [eventoId, s.usuarioId],
    );
    // Mismo 404 para "no existe" y "no es tuyo": no se revela qué eventos existen.
    if (!rowCount) throw new ErrorApi(404, 'evento_no_encontrado', 'El evento no existe o no tienes acceso');
  }
}
