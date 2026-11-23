import { Module } from '@nestjs/common';
import { CompraModule } from '../compra/compra.module';
import { AdminController } from '../admin/admin.controller';
import { EscanerController } from '../escaner/escaner.controller';
import { EscaneoService } from '../escaner/escaneo.service';
import { EntradasController } from './entradas.controller';
import { EntradasService } from './entradas.service';
import { FIRMA_ENTRADAS, firmaEntradasProvider } from './firma';
import { ReembolsosService } from './reembolsos.service';

@Module({
  imports: [CompraModule],
  controllers: [EntradasController, EscanerController, AdminController],
  providers: [EntradasService, EscaneoService, ReembolsosService, firmaEntradasProvider],
  exports: [FIRMA_ENTRADAS],
})
export class EntradasModule {}
