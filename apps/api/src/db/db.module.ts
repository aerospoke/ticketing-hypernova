import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { configApp } from './config';

/** Token de inyección del pool de PostgreSQL (rol de aplicación). */
export const PG_POOL = Symbol('PG_POOL');

/**
 * Un solo pool para toda la API. Se usa `pg` directo (sin ORM) porque las rutas
 * críticas son SQL explícito: UPDATE condicionales, ON CONFLICT, FOR UPDATE SKIP LOCKED.
 */
@Global()
@Module({
  providers: [{ provide: PG_POOL, useFactory: () => new Pool(configApp()) }],
  exports: [PG_POOL],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
