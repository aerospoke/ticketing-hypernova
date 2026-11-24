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

/**
 * URL vigente. Se lee una vez de SQLite y después queda en memoria. Un valor guardado que no
 * pasa la validación (por ejemplo, de una versión anterior más permisiva) se ignora.
 */
export function apiUrl(): string {
  if (enMemoria) return enMemoria;
  const guardada = leerAjuste(CLAVE);
  let url = SERVIDOR_POR_DEFECTO;
  if (guardada) {
    try {
      url = validarServidor(guardada);
    } catch {
      // inválida: se queda la de por defecto
    }
  }
  enMemoria = url;
  return url;
}

/** Valida y guarda la URL. Lanza un Error con un texto para mostrar si no es válida. */
export function cambiarServidor(texto: string): string {
  const url = validarServidor(texto);
  guardarAjuste(CLAVE, url);
  enMemoria = url;
  return url;
}

/** Normaliza y valida una dirección. Lanza un Error con un texto para mostrar si no es válida. */
function validarServidor(texto: string): string {
  const ejemplo = 'Escribe una dirección como http://192.168.1.50:3000';
  // Se acepta con o sin "http://"; un esquema a medio escribir ("http:", "http:/") se descarta.
  let url = normalizar(texto).replace(/^https?:\/{0,2}(?=[^/]|$)/i, (m) => (m.toLowerCase().startsWith('https') ? 'https://' : 'http://'));
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(ejemplo);
  }
  // Solo una IPv4 completa, "localhost" o un nombre con punto: "http" o "192.168.1." no valen.
  // Se valida el host TAL COMO SE ESCRIBIÓ: el parser de URL "completa" IPs abreviadas
  // ("192.168.1." pasa a ser 192.168.0.1) y se guardaría una dirección que nadie escribió.
  const host = url.replace(/^https?:\/\//i, '').split(/[:/?#]/)[0].toLowerCase();
  if (host !== u.hostname) throw new Error(ejemplo);
  const esIp = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  const ipValida = esIp !== null && esIp.slice(1).every((n) => Number(n) <= 255);
  const nombreValido = host === 'localhost' || (!/^[\d.]+$/.test(host) && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host));
  if (!ipValida && !nombreValido) throw new Error(ejemplo);
  if (u.pathname !== '/' && u.pathname !== '') {
    throw new Error('Escribe solo la dirección y el puerto, por ejemplo http://192.168.1.50:3000');
  }
  return `${u.protocol}//${u.host}`;
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
