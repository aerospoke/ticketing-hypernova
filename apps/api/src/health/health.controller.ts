import { Controller, Get, HttpCode, Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { Publico } from '../auth/auth.guard';
import { ErrorApi } from '../common/errores';
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
@Publico()
@SkipThrottle()
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
      throw new ErrorApi(503, 'base_inaccesible', 'La base de datos no responde');
    }
    if (aplicada !== this.esperada) {
      throw new ErrorApi(503, 'esquema_desactualizado', 'El esquema no está en la versión esperada', {
        esquema: aplicada,
        esperado: this.esperada,
      });
    }
    return { estado: 'listo', esquema: aplicada };
  }
}
