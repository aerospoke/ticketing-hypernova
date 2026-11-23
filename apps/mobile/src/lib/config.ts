/**
 * URL del backend.
 *
 * 1. Lo que el usuario guardó desde el login ("Servidor · Cambiar"), en SQLite. Así un mismo
 *    APK sirve en cualquier red: el evaluador escribe la IP de su máquina.
 * 2. Si no guardó nada, la que se definió al iniciar Expo o al compilar:
 *      EXPO_PUBLIC_API_URL=http://192.168.1.50:3000 npx expo start
 *    - Emulador Android: http://<IP de tu Mac en la LAN>:3000 (con Docker Desktop, 10.0.2.2 no llega)
 *    - Simulador iOS:    http://localhost:3000
 *    - Teléfono físico:  http://<IP de tu PC en la LAN>:3000 (API levantada con API_BIND=0.0.0.0)
 *
 * El servidor solo se cambia sin sesión abierta (desde el login): los tokens de un servidor
 * nunca se envían a otro.
 */
import { guardarAjuste, leerAjuste } from './db';

const CLAVE = 'servidor_api';
export const SERVIDOR_POR_DEFECTO = normalizar(process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000');

let enMemoria: string | null = null;

function normalizar(url: string) {
  return url.trim().replace(/\/+$/, '');
}

/** URL vigente. Se lee una vez de SQLite y después queda en memoria. */
export function apiUrl(): string {
  enMemoria ??= leerAjuste(CLAVE) ?? SERVIDOR_POR_DEFECTO;
  return enMemoria;
}

/** Valida y guarda la URL. Lanza un Error con un texto para mostrar si no es válida. */
export function cambiarServidor(texto: string): string {
  let url = normalizar(texto);
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('Escribe una dirección como http://192.168.1.50:3000');
  }
  if (!u.hostname || (u.pathname !== '/' && u.pathname !== '')) {
    throw new Error('Escribe solo la dirección y el puerto, por ejemplo http://192.168.1.50:3000');
  }
  url = `${u.protocol}//${u.host}`;
  guardarAjuste(CLAVE, url);
  enMemoria = url;
  return url;
}

/** ¿Responde la API en esa dirección? Consulta /health con un timeout corto. */
export async function probarServidor(url = apiUrl()): Promise<boolean> {
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), 5000);
  try {
    const r = await fetch(`${url}/health`, { signal: control.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
