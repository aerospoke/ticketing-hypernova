import { ServiceUnavailableException } from '@nestjs/common';
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
    const pool = poolQueDevuelve(new Error('no debería llamarse'));
    expect(new HealthController(pool).health()).toEqual({ estado: 'ok' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('/ready está listo cuando el esquema coincide', async () => {
    const ctrl = new HealthController(poolQueDevuelve({ version: esperada }));
    await expect(ctrl.ready()).resolves.toEqual({ estado: 'listo', esquema: esperada });
  });

  it('/ready responde 503 si el esquema está atrasado', async () => {
    const ctrl = new HealthController(poolQueDevuelve({ version: '0001' }));
    await expect(ctrl.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('/ready responde 503 si la base no responde', async () => {
    const ctrl = new HealthController(poolQueDevuelve(new Error('ECONNREFUSED')));
    await expect(ctrl.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
