/**
 * Sesión del usuario: tokens en SecureStore (Keychain / Keystore), nunca en texto plano.
 * Módulo singleton con suscriptores: el cliente HTTP la lee y la renueva; la UI se suscribe.
 */
import * as SecureStore from 'expo-secure-store';

export type Rol = 'asistente' | 'staff' | 'organizador' | 'admin';
export interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: Rol;
}
export interface Sesion {
  access: string;
  refresh: string;
  usuario: Usuario;
}

const CLAVE = 'sesion_v1';
let actual: Sesion | null = null;
let cargada = false;
const oyentes = new Set<() => void>();

export function sesionActual() {
  return actual;
}
export function sesionCargada() {
  return cargada;
}

export function suscribir(fn: () => void) {
  oyentes.add(fn);
  return () => void oyentes.delete(fn);
}

export async function cargarSesion() {
  try {
    const crudo = await SecureStore.getItemAsync(CLAVE);
    actual = crudo ? (JSON.parse(crudo) as Sesion) : null;
  } catch {
    actual = null;
  }
  cargada = true;
  avisar();
}

export async function guardarSesion(s: Sesion) {
  actual = s;
  await SecureStore.setItemAsync(CLAVE, JSON.stringify(s));
  avisar();
}

export async function borrarSesion() {
  actual = null;
  await SecureStore.deleteItemAsync(CLAVE);
  avisar();
}

function avisar() {
  oyentes.forEach((fn) => fn());
}
