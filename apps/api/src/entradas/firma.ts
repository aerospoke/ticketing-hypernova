import { createPrivateKey, createPublicKey, type KeyObject, sign } from 'node:crypto';
import { type Credencial, codificarCredencial, type MaterialQr, mensajeCredencial } from '@ticketing/shared';
import { leerSecreto } from '../db/config';

export const FIRMA_ENTRADAS = Symbol('FIRMA_ENTRADAS');

/**
 * Firma de credenciales de entrada con la llave Ed25519 del servidor.
 * La privada vive solo en el volumen de secretos de la API (la genera `secrets`); la
 * pública se publica para que el escáner verifique sin conexión.
 */
export class FirmaEntradas {
  readonly llavePublica: string;

  constructor(private readonly privada: KeyObject) {
    const jwk = createPublicKey(privada).export({ format: 'jwk' });
    if (jwk.crv !== 'Ed25519' || !jwk.x) throw new Error('La llave de firma de entradas no es Ed25519');
    this.llavePublica = jwk.x; // 32 bytes en base64url
  }

  static desdeSecreto(): FirmaEntradas {
    return new FirmaEntradas(createPrivateKey(leerSecreto('TICKET_SIGNING_KEY')));
  }

  firmar(c: Credencial): MaterialQr {
    const credencial = codificarCredencial(c);
    // Ed25519 no usa función de hash externa: el algoritmo va en null.
    const firma = sign(null, mensajeCredencial(credencial), this.privada);
    return { credencial, firma_servidor: firma.toString('base64url') };
  }
}

export const firmaEntradasProvider = { provide: FIRMA_ENTRADAS, useFactory: () => FirmaEntradas.desdeSecreto() };
