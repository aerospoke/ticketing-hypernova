/**
 * Billetera del asistente, disponible sin red.
 *
 * - Llave Ed25519 del dispositivo: se genera una vez y su privada vive en SecureStore.
 *   Solo la pública viaja al servidor (invariante 3: ninguna llave privada se transmite).
 * - Con red: se baja la lista de entradas y el material firmado de cada una, y se guardan
 *   en SQLite. Sin red: se usa lo guardado. El QR se genera localmente cada 15 s.
 */
import { base64url, desdeBase64url, type MaterialQr, nuevoParDispositivo, publicaDeDispositivo } from '@ticketing/shared';
import * as SecureStore from 'expo-secure-store';
import { api, ErrorApi } from './api';
import { db } from './db';

const CLAVE_PRIVADA = 'dispositivo_ed25519_v1';

export interface Entrada {
  id: string;
  estado: 'pagada' | 'transferida' | 'usada' | 'reembolsada' | 'anulada';
  version: number;
  evento_id: string;
  evento: string;
  fecha: string;
  recinto: string;
  zona: string;
  precio_centesimos: number;
  recibida_por_transferencia: boolean;
  transferencia_pendiente_id: string | null;
}

export interface MaterialGuardado extends MaterialQr {
  version: number;
  expira_en: string;
}

let parEnMemoria: { privada: Uint8Array; publica: string } | null = null;

/** Par del dispositivo (se crea la primera vez). */
export async function parDispositivo() {
  if (parEnMemoria) return parEnMemoria;
  const guardada = await SecureStore.getItemAsync(CLAVE_PRIVADA);
  if (guardada) {
    const privada = desdeBase64url(guardada);
    parEnMemoria = { privada, publica: publicaDeDispositivo(privada) };
  } else {
    const nuevo = nuevoParDispositivo();
    await SecureStore.setItemAsync(CLAVE_PRIVADA, base64url(nuevo.privada), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY, // no viaja en backups
    });
    parEnMemoria = nuevo;
  }
  return parEnMemoria;
}

/** Lista de entradas: del servidor si hay red, si no la última guardada. */
export async function cargarBilletera(usuarioId: string): Promise<{ entradas: Entrada[]; offline: boolean; guardada?: number }> {
  try {
    const r = await api<{ items: Entrada[] }>('/v1/me/entradas');
    db.runSync(
      'INSERT INTO billetera (usuario_id, datos, guardada) VALUES (?, ?, ?) ON CONFLICT (usuario_id) DO UPDATE SET datos = excluded.datos, guardada = excluded.guardada',
      usuarioId, JSON.stringify(r.items), Date.now(),
    );
    // Se prepara el material de las vigentes para que el QR funcione después sin red.
    void prepararMateriales(usuarioId, r.items.filter(vigente));
    return { entradas: r.items, offline: false };
  } catch (e) {
    if (!(e instanceof ErrorApi) || !e.sinConexion) throw e;
    const fila = db.getFirstSync<{ datos: string; guardada: number }>('SELECT datos, guardada FROM billetera WHERE usuario_id = ?', usuarioId);
    if (!fila) throw e;
    return { entradas: JSON.parse(fila.datos) as Entrada[], offline: true, guardada: fila.guardada };
  }
}

export const vigente = (e: Entrada) => e.estado === 'pagada' || e.estado === 'transferida';

/** Material del QR: se pide al servidor con la llave pública de este teléfono; sin red, el guardado. */
export async function obtenerMaterial(usuarioId: string, entradaId: string): Promise<{ material: MaterialGuardado; offline: boolean }> {
  const par = await parDispositivo();
  try {
    const m = await api<MaterialGuardado>(`/v1/entradas/${entradaId}/material`, {
      metodo: 'POST',
      cuerpo: { dispositivo_pubkey: par.publica },
    });
    guardarMaterial(usuarioId, entradaId, m, par.publica);
    return { material: m, offline: false };
  } catch (e) {
    if (!(e instanceof ErrorApi) || !e.sinConexion) {
      // La entrada ya no es nuestra o ya no vale: se olvida el material guardado.
      if (e instanceof ErrorApi && (e.status === 404 || e.status === 409)) db.runSync('DELETE FROM material WHERE entrada_id = ?', entradaId);
      throw e;
    }
    const m = db.getFirstSync<MaterialGuardado & { pk: string }>(
      'SELECT credencial, firma_servidor, version, expira_en, pk FROM material WHERE entrada_id = ? AND usuario_id = ?',
      entradaId, usuarioId,
    );
    // Solo sirve si se emitió para la llave de ESTE teléfono.
    if (!m || m.pk !== par.publica) throw e;
    return { material: m, offline: true };
  }
}

async function prepararMateriales(usuarioId: string, entradas: Entrada[]) {
  for (const e of entradas) {
    await obtenerMaterial(usuarioId, e.id).catch(() => undefined);
  }
}

function guardarMaterial(usuarioId: string, entradaId: string, m: MaterialGuardado, pk: string) {
  db.runSync(
    `INSERT INTO material (entrada_id, usuario_id, credencial, firma_servidor, version, pk, expira_en)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (entrada_id) DO UPDATE SET usuario_id = excluded.usuario_id, credencial = excluded.credencial,
       firma_servidor = excluded.firma_servidor, version = excluded.version, pk = excluded.pk, expira_en = excluded.expira_en`,
    entradaId, usuarioId, m.credencial, m.firma_servidor, m.version, pk, m.expira_en,
  );
}
