import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { Publico } from '../auth/auth.guard';
import { EventosService } from './eventos.service';

const Id = z.string().regex(/^[1-9]\d{0,17}$/, 'id inválido');
const Pagina = z.object({ cursor: z.string().max(200).optional() });

/** Cartelera pública. Lectura pura con caché corta; aplica el rate limit global por IP. */
@Publico()
@Controller('eventos')
export class EventosController {
  constructor(private readonly eventos: EventosService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=5')
  cartelera(@Query({ schema: Pagina }) q: z.infer<typeof Pagina>) {
    return this.eventos.cartelera(q.cursor);
  }

  /** Detalle con disponibilidad por zona (a lo sumo ~1 s de antigüedad). */
  @Get(':id')
  @Header('Cache-Control', 'public, max-age=1')
  detalle(@Param('id', { schema: Id }) id: string) {
    return this.eventos.detalle(id);
  }
}
