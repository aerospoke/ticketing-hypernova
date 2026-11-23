import { Module } from '@nestjs/common';
import { AdminEventosController } from '../admin/admin-eventos.controller';
import { AdminEventosService } from '../admin/admin-eventos.service';
import { EventosController } from './eventos.controller';
import { EventosService } from './eventos.service';

@Module({
  controllers: [EventosController, AdminEventosController],
  providers: [EventosService, AdminEventosService],
})
export class EventosModule {}
