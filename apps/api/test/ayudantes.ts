/**
 * Preparación compartida de los tests e2e: app real dentro de jest, PostgreSQL real,
 * y fixtures propias por test (evento + zona + fase) para no depender del dataset.
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/app.setup';
import { PG_POOL } from '../src/db/db.module';

export const PRECIO = 2500;
export const ORGANIZADOR = '100201'; // org.istmo del dataset
export const STAFF_DEL_ORGANIZADOR = { id: '100301', email: 'staff1@ticketing.test', password: 'Staff2026!' };

export interface Ctx {
  app: INestApplication;
  pool: Pool;
  http: ReturnType<typeof request>;
}

export async function iniciar(): Promise<Ctx> {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configurarApp(mod.createNestApplication({ logger: false }));
  // Escuchando en un puerto efímero: si no, supertest abre y cierra el servidor en cada
  // petición, y con muchas peticiones en paralelo se pisan entre sí.
  await app.listen(0, '127.0.0.1');
  return { app, pool: app.get(PG_POOL), http: request(app.getHttpServer()) };
}

/** Evento en venta con una zona y una fase vigente, creados solo para el test. */
export async function crearZona(ctx: Ctx, aforo: number, limitePorCuenta = 6): Promise<{ zona: string; evento: string }> {
  const { rows: ev } = await ctx.pool.query<{ id: string }>(
    `INSERT INTO eventos (codigo, nombre, organizador_id, recinto, fecha, venta_abre, reembolsable_hasta, limite_por_cuenta)
     VALUES ($1, 'Evento e2e', $2, 'Recinto e2e', now() + interval '30 days', now() - interval '1 day',
             now() + interval '28 days', $3) RETURNING id`,
    [`E2E-${randomUUID().slice(0, 8)}`, ORGANIZADOR, limitePorCuenta],
  );
  const { rows: z } = await ctx.pool.query<{ id: string }>(
    `INSERT INTO zonas (evento_id, nombre, aforo) VALUES ($1, 'Zona e2e', $2) RETURNING id`,
    [ev[0].id, aforo],
  );
  await ctx.pool.query(
    `INSERT INTO fases_precio (zona_id, fase, precio_centesimos, desde, hasta)
     VALUES ($1, 'general', $2, now() - interval '1 day', now() + interval '29 days')`,
    [z[0].id, PRECIO],
  );
  return { zona: z[0].id, evento: ev[0].id };
}

let n = 0;
/** Registra un asistente nuevo. */
export async function usuario(ctx: Ctx): Promise<{ auth: string; id: string; email: string }> {
  const email = `e2e-${Date.now()}-${++n}@correo.test`;
  const r = await ctx.http
    .post('/v1/auth/registro')
    .send({ nombre: 'Asistente e2e', email, password: 'clave-e2e-larga' })
    .expect(201);
  return { auth: `Bearer ${r.body.access_token}`, id: r.body.usuario.id, email };
}

export async function login(ctx: Ctx, email: string, password: string): Promise<string> {
  const r = await ctx.http.post('/v1/auth/login').send({ email, password }).expect(200);
  return `Bearer ${r.body.access_token}`;
}

export const clave = (p: string) => `${p}-${randomUUID()}`;

export function reservar(ctx: Ctx, auth: string, zona: string, cantidad: number, k = clave('res'), extra: object = {}) {
  return ctx.http.post('/v1/reservas').set('authorization', auth).set('idempotency-key', k).send({ zona_id: zona, cantidad, ...extra });
}

export function pagar(ctx: Ctx, auth: string, reserva: string, k = clave('pago')) {
  return ctx.http.post(`/v1/reservas/${reserva}/pago`).set('authorization', auth).set('idempotency-key', k);
}

/** Compra 1 entrada en la zona y devuelve su id. */
export async function comprarEntrada(ctx: Ctx, auth: string, zona: string): Promise<string> {
  const r = await reservar(ctx, auth, zona, 1).expect(201);
  const p = await pagar(ctx, auth, r.body.id).expect(201);
  return p.body.entradas[0].id;
}
