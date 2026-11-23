/**
 * React Native no trae `crypto.getRandomValues` (Web Crypto). @noble/curves lo usa solo
 * para generar la llave privada del dispositivo; las firmas Ed25519 son deterministas.
 * Se toma del generador del sistema operativo vía expo-crypto. Importar ANTES que nada.
 */
import { getRandomValues } from 'expo-crypto';

type ConCrypto = { crypto?: { getRandomValues?: <T extends ArrayBufferView>(a: T) => T } };
const g = globalThis as unknown as ConCrypto;
g.crypto ??= {};
g.crypto.getRandomValues ??= <T extends ArrayBufferView>(a: T): T => getRandomValues(a as unknown as Uint8Array) as unknown as T;
