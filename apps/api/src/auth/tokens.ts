/**
 * Tokens de sesión.
 *
 * Access token: JWT HS256 de vida corta (10 min). Lo firma y lo verifica solo la API,
 *   por eso basta una llave simétrica (a diferencia del QR, que se verifica offline en
 *   el escáner y por eso usa Ed25519). Lleva `fam` = familia de la sesión, para que el
 *   guard pueda rechazarlo apenas se hace logout.
 *
 * Refresh token: 32 bytes aleatorios opacos (no es JWT: no hay nada que leer en él).
 *   En la base se guarda solo su SHA-256.
 */
import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';

export const ACCESS_TTL_S = 10 * 60;
export const REFRESH_TTL_S = 30 * 24 * 60 * 60;
const EMISOR = 'ticketing-api';
const AUDIENCIA = 'ticketing';

export type Rol = 'asistente' | 'staff' | 'organizador' | 'admin';

export interface Sesion {
  usuarioId: string;
  rol: Rol;
  familiaId: string;
}

export async function firmarAccess(s: Sesion, llave: Uint8Array): Promise<string> {
  return new SignJWT({ rol: s.rol, fam: s.familiaId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(s.usuarioId)
    .setIssuer(EMISOR)
    .setAudience(AUDIENCIA)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_S}s`)
    .sign(llave);
}

/** Lanza si la firma, el emisor, la audiencia o la expiración no son válidos. */
export async function verificarAccess(token: string, llave: Uint8Array): Promise<Sesion> {
  const { payload } = await jwtVerify(token, llave, {
    // Fijar el algoritmo evita ataques de "alg: none" o de confusión de algoritmo.
    algorithms: ['HS256'],
    issuer: EMISOR,
    audience: AUDIENCIA,
  });
  if (typeof payload.sub !== 'string' || typeof payload.rol !== 'string' || typeof payload.fam !== 'string') {
    throw new Error('claims incompletos');
  }
  return { usuarioId: payload.sub, rol: payload.rol as Rol, familiaId: payload.fam };
}

export function nuevoRefresh(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefresh(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}
