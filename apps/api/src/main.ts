import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // API versionada por ruta; health y ready quedan fuera para los orquestadores.
  app.setGlobalPrefix('v1', { exclude: ['health', 'ready'] });
  // Cierra el pool de PostgreSQL limpio cuando Docker manda SIGTERM.
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
void bootstrap();
