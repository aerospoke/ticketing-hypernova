import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configurarApp } from './app.setup';

async function bootstrap() {
  // Los logs de la app son JSON propios (common/contexto.ts); el logger de Nest queda
  // solo para advertencias y errores de arranque.
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  configurarApp(app);
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
void bootstrap();
