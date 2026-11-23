/**
 * Cliente HTTP de la API.
 * - Errores con la forma única del backend: el código (`codigo`) decide la UX, no el texto.
 * - Si el access token expiró, lo renueva con el refresh UNA vez y reintenta. Los refresh
 *   concurrentes comparten una sola petición: el backend detecta el reuso de un refresh
 *   como robo y cerraría la sesión si dos pantallas refrescaran a la vez.
 * - Timeout de 15 s: sin red, la app no queda colgada.
 */
import { apiUrl } from './config';
import { borrarSesion, guardarSesion, sesionActual, type Usuario } from './sesion';

export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensaje: string,
    readonly detalles?: unknown,
  ) {
    super(mensaje);
  }
  get sinConexion() {
    return this.status === 0;
  }
}

interface Opciones {
  metodo?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  cuerpo?: unknown;
  /** Idempotency-Key: obligatoria en lo que mueve dinero. Generarla UNA vez por intención. */
  clave?: string;
  autenticado?: boolean;
}

export async function api<T>(ruta: string, o: Opciones = {}): Promise<T> {
  const r = await pedir(ruta, o);
  if (r.status === 401 && o.autenticado !== false && sesionActual()) {
    const cuerpo = await r.clone().json().catch(() => null);
    if (cuerpo?.error?.codigo === 'token_invalido' && (await refrescar())) {
      return interpretar<T>(await pedir(ruta, o));
    }
    if (cuerpo?.error?.codigo === 'sesion_cerrada') await borrarSesion();
  }
  return interpretar<T>(r);
}

async function pedir(ruta: string, o: Opciones): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (o.cuerpo !== undefined) headers['Content-Type'] = 'application/json';
  if (o.clave) headers['Idempotency-Key'] = o.clave;
  const s = sesionActual();
  if (s && o.autenticado !== false) headers.Authorization = `Bearer ${s.access}`;

  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), 15_000);
  try {
    return await fetch(`${apiUrl()}${ruta}`, {
      method: o.metodo ?? 'GET',
      headers,
      body: o.cuerpo === undefined ? undefined : JSON.stringify(o.cuerpo),
      signal: control.signal,
    });
  } catch (e) {
    // En desarrollo se registra la causa real (DNS, timeout, cleartext bloqueado...).
    if (__DEV__) console.warn(`fetch ${o.metodo ?? 'GET'} ${apiUrl()}${ruta} falló:`, String(e));
    throw new ErrorApi(0, 'sin_conexion', 'Sin conexión con el servidor');
  } finally {
    clearTimeout(timer);
  }
}

async function interpretar<T>(r: Response): Promise<T> {
  if (r.status === 204) return undefined as T;
  const cuerpo = await r.json().catch(() => null);
  if (!r.ok) {
    const e = cuerpo?.error;
    throw new ErrorApi(r.status, e?.codigo ?? 'error_http', e?.mensaje ?? `Error ${r.status}`, e?.detalles);
  }
  return cuerpo as T;
}

let refrescando: Promise<boolean> | null = null;
function refrescar(): Promise<boolean> {
  refrescando ??= (async () => {
    const s = sesionActual();
    if (!s) return false;
    try {
      const r = await pedir('/v1/auth/refresh', { metodo: 'POST', cuerpo: { refresh_token: s.refresh }, autenticado: false });
      if (!r.ok) {
        await borrarSesion();
        return false;
      }
      const par = (await r.json()) as ParTokens;
      await guardarSesion({ access: par.access_token, refresh: par.refresh_token, usuario: par.usuario });
      return true;
    } catch {
      return false; // sin red: se conserva la sesión, se reintentará
    } finally {
      refrescando = null;
    }
  })();
  return refrescando;
}

export interface ParTokens {
  access_token: string;
  refresh_token: string;
  usuario: Usuario;
}

export async function iniciarSesion(email: string, password: string) {
  const par = await api<ParTokens>('/v1/auth/login', { metodo: 'POST', cuerpo: { email, password }, autenticado: false });
  await guardarSesion({ access: par.access_token, refresh: par.refresh_token, usuario: par.usuario });
  return par.usuario;
}

export async function registrarse(nombre: string, email: string, password: string) {
  const par = await api<ParTokens>('/v1/auth/registro', { metodo: 'POST', cuerpo: { nombre, email, password }, autenticado: false });
  await guardarSesion({ access: par.access_token, refresh: par.refresh_token, usuario: par.usuario });
  return par.usuario;
}

/** Logout real: el servidor revoca la sesión. Si no hay red, igual se borra localmente. */
export async function cerrarSesion() {
  const s = sesionActual();
  if (s) {
    await api('/v1/auth/logout', { metodo: 'POST', cuerpo: { refresh_token: s.refresh }, autenticado: false }).catch(() => undefined);
  }
  await borrarSesion();
}

/** Texto para mostrar al usuario según el código de error de la API. */
export function mensajeDeError(e: unknown): string {
  if (!(e instanceof ErrorApi)) return 'Ocurrió un error inesperado';
  const textos: Record<string, string> = {
    sin_conexion: 'Sin conexión. Revisa tu red e inténtalo de nuevo.',
    credenciales_invalidas: 'Correo o contraseña incorrectos.',
    email_en_uso: 'Ya existe una cuenta con ese correo.',
    cupo_agotado: 'Ya no quedan entradas suficientes en esta zona.',
    limite_por_cuenta: 'Alcanzaste el máximo de entradas por cuenta para este evento.',
    fuera_de_venta: 'Esta zona no está a la venta en este momento.',
    demasiadas_peticiones: 'Demasiados intentos. Espera un momento.',
    fuera_de_plazo: 'Ya pasó la fecha límite de reembolso.',
    entrada_usada: 'La entrada ya fue usada.',
    destinatario_no_encontrado: 'No hay una cuenta con ese correo.',
    transferencia_pendiente: 'Esta entrada ya tiene una transferencia pendiente.',
    solo_el_comprador: 'Solo quien pagó la entrada puede pedir el reembolso.',
  };
  return textos[e.codigo] ?? e.message;
}
