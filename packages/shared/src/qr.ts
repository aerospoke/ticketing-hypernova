/**
 * Código QR rotativo de una entrada (invariante 3). Lo usan los tres lados:
 *  - la API firma la CREDENCIAL con la llave Ed25519 del servidor;
 *  - la billetera genera el TOKEN cada 15 s firmando con la llave de SU dispositivo;
 *  - el escáner verifica todo SIN conexión, solo con llaves públicas.
 *
 * Formato:  T1.<credencial>.<firma_servidor>.<ts>.<firma_dispositivo>   (base64url)
 *
 * - credencial        JSON {v, e, ev, z, ver, pk, exp}: entrada, evento, zona, versión,
 *                     llave pública del dispositivo del titular y vencimiento.
 * - firma_servidor    Ed25519(servidor, "tkt-cred-v1|" + credencial)
 * - ts                segundos unix en que el teléfono generó este código
 * - firma_dispositivo Ed25519(dispositivo, "tkt-qr-v1|" + credencial + "|" + ts)
 *
 * Por qué es seguro:
 *  - Falsificar: sin la llave privada del servidor no se puede emitir una credencial.
 *  - Captura de pantalla: el escáner exige |ahora - ts| <= ventana (30 s).
 *  - Copiar la credencial a otro teléfono: falta la llave privada del dispositivo
 *    vinculado, que nunca sale del teléfono original.
 *  - Transferencia o cambio de teléfono: sube `ver` y la versión anterior entra en la
 *    lista de revocación que el escáner sincroniza.
 * Los prefijos ("tkt-cred-v1|", "tkt-qr-v1|") separan dominios: una firma de un tipo
 * nunca sirve como firma del otro.
 *
 * Sin dependencias de Node (corre en React Native): base64url y ASCII propios.
 */
import { ed25519 } from '@noble/curves/ed25519.js';

export const TOKEN_ROTACION_SEGUNDOS = 15;
export const VENTANA_SEGUNDOS = 30;
const PREFIJO_CRED = 'tkt-cred-v1|';
const PREFIJO_QR = 'tkt-qr-v1|';

export interface Credencial {
  v: 1;
  /** id de la entrada */
  e: string;
  /** id del evento */
  ev: string;
  /** id de la zona */
  z: string;
  /** versión de la entrada: sube con cada transferencia o cambio de dispositivo */
  ver: number;
  /** llave pública Ed25519 del dispositivo del titular (base64url, 32 bytes) */
  pk: string;
  /** vencimiento de la credencial (segundos unix) */
  exp: number;
}

/** Lo que entrega la API en "material para el código rotativo". */
export interface MaterialQr {
  credencial: string;
  firma_servidor: string;
}

export type MotivoRechazo =
  | 'formato_invalido'
  | 'firma_invalida'
  | 'expirado'
  | 'credencial_vencida'
  | 'otro_evento'
  | 'otra_zona'
  | 'revocada';

export type ResultadoQr =
  | { ok: true; credencial: Credencial; ts: number }
  | { ok: false; motivo: MotivoRechazo; credencial?: Credencial };

/** Estado de revocación de una entrada según la lista sincronizada en el escáner. */
export interface Revocacion {
  /** reembolsada o anulada: no entra nunca más */
  anulada: boolean;
  /** credenciales con `ver` menor a esto ya no valen */
  versionMinima: number;
}

export interface OpcionesVerificacion {
  /** llave pública del servidor (base64url, 32 bytes) */
  llavePublicaServidor: string;
  /** evento en el que está trabajando el escáner */
  eventoId: string;
  /** zonas que admite esta puerta; vacío o ausente = todas */
  zonas?: string[];
  /** segundos unix del escáner */
  ahora: number;
  ventanaSegundos?: number;
  revocacion?: (entradaId: string) => Revocacion | undefined;
}

// --- Firma y verificación ------------------------------------------------------------

/** Mensaje que firma el servidor (la API lo firma con node:crypto y la llave PEM). */
export function mensajeCredencial(credencialB64: string): Uint8Array {
  return ascii(PREFIJO_CRED + credencialB64);
}

export function codificarCredencial(c: Credencial): string {
  return base64url(ascii(JSON.stringify(c)));
}

/** Billetera: genera el token que se muestra como QR en el instante `ahora`. */
export function generarToken(material: MaterialQr, llavePrivadaDispositivo: Uint8Array, ahora: number): string {
  const ts = Math.floor(ahora);
  const firma = ed25519.sign(ascii(`${PREFIJO_QR}${material.credencial}|${ts}`), llavePrivadaDispositivo);
  return `T1.${material.credencial}.${material.firma_servidor}.${ts}.${base64url(firma)}`;
}

/** Escáner: verifica un token sin conexión. No consulta nada fuera de `opciones`. */
export function verificarToken(token: string, o: OpcionesVerificacion): ResultadoQr {
  const partes = token.trim().split('.');
  if (partes.length !== 5 || partes[0] !== 'T1' || !/^\d{1,12}$/.test(partes[3])) {
    return { ok: false, motivo: 'formato_invalido' };
  }
  const [, credB64, firmaSrvB64, tsTexto, firmaDispB64] = partes;

  let credencial: Credencial;
  let firmaSrv: Uint8Array;
  let firmaDisp: Uint8Array;
  try {
    credencial = JSON.parse(desdeAscii(desdeBase64url(credB64))) as Credencial;
    firmaSrv = desdeBase64url(firmaSrvB64);
    firmaDisp = desdeBase64url(firmaDispB64);
  } catch {
    return { ok: false, motivo: 'formato_invalido' };
  }
  if (!credencialBienFormada(credencial)) return { ok: false, motivo: 'formato_invalido' };

  // 1. La credencial la emitió el servidor (y nadie la alteró).
  if (!verificarFirma(firmaSrv, mensajeCredencial(credB64), desdeBase64url(o.llavePublicaServidor))) {
    return { ok: false, motivo: 'firma_invalida' };
  }
  // 2. Este código lo generó el dispositivo vinculado a la credencial.
  const ts = Number(tsTexto);
  if (!verificarFirma(firmaDisp, ascii(`${PREFIJO_QR}${credB64}|${ts}`), desdeBase64url(credencial.pk))) {
    return { ok: false, motivo: 'firma_invalida', credencial };
  }
  // 3. Recién generado: una foto o captura vieja queda fuera de la ventana.
  if (Math.abs(o.ahora - ts) > (o.ventanaSegundos ?? VENTANA_SEGUNDOS)) {
    return { ok: false, motivo: 'expirado', credencial };
  }
  if (o.ahora > credencial.exp) return { ok: false, motivo: 'credencial_vencida', credencial };
  // 4. Evento y zona correctos para esta puerta.
  if (credencial.ev !== o.eventoId) return { ok: false, motivo: 'otro_evento', credencial };
  if (o.zonas && o.zonas.length > 0 && !o.zonas.includes(credencial.z)) {
    return { ok: false, motivo: 'otra_zona', credencial };
  }
  // 5. Lista de revocación sincronizada: reembolsada, anulada o versión vieja.
  const rev = o.revocacion?.(credencial.e);
  if (rev && (rev.anulada || credencial.ver < rev.versionMinima)) {
    return { ok: false, motivo: 'revocada', credencial };
  }
  return { ok: true, credencial, ts };
}

/** Genera un par Ed25519 para el dispositivo (la privada se guarda en SecureStore). */
export function nuevoParDispositivo(): { privada: Uint8Array; publica: string } {
  const privada = ed25519.utils.randomSecretKey();
  return { privada, publica: base64url(ed25519.getPublicKey(privada)) };
}

function verificarFirma(firma: Uint8Array, mensaje: Uint8Array, llave: Uint8Array): boolean {
  if (firma.length !== 64 || llave.length !== 32) return false;
  try {
    return ed25519.verify(firma, mensaje, llave);
  } catch {
    return false;
  }
}

function credencialBienFormada(c: Credencial): boolean {
  return (
    typeof c === 'object' && c !== null && c.v === 1 &&
    typeof c.e === 'string' && typeof c.ev === 'string' && typeof c.z === 'string' &&
    Number.isInteger(c.ver) && c.ver >= 1 && typeof c.pk === 'string' && Number.isInteger(c.exp)
  );
}

// --- base64url y ASCII sin Buffer (React Native no lo tiene) ----------------------------

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const INDICE = new Map([...ALFABETO].map((ch, i) => [ch, i]));

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const quedan = bytes.length - i;
    s += ALFABETO[(n >> 18) & 63] + ALFABETO[(n >> 12) & 63];
    if (quedan > 1) s += ALFABETO[(n >> 6) & 63];
    if (quedan > 2) s += ALFABETO[n & 63];
  }
  return s;
}

export function desdeBase64url(s: string): Uint8Array {
  if (s.length % 4 === 1) throw new Error('base64url inválido');
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < s.length ? INDICE.get(s[i + k]) : 0));
    if (v.some((x) => x === undefined)) throw new Error('base64url inválido');
    const n = (v[0]! << 18) | (v[1]! << 12) | (v[2]! << 6) | v[3]!;
    out.push((n >> 16) & 255);
    if (i + 2 < s.length) out.push((n >> 8) & 255);
    if (i + 3 < s.length) out.push(n & 255);
  }
  return Uint8Array.from(out);
}

/** La credencial es ASCII puro (ids numéricos y base64url): no hace falta TextDecoder. */
function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 127) throw new Error('se esperaba ASCII');
    out[i] = c;
  }
  return out;
}

function desdeAscii(b: Uint8Array): string {
  let s = '';
  for (const c of b) {
    if (c > 127) throw new Error('se esperaba ASCII');
    s += String.fromCharCode(c);
  }
  return s;
}
