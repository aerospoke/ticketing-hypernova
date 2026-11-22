import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { contexto, log } from './contexto';

// Se acepta el ID que manda nginx o el cliente solo si tiene una forma razonable:
// evita que alguien inyecte texto arbitrario en los logs.
const ID_VALIDO = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Asigna un identificador de correlación a cada petición, lo devuelve en X-Request-Id
 * y escribe una línea de log al terminar con método, ruta, estado y duración.
 */
@Injectable()
export class CorrelacionMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const entrante = req.header('x-request-id');
    const correlacionId = entrante && ID_VALIDO.test(entrante) ? entrante : randomUUID();
    res.setHeader('X-Request-Id', correlacionId);
    const inicio = process.hrtime.bigint();

    contexto.run({ correlacionId }, () => {
      res.on('finish', () => {
        log('info', 'peticion', {
          metodo: req.method,
          ruta: req.originalUrl.split('?')[0],
          estado: res.statusCode,
          ms: Number((process.hrtime.bigint() - inicio) / 1_000_000n),
        });
      });
      next();
    });
  }
}
