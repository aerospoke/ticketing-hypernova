import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { SesionActual } from '../auth/auth.guard';
import type { Sesion } from '../auth/tokens';
import { EntradasService } from './entradas.service';

const Id = z.string().regex(/^[1-9]\d{0,17}$/, 'id inválido');
// Llave pública Ed25519: 32 bytes = 43 caracteres base64url sin relleno.
const Material = z.object({ dispositivo_pubkey: z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'llave Ed25519 en base64url') });
const Transferir = z.object({ email: z.string().trim().toLowerCase().pipe(z.email().max(254)) });
const Pagina = z.object({ cursor: Id.optional() });

@Controller()
export class EntradasController {
  constructor(private readonly entradas: EntradasService) {}

  /** Billetera del usuario (paginación por cursor). */
  @Get('me/entradas')
  misEntradas(@SesionActual() s: Sesion, @Query({ schema: Pagina }) q: z.infer<typeof Pagina>) {
    return this.entradas.misEntradas(s.usuarioId, q.cursor);
  }

  /** Material para el código rotativo: credencial firmada por el servidor para ESTE dispositivo. */
  @Post('entradas/:id/material')
  @HttpCode(200)
  material(
    @SesionActual() s: Sesion,
    @Param('id', { schema: Id }) id: string,
    @Body({ schema: Material }) body: z.infer<typeof Material>,
  ) {
    return this.entradas.material(s.usuarioId, id, body.dispositivo_pubkey);
  }

  @Post('entradas/:id/transferencias')
  transferir(
    @SesionActual() s: Sesion,
    @Param('id', { schema: Id }) id: string,
    @Body({ schema: Transferir }) body: z.infer<typeof Transferir>,
  ) {
    return this.entradas.transferir(s.usuarioId, id, body.email);
  }

  @Get('me/transferencias')
  misTransferencias(@SesionActual() s: Sesion) {
    return this.entradas.misTransferencias(s.usuarioId);
  }

  @Post('transferencias/:id/aceptar')
  @HttpCode(200)
  aceptar(@SesionActual() s: Sesion, @Param('id', { schema: Id }) id: string) {
    return this.entradas.aceptar(s.usuarioId, id);
  }

  @Post('transferencias/:id/rechazar')
  @HttpCode(200)
  rechazar(@SesionActual() s: Sesion, @Param('id', { schema: Id }) id: string) {
    return this.entradas.resolverSinAceptar(s.usuarioId, id, 'rechazada');
  }

  @Post('transferencias/:id/cancelar')
  @HttpCode(200)
  cancelar(@SesionActual() s: Sesion, @Param('id', { schema: Id }) id: string) {
    return this.entradas.resolverSinAceptar(s.usuarioId, id, 'cancelada');
  }
}
