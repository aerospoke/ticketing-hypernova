import { type INestApplication, StandardSchemaValidationPipe } from '@nestjs/common';
import { ErrorApi } from './common/errores';

/**
 * Configuración global de la app. La usan main.ts y los tests e2e, para que los tests
 * prueben exactamente lo mismo que corre en producción.
 */
export function configurarApp(app: INestApplication) {
  // API versionada por ruta; health y ready quedan fuera para los orquestadores.
  app.setGlobalPrefix('v1', { exclude: ['health', 'ready'] });
  // Valida contra el esquema zod declarado en @Body({ schema }) / @Param(..., { schema }).
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
  return app;
}
