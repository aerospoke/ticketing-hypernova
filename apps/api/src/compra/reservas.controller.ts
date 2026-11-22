import { Body, Controller, Get, Headers, Param, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { z } from 'zod';
import { SesionActual } from '../auth/auth.guard';
import type { Sesion } from '../auth/tokens';
import { contexto } from '../common/contexto';
import { CompraService } from './compra.service';
import { exigirClave, IdempotenciaService, type RespuestaIdempotente } from './idempotencia.service';

const Id = z.string().regex(/^[1-9]\d{0,17}$/, 'id inválido');
// z.object descarta las claves que no declara: un `monto` o `precio` enviado por el
// cliente no llega al servicio ni cambia el hash de idempotencia. El precio es del servidor.
const NuevaReserva = z.object({
  zona_id: Id,
  cantidad: z.number().int().min(1).max(20),
});

// Rate limit de compra por IP; configurable para la prueba de carga.
const LIMITE_COMPRA = Number(process.env.COMPRA_RATE_LIMIT ?? 30);

/** Endpoints que mueven dinero: todos exigen Idempotency-Key. Lógica en los servicios. */
@Controller('reservas')
export class ReservasController {
  constructor(
    private readonly compra: CompraService,
    private readonly idem: IdempotenciaService,
  ) {}

  @Post()
  @Throttle({ default: { limit: LIMITE_COMPRA, ttl: 60_000 } })
  async reservar(
    @SesionActual() s: Sesion,
    @Headers('idempotency-key') clave: string | undefined,
    @Body({ schema: NuevaReserva }) body: z.infer<typeof NuevaReserva>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const k = exigirClave(clave);
    const r = await this.idem.ejecutar(s.usuarioId, 'reservar', k, body, (c) =>
      this.compra.reservar(c, s.usuarioId, body.zona_id, body.cantidad, k),
    );
    return responder(res, r);
  }

  @Get(':id')
  consultar(@SesionActual() s: Sesion, @Param('id', { schema: Id }) id: string) {
    return this.compra.consultar(s.usuarioId, id);
  }

  @Post(':id/cancelar')
  async cancelar(
    @SesionActual() s: Sesion,
    @Headers('idempotency-key') clave: string | undefined,
    @Param('id', { schema: Id }) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const k = exigirClave(clave);
    const r = await this.idem.ejecutar(s.usuarioId, 'cancelar', k, { id }, (c) =>
      this.compra.cancelar(c, s.usuarioId, id),
    );
    return responder(res, r);
  }

  @Post(':id/pago')
  @Throttle({ default: { limit: LIMITE_COMPRA, ttl: 60_000 } })
  async pagar(
    @SesionActual() s: Sesion,
    @Headers('idempotency-key') clave: string | undefined,
    @Param('id', { schema: Id }) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const k = exigirClave(clave);
    const r = await this.idem.ejecutar(s.usuarioId, 'pagar', k, { id }, (c) =>
      this.compra.pagar(c, s.usuarioId, id, k),
    );
    return responder(res, r);
  }
}

/** Aplica el status guardado y marca las repeticiones con `Idempotent-Replayed: true`. */
function responder(res: Response, r: RespuestaIdempotente) {
  res.status(r.status);
  if (!r.repetida) return r.body;
  res.setHeader('Idempotent-Replayed', 'true');
  // Un error repetido conserva su forma, con la correlación de ESTA petición.
  if (r.status >= 400) return { ...(r.body as object), correlacion_id: contexto.getStore()?.correlacionId };
  return r.body;
}
