import { Controller, Get, HttpCode, Inject, ServiceUnavailableException } from '@nestjs/common';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

/** Última migración incluida en esta build (la que el código espera encontrar en la base). */
export function versionEsperada(dir = join(__dirname, '..', '..', 'migrations')): string {
  const versiones = readdirSync(dir)
    .map((f) => /^(\d{4})_.+\.sql$/.exec(f)?.[1])
    .filter((v): v is string => v !== undefined)
    .sort();
  return versiones.at(-1) ?? '0000';
}

/**
 * /health  = liveness: el proceso responde. No toca la base, para que un corte de
 *            PostgreSQL no haga que el orquestador reinicie la API en bucle.
 * /ready   = readiness: la base responde con el rol de app y el esquema está en la
 *            versión que este código espera. Si no, 503 y no se le manda tráfico.
 */
@Controller()
export class HealthController {
  private readonly esperada = versionEsperada();

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get('health')
  @HttpCode(200)
  health() {
    return { estado: 'ok' };
  }

  @Get('ready')
  async ready() {
    let aplicada: string | null;
    try {
      const { rows } = await this.pool.query<{ version: string | null }>(
        'SELECT max(version) AS version FROM schema_migrations',
      );
      aplicada = rows[0]?.version ?? null;
    } catch {
      throw new ServiceUnavailableException({ estado: 'no_listo', motivo: 'base_inaccesible' });
    }
    if (aplicada !== this.esperada) {
      throw new ServiceUnavailableException({
        estado: 'no_listo',
        motivo: 'esquema_desactualizado',
        esquema: aplicada,
        esperado: this.esperada,
      });
    }
    return { estado: 'listo', esquema: aplicada };
  }
}
