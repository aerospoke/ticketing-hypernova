import { Module } from '@nestjs/common';
import { AdminController } from '../admin/admin.controller';
import { EscanerController } from '../escaner/escaner.controller';
import { EscaneoService } from '../escaner/escaneo.service';
import { EntradasController } from './entradas.controller';
import { EntradasService } from './entradas.service';
import { FIRMA_ENTRADAS, firmaEntradasProvider } from './firma';

@Module({
  controllers: [EntradasController, EscanerController, AdminController],
  providers: [EntradasService, EscaneoService, firmaEntradasProvider],
  exports: [FIRMA_ENTRADAS],
})
export class EntradasModule {}
