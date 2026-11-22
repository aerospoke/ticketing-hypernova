/**
 * Tests e2e del motor de compra contra PostgreSQL real (sin mocks): lo que se prueba
 * son justamente las garantías que da la base (UPDATE condicional, CHECK, UNIQUE).
 *
 * Correr con: apps/api/test/correr-e2e.sh  (levanta una base aislada y la borra al final)
 *
 * Cada test crea su propio evento y zona con el aforo y el límite que necesita: los tests
 * no dependen del dataset ni entre sí.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/app.setup';
import { ExpiracionService } from '../src/compra/expiracion.service';
import { PG_POOL } from '../src/db/db.module';

const PRECIO = 2500;

let app: INestApplication;
let pool: Pool;
let http: ReturnType<typeof request>;
let n = 0;

beforeAll(async () => {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = configurarApp(mod.createNestApplication({ logger: false }));
  await app.init();
  pool = app.get(PG_POOL);
  http = request(app.getHttpServer());
});

afterAll(async () => {
  await app.close();
});

/** Evento en venta con una zona y una fase vigente, creados solo para este test. */
async function crearZona(aforo: number, limitePorCuenta = 6): Promise<string> {
  const { rows: ev } = await pool.query<{ id: string }>(
    `INSERT INTO eventos (codigo, nombre, organizador_id, recinto, fecha, venta_abre, reembolsable_hasta, limite_por_cuenta)
     VALUES ($1, 'Evento e2e', 100201, 'Recinto e2e', now() + interval '30 days', now() - interval '1 day',
             now() + interval '28 days', $2) RETURNING id`,
    [`E2E-${randomUUID().slice(0, 8)}`, limitePorCuenta],
  );
  const { rows: z } = await pool.query<{ id: string }>(
    `INSERT INTO zonas (evento_id, nombre, aforo) VALUES ($1, 'Zona e2e', $2) RETURNING id`,
    [ev[0].id, aforo],
  );
  await pool.query(
    `INSERT INTO fases_precio (zona_id, fase, precio_centesimos, desde, hasta)
     VALUES ($1, 'general', $2, now() - interval '1 day', now() + interval '29 days')`,
    [z[0].id, PRECIO],
  );
  return z[0].id;
}

/** Registra un asistente nuevo y devuelve su header de autorización. */
async function usuario(): Promise<{ auth: string; id: string }> {
  const r = await http
    .post('/v1/auth/registro')
    .send({ nombre: 'Comprador e2e', email: `e2e-${Date.now()}-${++n}@correo.test`, password: 'clave-e2e-larga' })
    .expect(201);
  return { auth: `Bearer ${r.body.access_token}`, id: r.body.usuario.id };
}

const clave = (p: string) => `${p}-${randomUUID()}`;

function reservar(auth: string, zona: string, cantidad: number, k = clave('res'), extra: object = {}) {
  return http.post('/v1/reservas').set('authorization', auth).set('idempotency-key', k).send({ zona_id: zona, cantidad, ...extra });
}
function pagar(auth: string, reserva: string, k = clave('pago')) {
  return http.post(`/v1/reservas/${reserva}/pago`).set('authorization', auth).set('idempotency-key', k);
}

async function zona(id: string) {
  const { rows } = await pool.query<{ vendidas: number; reservadas: number }>(
    'SELECT vendidas, reservadas FROM zonas WHERE id = $1',
    [id],
  );
  return rows[0];
}

/** Vence una reserva sin esperar: mueve sus fechas al pasado (respetando el CHECK). */
async function vencer(reservaId: string) {
  await pool.query(
    `UPDATE reservas SET creada_en = now() - interval '20 minutes', expira_en = now() - interval '10 minutes' WHERE id = $1`,
    [reservaId],
  );
}

// ---------------------------------------------------------------------------------------

describe('Invariante 1: aforo bajo concurrencia', () => {
  it('20 compradores simultáneos por 5 lugares: exactamente 5 reservan', async () => {
    const z = await crearZona(5);
    const compradores = await Promise.all(Array.from({ length: 20 }, () => usuario()));

    const respuestas = await Promise.all(compradores.map((u) => reservar(u.auth, z, 1)));

    const ok = respuestas.filter((r) => r.status === 201);
    const agotado = respuestas.filter((r) => r.status === 409 && r.body.error.codigo === 'cupo_agotado');
    expect(ok).toHaveLength(5);
    expect(agotado).toHaveLength(15);
    expect(await zona(z)).toEqual({ vendidas: 0, reservadas: 5 });
  });

  it('la base rechaza una sobreventa aunque el código la intente (CHECK)', async () => {
    const z = await crearZona(3);
    await expect(pool.query('UPDATE zonas SET vendidas = 4 WHERE id = $1', [z])).rejects.toThrow(/zonas_no_sobreventa/);
  });
});

describe('Límite por cuenta', () => {
  it('no se puede pasar del límite del organizador, ni en dos peticiones simultáneas', async () => {
    const z = await crearZona(100, 4);
    const u = await usuario();

    // Dos reservas de 3 al mismo tiempo: juntas serían 6 > 4. Solo una puede entrar.
    const [a, b] = await Promise.all([reservar(u.auth, z, 3), reservar(u.auth, z, 3)]);
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 409]);
    expect([a, b].find((r) => r.status === 409)!.body.error.codigo).toBe('limite_por_cuenta');

    expect((await reservar(u.auth, z, 1)).status).toBe(201); // 3 + 1 = 4: justo el límite
    expect((await reservar(u.auth, z, 1)).body.error.codigo).toBe('limite_por_cuenta');
  });
});

describe('Invariante 2: cobro único', () => {
  it('precio manipulado: se ignora el monto del cliente y se cobra el de la fase vigente', async () => {
    const z = await crearZona(10);
    const u = await usuario();

    const r = await reservar(u.auth, z, 2, undefined, { monto_centesimos: 1, precio_unitario_centesimos: 1 }).expect(201);
    expect(r.body.precio_unitario_centesimos).toBe(PRECIO);
    expect(r.body.monto_centesimos).toBe(2 * PRECIO);

    const p = await pagar(u.auth, r.body.id).expect(201);
    expect(p.body.monto_centesimos).toBe(2 * PRECIO);
  });

  it('doble toque: 5 pagos simultáneos con la misma clave generan 1 compra y 1 cobro', async () => {
    const z = await crearZona(10);
    const u = await usuario();
    const r = await reservar(u.auth, z, 2).expect(201);
    const k = clave('pago-doble');

    const pagos = await Promise.all(Array.from({ length: 5 }, () => pagar(u.auth, r.body.id, k)));

    const ids = new Set(pagos.map((p) => p.body.id));
    expect(ids.size).toBe(1);
    expect(pagos.every((p) => p.status === 201)).toBe(true);
    expect(pagos.filter((p) => p.headers['idempotent-replayed'] === 'true')).toHaveLength(4);

    const { rows } = await pool.query(
      `SELECT count(DISTINCT c.id)::int AS compras, count(e.id)::int AS entradas, sum(DISTINCT c.monto_centesimos)::int AS cobrado
         FROM compras c LEFT JOIN entradas e ON e.compra_id = c.id WHERE c.reserva_id = $1`,
      [r.body.id],
    );
    expect(rows[0]).toEqual({ compras: 1, entradas: 2, cobrado: 2 * PRECIO });
    expect(await zona(z)).toEqual({ vendidas: 2, reservadas: 0 });
  });

  it('pagar la misma reserva con otra clave devuelve la compra existente', async () => {
    const z = await crearZona(10);
    const u = await usuario();
    const r = await reservar(u.auth, z, 1).expect(201);
    const p1 = await pagar(u.auth, r.body.id).expect(201);
    const p2 = await pagar(u.auth, r.body.id).expect(200);
    expect(p2.body.id).toBe(p1.body.id);
  });

  it('reservar dos veces con la misma clave no retiene cupo dos veces', async () => {
    const z = await crearZona(10);
    const u = await usuario();
    const k = clave('res-doble');
    const [a, b] = await Promise.all([reservar(u.auth, z, 2, k), reservar(u.auth, z, 2, k)]);
    expect(a.body.id).toBe(b.body.id);
    expect(await zona(z)).toEqual({ vendidas: 0, reservadas: 2 });
  });

  it('misma clave con otra petición: 422; sin clave: 400', async () => {
    const z = await crearZona(10);
    const u = await usuario();
    const k = clave('res');
    await reservar(u.auth, z, 1, k).expect(201);
    const otra = await reservar(u.auth, z, 2, k).expect(422);
    expect(otra.body.error.codigo).toBe('idempotency_key_reutilizada');

    const sin = await http.post('/v1/reservas').set('authorization', u.auth).send({ zona_id: z, cantidad: 1 }).expect(400);
    expect(sin.body.error.codigo).toBe('falta_idempotency_key');
  });

  it('un usuario no puede ver ni pagar la reserva de otro', async () => {
    const z = await crearZona(10);
    const dueno = await usuario();
    const otro = await usuario();
    const r = await reservar(dueno.auth, z, 1).expect(201);
    await http.get(`/v1/reservas/${r.body.id}`).set('authorization', otro.auth).expect(404);
    await pagar(otro.auth, r.body.id).expect(404);
  });

  it('sin sesión no se puede reservar', async () => {
    const z = await crearZona(10);
    await http.post('/v1/reservas').set('idempotency-key', clave('x')).send({ zona_id: z, cantidad: 1 }).expect(401);
  });
});

describe('Cancelación y expiración', () => {
  it('cancelar libera el cupo; cancelar otra vez no es error; pagar una cancelada da 409', async () => {
    const z = await crearZona(10);
    const u = await usuario();
    const r = await reservar(u.auth, z, 3).expect(201);
    expect(await zona(z)).toEqual({ vendidas: 0, reservadas: 3 });

    const cancelar = () =>
      http.post(`/v1/reservas/${r.body.id}/cancelar`).set('authorization', u.auth).set('idempotency-key', clave('cancel'));
    expect((await cancelar().expect(200)).body.estado).toBe('cancelada');
    expect(await zona(z)).toEqual({ vendidas: 0, reservadas: 0 });
    await cancelar().expect(200);

    const p = await pagar(u.auth, r.body.id).expect(409);
    expect(p.body.error.codigo).toBe('reserva_cancelada');
  });

  it('una reserva vencida devuelve el cupo a la zona y a la cuenta', async () => {
    const z = await crearZona(10, 2);
    const u = await usuario();
    const r = await reservar(u.auth, z, 2).expect(201);
    // Con el límite (2) consumido, no puede reservar más hasta que la reserva venza.
    expect((await reservar(u.auth, z, 1)).body.error.codigo).toBe('limite_por_cuenta');

    await vencer(r.body.id);
    expect(await app.get(ExpiracionService).barrer()).toBeGreaterThanOrEqual(1);

    expect(await zona(z)).toEqual({ vendidas: 0, reservadas: 0 });
    const estado = await http.get(`/v1/reservas/${r.body.id}`).set('authorization', u.auth).expect(200);
    expect(estado.body).toMatchObject({ estado: 'expirada', segundos_restantes: 0 });
    await reservar(u.auth, z, 2).expect(201); // la cuenta recuperó su cupo
  });

  it('pago tardío con cupo disponible: se emite', async () => {
    const z = await crearZona(10);
    const u = await usuario();
    const r = await reservar(u.auth, z, 2).expect(201);
    await vencer(r.body.id);
    await app.get(ExpiracionService).barrer();

    const p = await pagar(u.auth, r.body.id).expect(201);
    expect(p.body.estado).toBe('pagada');
    expect(p.body.entradas).toHaveLength(2);
    expect(await zona(z)).toEqual({ vendidas: 2, reservadas: 0 });
  });

  it('pago tardío sin cupo: reembolso automático, sin entradas y sin tocar el aforo', async () => {
    const z = await crearZona(1);
    const tardio = await usuario();
    const otro = await usuario();
    const r = await reservar(tardio.auth, z, 1).expect(201);
    await vencer(r.body.id);
    await app.get(ExpiracionService).barrer();

    // Otro comprador se queda con el único lugar liberado.
    const r2 = await reservar(otro.auth, z, 1).expect(201);
    await pagar(otro.auth, r2.body.id).expect(201);

    const p = await pagar(tardio.auth, r.body.id).expect(200);
    expect(p.body.estado).toBe('reembolso_automatico');
    expect(p.body.entradas).toHaveLength(0);
    expect(await zona(z)).toEqual({ vendidas: 1, reservadas: 0 });

    const { rows } = await pool.query(
      'SELECT monto_centesimos::int AS monto, autor_id, entrada_id FROM reembolsos WHERE compra_id = $1',
      [p.body.id],
    );
    expect(rows).toEqual([{ monto: PRECIO, autor_id: null, entrada_id: null }]);
  });
});
