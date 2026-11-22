import { Module } from '@nestjs/common';
import { CompraService } from './compra.service';
import { ExpiracionService } from './expiracion.service';
import { IdempotenciaService } from './idempotencia.service';
import { ReservasController } from './reservas.controller';

@Module({
  controllers: [ReservasController],
  providers: [CompraService, IdempotenciaService, ExpiracionService],
  exports: [IdempotenciaService, CompraService],
})
export class CompraModule {}
