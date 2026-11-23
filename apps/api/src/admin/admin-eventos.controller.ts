import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { Roles, SesionActual } from '../auth/auth.guard';
import type { Sesion } from '../auth/tokens';
import { AdminEventosService } from './admin-eventos.service';

const Id = z.string().regex(/^[1-9]\d{0,17}$/, 'id inválido');
const Fecha = z.iso.datetime({ offset: true });
const Texto = (max: number) => z.string().trim().min(1).max(max);
const Centesimos = z.number().int().min(0).max(100_000_000);

const Evento = z.object({
  codigo: Texto(40),
  nombre: Texto(200),
  recinto: Texto(200),
  fecha: Fecha,
  venta_abre: Fecha,
  reembolsable_hasta: Fecha,
  limite_por_cuenta: z.number().int().min(1).max(100),
  estado: z.enum(['borrador', 'publicado', 'cancelado']).optional(),
  organizador_id: Id.optional(),
});
// El código y el organizador no se cambian después de crear el evento.
const EventoParcial = Evento.omit({ codigo: true, organizador_id: true }).partial();
const Zona = z.object({ nombre: Texto(120), aforo: z.number().int().min(1).max(1_000_000) });
const Fase = z.object({
  fase: z.enum(['preventa', 'general', 'taquilla']),
  precio_centesimos: Centesimos,
  desde: Fecha,
  hasta: Fecha,
});
const Puerta = z.object({ nombre: Texto(120) });

/** Gestión de eventos del portal. Organizador: solo los suyos. Admin: todos. */
@Roles('organizador', 'admin')
@Controller('admin')
export class AdminEventosController {
  constructor(private readonly svc: AdminEventosService) {}

  @Get('eventos')
  listar(@SesionActual() s: Sesion) {
    return this.svc.listar(s);
  }

  @Post('eventos')
  crear(@SesionActual() s: Sesion, @Body({ schema: Evento }) b: z.infer<typeof Evento>) {
    return this.svc.crearEvento(s, b);
  }

  @Get('eventos/:id')
  detalle(@SesionActual() s: Sesion, @Param('id', { schema: Id }) id: string) {
    return this.svc.detalle(s, id);
  }

  @Patch('eventos/:id')
  actualizar(@SesionActual() s: Sesion, @Param('id', { schema: Id }) id: string, @Body({ schema: EventoParcial }) b: z.infer<typeof EventoParcial>) {
    return this.svc.actualizarEvento(s, id, b);
  }

  @Post('eventos/:id/zonas')
  crearZona(@SesionActual() s: Sesion, @Param('id', { schema: Id }) id: string, @Body({ schema: Zona }) b: z.infer<typeof Zona>) {
    return this.svc.crearZona(s, id, b.nombre, b.aforo);
  }

  @Patch('zonas/:id')
  actualizarZona(@SesionActual() s: Sesion, @Param('id', { schema: Id }) id: string, @Body({ schema: Zona.partial() }) b: Partial<z.infer<typeof Zona>>) {
    return this.svc.actualizarZona(s, id, b);
  }

  @Post('zonas/:id/fases')
  crearFase(@SesionActual() s: Sesion, @Param('id', { schema: Id }) id: string, @Body({ schema: Fase }) b: z.infer<typeof Fase>) {
    return this.svc.crearFase(s, id, b);
  }

  @Patch('fases/:id')
  actualizarFase(
    @SesionActual() s: Sesion,
    @Param('id', { schema: Id }) id: string,
    @Body({ schema: Fase.omit({ fase: true }).partial() }) b: Partial<z.infer<typeof Fase>>,
  ) {
    return this.svc.actualizarFase(s, id, b);
  }

  @Post('eventos/:id/puertas')
  crearPuerta(@SesionActual() s: Sesion, @Param('id', { schema: Id }) id: string, @Body({ schema: Puerta }) b: z.infer<typeof Puerta>) {
    return this.svc.crearPuerta(s, id, b.nombre);
  }

  @Put('eventos/:id/staff/:staffId')
  @HttpCode(200)
  asignarStaff(@SesionActual() s: Sesion, @Param('id', { schema: Id }) id: string, @Param('staffId', { schema: Id }) staffId: string) {
    return this.svc.asignarStaff(s, id, staffId, true);
  }

  @Delete('eventos/:id/staff/:staffId')
  @HttpCode(200)
  quitarStaff(@SesionActual() s: Sesion, @Param('id', { schema: Id }) id: string, @Param('staffId', { schema: Id }) staffId: string) {
    return this.svc.asignarStaff(s, id, staffId, false);
  }
}
