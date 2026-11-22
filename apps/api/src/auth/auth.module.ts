import { Module } from '@nestjs/common';
import { llaveAccessProvider, LLAVE_ACCESS } from './auth.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MeController } from './me.controller';

@Module({
  controllers: [AuthController, MeController],
  providers: [AuthService, llaveAccessProvider],
  exports: [LLAVE_ACCESS],
})
export class AuthModule {}
