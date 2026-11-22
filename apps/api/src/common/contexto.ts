import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto por petición (correlación y usuario), disponible en cualquier capa sin
 * pasarlo de función en función. AsyncLocalStorage sigue el hilo async de cada request.
 */
export interface ContextoPeticion {
  correlacionId: string;
  usuarioId?: string;
}

export const contexto = new AsyncLocalStorage<ContextoPeticion>();

/** Log estructurado: una línea JSON con la correlación de la petición en curso. */
export function log(nivel: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}) {
  const ctx = contexto.getStore();
  const linea = JSON.stringify({
    ts: new Date().toISOString(),
    nivel,
    servicio: 'api',
    msg,
    correlacion_id: ctx?.correlacionId,
    usuario_id: ctx?.usuarioId,
    ...extra,
  });
  if (nivel === 'error') console.error(linea);
  else console.log(linea);
}
