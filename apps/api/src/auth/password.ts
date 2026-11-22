/**
 * Hash de contraseñas con scrypt (incluido en Node: sin dependencias nativas que
 * compilar en la imagen). scrypt es costoso en memoria, lo que encarece ataques con GPU.
 *
 * Formato autodescriptivo: scrypt$N$r$p$salt$hash (base64url). Guardar los parámetros
 * en el hash permite subir el costo en el futuro sin invalidar contraseñas existentes.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

const N = 2 ** 15;
const R = 8;
const P = 1;
const LARGO = 32;
// scrypt necesita ~128 * N * r bytes; con N = 2^15 son 32 MiB, por encima del límite por defecto.
const MAXMEM = 64 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFKC'), salt, LARGO, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function verificarPassword(password: string, almacenado: string): Promise<boolean> {
  const partes = almacenado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = partes;
  const esperado = Buffer.from(hashB64, 'base64url');
  const obtenido = await scrypt(password, Buffer.from(saltB64, 'base64url'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  // Comparación en tiempo constante: no filtra cuántos bytes coinciden.
  return obtenido.length === esperado.length && timingSafeEqual(obtenido, esperado);
}
