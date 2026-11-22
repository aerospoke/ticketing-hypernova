import { StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ErrorApi } from './common/errores';

async function bootstrap() {
  // Los logs de la app son JSON propios (common/contexto.ts); el logger de Nest queda
  // solo para advertencias y errores de arranque.
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  // API versionada por ruta; health y ready quedan fuera para los orquestadores.
  app.setGlobalPrefix('v1', { exclude: ['health', 'ready'] });
  // Valida contra el esquema zod declarado en @Body({ schema }) / @Query({ schema }).
  // Los errores salen con la forma única de la API, campo por campo.
  app.useGlobalPipes(
    new StandardSchemaValidationPipe({
      exceptionFactory: (issues) =>
        new ErrorApi(
          400,
          'peticion_invalida',
          'La petición no es válida',
          issues.map((i) => ({
            campo: (i.path ?? []).map((p) => (typeof p === 'object' ? p.key : p)).join('.') || null,
            mensaje: i.message,
          })),
        ),
    }),
  );
  // Cierra el pool de PostgreSQL limpio cuando Docker manda SIGTERM.
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}
void bootstrap();
