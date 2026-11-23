import { Module } from '@nestjs/common';
import { EscanerController } from '../escaner/escaner.controller';
import { EntradasController } from './entradas.controller';
import { EntradasService } from './entradas.service';
import { FIRMA_ENTRADAS, firmaEntradasProvider } from './firma';

@Module({
  controllers: [EntradasController, EscanerController],
  providers: [EntradasService, firmaEntradasProvider],
  exports: [FIRMA_ENTRADAS],
})
export class EntradasModule {}
