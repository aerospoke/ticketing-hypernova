import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import type { Pool } from 'pg';
import { z } from 'zod';
import { Publico, Roles, SesionActual } from '../auth/auth.guard';
import type { Sesion } from '../auth/tokens';
import { exigirAccesoEvento } from '../common/acceso';
import { PG_POOL } from '../db/db.module';
import { FIRMA_ENTRADAS, type FirmaEntradas } from '../entradas/firma';
import { EscaneoService } from './escaneo.service';

const Id = z.string().regex(/^[1-9]\d{0,17}$/, 'id inválido');
const Desde = z.object({ desde: z.coerce.number().int().min(0).default(0) });
const PAGINA = 1000;

const Dispositivo = z.object({
  id: z.uuid(),
  nombre: z.string().trim().min(1).max(120),
  plataforma: z.string().trim().max(40).optional(),
});
const NuevoTurno = z.object({ evento_id: Id, puerta_id: Id, dispositivo_id: z.uuid() });
const Lote = z.object({
  dispositivo_id: z.uuid(),
  cursor_revocaciones: z.number().int().min(0).optional(),
  escaneos: z
    .array(
      z.object({
        client_scan_id: z.string().min(1).max(100),
        turno_id: Id,
        entrada_id: Id.nullable(),
        version: z.number().int().min(1).nullable(),
        resultado: z.enum(['valido', 'rechazado']),
        motivo: z.string().max(40).optional(),
        escaneado_en: z.iso.datetime({ offset: true }),
      }),
    )
    .min(1)
    .max(500),
});

/** Endpoints del modo escáner. Todo lo que escribe es solo para staff. */
@Controller('escaner')
export class EscanerController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(FIRMA_ENTRADAS) private readonly firma: FirmaEntradas,
    private readonly escaneo: EscaneoService,
  ) {}

  /** Llave pública del servidor: el escáner la guarda y verifica credenciales sin red. */
  @Publico()
  @Get('llave')
  llave() {
    return { alg: 'Ed25519', llave_publica: this.firma.llavePublica };
  }

  @Roles('staff')
  @Post('dispositivos')
  @HttpCode(200)
  dispositivo(@SesionActual() s: Sesion, @Body({ schema: Dispositivo }) b: z.infer<typeof Dispositivo>) {
    return this.escaneo.registrarDispositivo(s.usuarioId, b.id, b.nombre, b.plataforma);
  }

  /** Inicio de turno en una puerta: queda registrado quién escanea, dónde y con qué equipo. */
  @Roles('staff')
  @Post('turnos')
  turno(@SesionActual() s: Sesion, @Body({ schema: NuevoTurno }) b: z.infer<typeof NuevoTurno>) {
    return this.escaneo.abrirTurno(s.usuarioId, b.evento_id, b.puerta_id, b.dispositivo_id);
  }

  @Roles('staff')
  @Post('turnos/:id/cerrar')
  @HttpCode(200)
  cerrarTurno(@SesionActual() s: Sesion, @Param('id', { schema: Id }) id: string) {
    return this.escaneo.cerrarTurno(s.usuarioId, id);
  }

  /** Subida de un lote de escaneos hechos sin red. Reenviar el mismo lote es seguro. */
  @Roles('staff')
  @Post('lotes')
  @HttpCode(200)
  lote(@SesionActual() s: Sesion, @Body({ schema: Lote }) b: z.infer<typeof Lote>) {
    return this.escaneo.sincronizar(s.usuarioId, b.dispositivo_id, b.escaneos, b.cursor_revocaciones);
  }

  /**
   * Revocaciones incrementales de un evento: todo lo publicado con id > `desde`.
   * El escáner guarda `cursor` y la próxima vez pide solo lo nuevo. Si `hay_mas`, repite.
   */
  @Roles('staff', 'organizador', 'admin')
  @Get('eventos/:id/revocaciones')
  async revocaciones(
    @SesionActual() s: Sesion,
    @Param('id', { schema: Id }) eventoId: string,
    @Query({ schema: Desde }) q: z.infer<typeof Desde>,
  ) {
    await exigirAccesoEvento(this.pool, s, eventoId, { staff: true });
    const { rows } = await this.pool.query<{ id: string; entrada_id: string; tipo: string; version_minima: number | null; motivo: string }>(
      `SELECT id, entrada_id, tipo, version_minima, motivo FROM revocaciones
        WHERE evento_id = $1 AND id > $2 ORDER BY id LIMIT $3`,
      [eventoId, q.desde, PAGINA + 1],
    );
    const hayMas = rows.length > PAGINA;
    const items = rows.slice(0, PAGINA);
    return { items, cursor: items.length ? Number(items.at(-1)!.id) : q.desde, hay_mas: hayMas };
  }
}
