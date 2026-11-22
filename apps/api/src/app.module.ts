import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { CompraModule } from './compra/compra.module';
import { CorrelacionMiddleware } from './common/correlacion.middleware';
import { FiltroErrores } from './common/errores';
import { DbModule } from './db/db.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    DbModule,
    // Rate limiting en memoria: suficiente con una instancia de la API. Con varias
    // instancias el contador tendría que vivir en Redis (decisión documentada).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: Number(process.env.RATE_LIMIT ?? 300) }]),
    AuthModule,
    CompraModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: FiltroErrores },
    // El orden importa: primero el rate limit (frena fuerza bruta antes de tocar la base),
    // después la autenticación.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelacionMiddleware).forRoutes('*path');
  }
}
