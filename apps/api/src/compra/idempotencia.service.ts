import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { Response } from 'express';
import { contexto, log } from '../common/contexto';
import { ErrorApi } from '../common/errores';
import { PG_POOL } from '../db/db.module';

export interface Resultado {
  status: number;
  body: unknown;
}
export interface RespuestaIdempotente extends Resultado {
  /** true si se devolvió la respuesta guardada de una petición anterior con la misma clave. */
  repetida: boolean;
}

const CLAVE_VALIDA = /^[A-Za-z0-9_.:-]{8,200}$/;

/** Valida el header Idempotency-Key. Es obligatorio en todo endpoint que mueve dinero. */
export function exigirClave(clave: string | undefined): string {
  if (!clave) throw new ErrorApi(400, 'falta_idempotency_key', 'El header Idempotency-Key es obligatorio');
  if (!CLAVE_VALIDA.test(clave)) {
    throw new ErrorApi(400, 'idempotency_key_invalida', 'Idempotency-Key: de 8 a 200 caracteres [A-Za-z0-9_.:-]');
  }
  return clave;
}

/**
 * Idempotencia al estilo Stripe, resuelta por PostgreSQL y no con locks en memoria.
 *
 * La fila de la clave se inserta DENTRO de la misma transacción que la operación:
 *  - Primera petición: el INSERT entra, se ejecuta la operación, se guarda la respuesta
 *    y COMMIT. Clave y efecto quedan grabados juntos, o ninguno de los dos.
 *  - Duplicado simultáneo (doble toque): su INSERT ... ON CONFLICT choca con la fila
 *    todavía no confirmada de la primera y PostgreSQL lo hace ESPERAR. Cuando la primera
 *    confirma, el duplicado lee la respuesta guardada y la devuelve tal cual.
 *    Si la primera hace ROLLBACK, la fila desaparece y el duplicado ejecuta normalmente.
 *  - Reintento posterior (timeout, respuesta perdida): misma respuesta guardada.
 *  - Misma clave con OTRA petición: 422 (error del cliente, no se ejecuta nada).
 *
 * Los errores de negocio (4xx: cupo agotado, límite, etc.) también quedan asociados a la
 * clave: se deshace solo el trabajo de negocio (SAVEPOINT) y se guarda el error. Para
 * reintentar más tarde hay que usar una clave nueva. Los errores inesperados (5xx) no se
 * guardan: se deshace todo y el cliente puede reintentar con la misma clave.
 */
@Injectable()
export class IdempotenciaService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async ejecutar(
    usuarioId: string,
    operacion: string,
    clave: string,
    peticion: unknown,
    fn: (c: PoolClient) => Promise<Resultado>,
  ): Promise<RespuestaIdempotente> {
    // `peticion` llega ya validada por zod: los campos desconocidos (p. ej. un `monto`
    // inventado por el cliente) no forman parte del hash ni llegan al negocio.
    const hash = createHash('sha256').update(JSON.stringify({ operacion, peticion })).digest();
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const nueva = await c.query(
        `INSERT INTO idempotency_keys (usuario_id, operacion, clave, hash_peticion)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [usuarioId, operacion, clave, hash],
      );

      if (nueva.rowCount === 0) {
        const { rows } = await c.query<{ hash_peticion: Buffer; estado: string; codigo_respuesta: number; respuesta: unknown }>(
          `SELECT hash_peticion, estado, codigo_respuesta, respuesta FROM idempotency_keys
            WHERE usuario_id = $1 AND operacion = $2 AND clave = $3`,
          [usuarioId, operacion, clave],
        );
        await c.query('COMMIT');
        const previa = rows[0];
        if (!previa.hash_peticion.equals(hash)) {
          throw new ErrorApi(422, 'idempotency_key_reutilizada', 'Esta Idempotency-Key ya se usó con otra petición');
        }
        if (previa.estado !== 'completada') {
          throw new ErrorApi(409, 'peticion_en_curso', 'Hay una petición con esta clave en curso; reintenta');
        }
        log('info', 'idempotencia_repeticion', { operacion });
        return { status: previa.codigo_respuesta, body: previa.respuesta, repetida: true };
      }

      await c.query('SAVEPOINT negocio');
      let resultado: Resultado;
      let errorNegocio: ErrorApi | undefined;
      try {
        resultado = await fn(c);
      } catch (e) {
        if (!(e instanceof ErrorApi) || e.getStatus() >= 500) throw e;
        await c.query('ROLLBACK TO SAVEPOINT negocio');
        errorNegocio = e;
        resultado = {
          status: e.getStatus(),
          body: { error: { codigo: e.codigo, mensaje: e.message, ...(e.detalles === undefined ? {} : { detalles: e.detalles }) } },
        };
      }

      await c.query(
        `UPDATE idempotency_keys
            SET estado = 'completada', codigo_respuesta = $4, respuesta = $5, completada_en = now()
          WHERE usuario_id = $1 AND operacion = $2 AND clave = $3`,
        [usuarioId, operacion, clave, resultado.status, JSON.stringify(resultado.body)],
      );
      await c.query('COMMIT');
      if (errorNegocio) throw errorNegocio;
      return { ...resultado, repetida: false };
    } catch (e) {
      // Si ya hubo COMMIT, este ROLLBACK no tiene efecto (solo avisa en el servidor).
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }
}

/** Aplica el status guardado y marca las repeticiones con `Idempotent-Replayed: true`. */
export function responder(res: Response, r: RespuestaIdempotente) {
  res.status(r.status);
  if (!r.repetida) return r.body;
  res.setHeader('Idempotent-Replayed', 'true');
  // Un error repetido conserva su forma, con la correlación de ESTA petición.
  if (r.status >= 400) return { ...(r.body as object), correlacion_id: contexto.getStore()?.correlacionId };
  return r.body;
}
