import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import { contexto, log } from './contexto';

/**
 * Error de negocio con un código estable y accionable (el cliente decide por `codigo`,
 * no por el texto). Ej.: new ErrorApi(409, 'cupo_agotado', 'No quedan entradas en la zona').
 */
export class ErrorApi extends HttpException {
  constructor(
    status: number,
    readonly codigo: string,
    mensaje: string,
    readonly detalles?: unknown,
  ) {
    super(mensaje, status);
  }
}

/**
 * Forma única de error en toda la API:
 *   { "error": { "codigo", "mensaje", "detalles"? }, "correlacion_id" }
 * Los errores no previstos responden 500 genérico y se registran completos en el log;
 * el cliente nunca recibe stack traces ni mensajes internos de la base.
 */
@Catch()
export class FiltroErrores implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const correlacion_id = contexto.getStore()?.correlacionId;

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let codigo = 'error_interno';
    let mensaje = 'Ocurrió un error inesperado';
    let detalles: unknown;

    if (exception instanceof ErrorApi) {
      status = exception.getStatus();
      codigo = exception.codigo;
      mensaje = exception.message;
      detalles = exception.detalles;
    } else if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      codigo = 'demasiadas_peticiones';
      mensaje = 'Demasiadas peticiones; intenta de nuevo en un momento';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const cuerpo = exception.getResponse();
      codigo = CODIGOS[status] ?? 'error_http';
      if (typeof cuerpo === 'object' && cuerpo !== null) {
        const c = cuerpo as Record<string, unknown>;
        mensaje = typeof c.message === 'string' ? c.message : exception.message;
        // La validación de Nest entrega la lista de problemas en `message` (array) o `errors`.
        if (Array.isArray(c.message)) {
          mensaje = 'La petición no es válida';
          detalles = c.message;
        }
      } else {
        mensaje = String(cuerpo);
      }
    }

    if (status >= 500) {
      log('error', 'error_no_controlado', {
        error: exception instanceof Error ? { nombre: exception.name, mensaje: exception.message, stack: exception.stack } : String(exception),
      });
    }

    res.status(status).json({ error: { codigo, mensaje, ...(detalles === undefined ? {} : { detalles }) }, correlacion_id });
  }
}

const CODIGOS: Record<number, string> = {
  400: 'peticion_invalida',
  401: 'no_autenticado',
  403: 'prohibido',
  404: 'no_encontrado',
  409: 'conflicto',
  422: 'no_procesable',
  503: 'no_disponible',
};
