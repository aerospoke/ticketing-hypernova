import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { firmarAccess, hashRefresh, nuevoRefresh, verificarAccess } from './tokens';

const llave = randomBytes(64);
const sesion = { usuarioId: '42', rol: 'asistente' as const, familiaId: 'fam-1' };

describe('tokens', () => {
  it('firma y verifica un access token', async () => {
    const t = await firmarAccess(sesion, llave);
    await expect(verificarAccess(t, llave)).resolves.toEqual(sesion);
  });

  it('rechaza un token firmado con otra llave', async () => {
    const t = await firmarAccess(sesion, randomBytes(64));
    await expect(verificarAccess(t, llave)).rejects.toThrow();
  });

  it('rechaza un token alterado (escalar rol a admin)', async () => {
    const t = await firmarAccess(sesion, llave);
    const [h, p, s] = t.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    payload.rol = 'admin';
    const alterado = [h, Buffer.from(JSON.stringify(payload)).toString('base64url'), s].join('.');
    await expect(verificarAccess(alterado, llave)).rejects.toThrow();
  });

  it('rechaza alg "none"', async () => {
    const t = await firmarAccess(sesion, llave);
    const [, p] = t.split('.');
    const h = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    await expect(verificarAccess(`${h}.${p}.`, llave)).rejects.toThrow();
  });

  it('rechaza un token expirado', async () => {
    const t = await new SignJWT({ rol: 'asistente', fam: 'f' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('1')
      .setIssuer('ticketing-api')
      .setAudience('ticketing')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(llave);
    await expect(verificarAccess(t, llave)).rejects.toThrow();
  });

  it('rechaza un token de otra audiencia', async () => {
    const t = await new SignJWT({ rol: 'asistente', fam: 'f' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('1')
      .setIssuer('ticketing-api')
      .setAudience('otra-app')
      .setExpirationTime('5m')
      .sign(llave);
    await expect(verificarAccess(t, llave)).rejects.toThrow();
  });

  it('refresh: aleatorio y con hash de 32 bytes', () => {
    const a = nuevoRefresh();
    expect(a).not.toBe(nuevoRefresh());
    expect(hashRefresh(a)).toHaveLength(32);
    expect(hashRefresh(a).equals(hashRefresh(a))).toBe(true);
  });
});
