import { ErrorApi } from '../common/errores';
import type { Pool } from 'pg';
import { HealthController, versionEsperada } from './health.controller';

function poolQueDevuelve(resultado: { version: string | null } | Error): Pool {
  return {
    query: jest.fn(() => (resultado instanceof Error ? Promise.reject(resultado) : Promise.resolve({ rows: [resultado] }))),
  } as unknown as Pool;
}

describe('HealthController', () => {
  const esperada = versionEsperada();

  it('lee la última migración del directorio', () => {
    expect(esperada).toMatch(/^\d{4}$/);
    expect(esperada).not.toBe('0000');
  });

  it('/health responde sin tocar la base', () => {
    const query = jest.fn();
    const pool = { query } as unknown as Pool;
    expect(new HealthController(pool).health()).toEqual({ estado: 'ok' });
    expect(query).not.toHaveBeenCalled();
  });

  it('/ready está listo cuando el esquema coincide', async () => {
    const ctrl = new HealthController(poolQueDevuelve({ version: esperada }));
    await expect(ctrl.ready()).resolves.toEqual({ estado: 'listo', esquema: esperada });
  });

  it('/ready responde 503 si el esquema está atrasado', async () => {
    const ctrl = new HealthController(poolQueDevuelve({ version: '0001' }));
    await expect(ctrl.ready()).rejects.toMatchObject({ codigo: 'esquema_desactualizado', status: 503 });
  });

  it('/ready responde 503 si la base no responde', async () => {
    const ctrl = new HealthController(poolQueDevuelve(new Error('ECONNREFUSED')));
    const err = await ctrl.ready().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ErrorApi);
    expect((err as ErrorApi).codigo).toBe('base_inaccesible');
    expect((err as ErrorApi).getStatus()).toBe(503);
  });
});
