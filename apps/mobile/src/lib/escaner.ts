/**
 * Modo escáner del staff. Funciona con el modo avión encendido.
 *
 * Al escanear (sin red):
 *  1. verificarToken (de @ticketing/shared, la MISMA función que prueba el backend):
 *     firma del servidor, firma del dispositivo del titular, ventana de 30 s, evento,
 *     zona y lista de revocación sincronizada;
 *  2. si es válida pero ESTE escáner ya la dejó pasar -> "ya usada" (rechazo local);
 *  3. se guarda el escaneo en SQLite con un client_scan_id propio.
 * Al sincronizar: se suben los pendientes en lotes (el servidor resuelve el doble ingreso
 * entre puertas) y se bajan las revocaciones nuevas desde el cursor guardado.
 */
import { type MotivoRechazo, verificarToken } from '@ticketing/shared';
import { randomUUID } from 'expo-crypto';
import { api } from './api';
import { db, guardarAjuste, leerAjuste } from './db';

export interface EventoAsignado {
  id: string;
  nombre: string;
  recinto: string;
  fecha: string;
  puertas: { id: string; nombre: string }[];
  zonas: { id: string; nombre: string }[];
  /** Lo que este staff ya sincronizó en el evento (lo pendiente en el teléfono no cuenta). */
  mis_cifras: { validos: number; rechazos: number; dobles: number; incidentes_abiertos: number; ultimo_escaneo: string | null };
}

export interface Turno {
  turno_id: string;
  evento_id: string;
  evento: string;
  puerta_id: string;
  puerta: string;
}

export type Veredicto =
  | { tipo: 'valida'; entrada: string }
  | { tipo: 'ya_usada'; entrada: string }
  | { tipo: 'revocada'; entrada?: string }
  | { tipo: 'expirada' }
  | { tipo: 'otro_evento' }
  | { tipo: 'otra_zona' }
  | { tipo: 'invalida' };

const LOTE = 500;

// --- Preparación (con red) -----------------------------------------------------------

export async function prepararDispositivo(nombre: string) {
  let id = leerAjuste('dispositivo_id');
  if (!id) {
    id = randomUUID();
    guardarAjuste('dispositivo_id', id);
  }
  await api('/v1/escaner/dispositivos', { metodo: 'POST', cuerpo: { id, nombre, plataforma: 'expo' } });
  const { llave_publica } = await api<{ llave_publica: string }>('/v1/escaner/llave', { autenticado: false });
  guardarAjuste('llave_servidor', llave_publica);
  return id;
}

export function misEventos() {
  return api<EventoAsignado[]>('/v1/escaner/eventos');
}

export async function iniciarTurno(evento: EventoAsignado, puertaId: string): Promise<Turno> {
  const dispositivo = await prepararDispositivo('Escáner de puerta');
  const t = await api<{ id: string }>('/v1/escaner/turnos', {
    metodo: 'POST',
    cuerpo: { evento_id: evento.id, puerta_id: puertaId, dispositivo_id: dispositivo },
  });
  // Si cambia de evento, la lista de revocaciones local es de otro evento: se reinicia.
  if (leerAjuste('evento_id') !== evento.id) {
    db.runSync('DELETE FROM revocaciones');
    guardarAjuste('cursor_revocaciones', '0');
  }
  const turno: Turno = {
    turno_id: t.id,
    evento_id: evento.id,
    evento: evento.nombre,
    puerta_id: puertaId,
    puerta: evento.puertas.find((p) => p.id === puertaId)?.nombre ?? '',
  };
  guardarAjuste('evento_id', evento.id);
  guardarAjuste('turno', JSON.stringify(turno));
  await bajarRevocaciones();
  return turno;
}

export function turnoActual(): Turno | null {
  const t = leerAjuste('turno');
  return t ? (JSON.parse(t) as Turno) : null;
}

export async function terminarTurno() {
  const t = turnoActual();
  if (t) await api(`/v1/escaner/turnos/${t.turno_id}/cerrar`, { metodo: 'POST' }).catch(() => undefined);
  db.runSync(`DELETE FROM ajustes WHERE clave = 'turno'`);
}

// --- Escaneo (sin red) ---------------------------------------------------------------

export function escanear(token: string): Veredicto {
  const turno = turnoActual();
  const llave = leerAjuste('llave_servidor');
  if (!turno || !llave) return { tipo: 'invalida' };

  const r = verificarToken(token, {
    llavePublicaServidor: llave,
    eventoId: turno.evento_id,
    ahora: Math.floor(Date.now() / 1000),
    revocacion: (entradaId) => {
      const f = db.getFirstSync<{ anulada: number; version_minima: number }>(
        'SELECT anulada, version_minima FROM revocaciones WHERE entrada_id = ?',
        entradaId,
      );
      return f ? { anulada: f.anulada === 1, versionMinima: f.version_minima } : undefined;
    },
  });

  let veredicto: Veredicto;
  let resultado: 'valido' | 'rechazado' = 'rechazado';
  let motivo: string | undefined;
  if (r.ok) {
    const yaPaso = db.getFirstSync(`SELECT 1 FROM escaneos WHERE entrada_id = ? AND resultado = 'valido' LIMIT 1`, r.credencial.e);
    if (yaPaso) {
      veredicto = { tipo: 'ya_usada', entrada: r.credencial.e };
      motivo = 'ya_usada';
    } else {
      veredicto = { tipo: 'valida', entrada: r.credencial.e };
      resultado = 'valido';
    }
  } else {
    veredicto = traducir(r.motivo, r.credencial?.e);
    motivo = r.motivo;
  }

  db.runSync(
    `INSERT INTO escaneos (client_scan_id, turno_id, entrada_id, version, resultado, motivo, escaneado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(), turno.turno_id, r.credencial?.e ?? null, r.credencial?.ver ?? null, resultado, motivo ?? null,
    new Date().toISOString(),
  );
  return veredicto;
}

function traducir(m: MotivoRechazo, entrada?: string): Veredicto {
  switch (m) {
    case 'revocada': return { tipo: 'revocada', entrada };
    case 'expirado':
    case 'credencial_vencida': return { tipo: 'expirada' };
    case 'otro_evento': return { tipo: 'otro_evento' };
    case 'otra_zona': return { tipo: 'otra_zona' };
    default: return { tipo: 'invalida' };
  }
}

export function contarPendientes(): number {
  return db.getFirstSync<{ n: number }>('SELECT count(*) AS n FROM escaneos WHERE sincronizado = 0')?.n ?? 0;
}

export function resumenTurno(turnoId: string) {
  return db.getFirstSync<{ validos: number; rechazos: number }>(
    `SELECT sum(resultado = 'valido') AS validos, sum(resultado = 'rechazado') AS rechazos FROM escaneos WHERE turno_id = ?`,
    turnoId,
  ) ?? { validos: 0, rechazos: 0 };
}

// --- Sincronización (con red) --------------------------------------------------------

let sincronizando: Promise<{ subidos: number; duplicados: number }> | null = null;

/** Sube pendientes y baja revocaciones. Una sola a la vez (manual y automática no se pisan). */
export function sincronizar() {
  sincronizando ??= (async () => {
    try {
      const dispositivo = leerAjuste('dispositivo_id');
      let subidos = 0;
      let duplicados = 0;
      for (;;) {
        const lote = db.getAllSync<{
          client_scan_id: string; turno_id: string; entrada_id: string | null; version: number | null;
          resultado: 'valido' | 'rechazado'; motivo: string | null; escaneado_en: string;
        }>(
          `SELECT client_scan_id, turno_id, entrada_id, version, resultado, motivo, escaneado_en
             FROM escaneos WHERE sincronizado = 0 ORDER BY escaneado_en LIMIT ${LOTE}`,
        );
        if (lote.length === 0 || !dispositivo) break;
        const r = await api<{ resultados: { client_scan_id: string; resultado: string }[] }>('/v1/escaner/lotes', {
          metodo: 'POST',
          cuerpo: {
            dispositivo_id: dispositivo,
            cursor_revocaciones: Number(leerAjuste('cursor_revocaciones') ?? 0),
            escaneos: lote.map((e) => ({ ...e, motivo: e.motivo ?? undefined })),
          },
        });
        // Reenviar es seguro: si la app muere antes de marcar, el servidor responde "repetido".
        db.withTransactionSync(() => {
          for (const x of r.resultados) {
            db.runSync('UPDATE escaneos SET sincronizado = 1, resultado_servidor = ? WHERE client_scan_id = ?', x.resultado, x.client_scan_id);
            if (x.resultado === 'duplicado_offline') duplicados++;
          }
        });
        subidos += r.resultados.length;
        if (lote.length < LOTE) break;
      }
      await bajarRevocaciones();
      guardarAjuste('ultima_sync', new Date().toISOString());
      return { subidos, duplicados };
    } finally {
      sincronizando = null;
    }
  })();
  return sincronizando;
}

async function bajarRevocaciones() {
  const evento = leerAjuste('evento_id');
  if (!evento) return;
  for (;;) {
    const desde = Number(leerAjuste('cursor_revocaciones') ?? 0);
    const r = await api<{ items: { entrada_id: string; tipo: string; version_minima: number | null }[]; cursor: number; hay_mas: boolean }>(
      `/v1/escaner/eventos/${evento}/revocaciones?desde=${desde}`,
    );
    db.withTransactionSync(() => {
      for (const it of r.items) {
        if (it.tipo === 'entrada') {
          db.runSync(
            `INSERT INTO revocaciones (entrada_id, anulada) VALUES (?, 1) ON CONFLICT (entrada_id) DO UPDATE SET anulada = 1`,
            it.entrada_id,
          );
        } else {
          db.runSync(
            `INSERT INTO revocaciones (entrada_id, version_minima) VALUES (?, ?)
             ON CONFLICT (entrada_id) DO UPDATE SET version_minima = max(version_minima, excluded.version_minima)`,
            it.entrada_id, it.version_minima ?? 1,
          );
        }
      }
      guardarAjuste('cursor_revocaciones', String(r.cursor));
    });
    if (!r.hay_mas) break;
  }
}

export function ultimaSync(): string | null {
  return leerAjuste('ultima_sync');
}

export function ultimosEscaneos(turnoId: string, limite = 50) {
  return db.getAllSync<{ client_scan_id: string; entrada_id: string | null; resultado: string; motivo: string | null; escaneado_en: string; sincronizado: number; resultado_servidor: string | null }>(
    `SELECT client_scan_id, entrada_id, resultado, motivo, escaneado_en, sincronizado, resultado_servidor
       FROM escaneos WHERE turno_id = ? ORDER BY escaneado_en DESC LIMIT ?`,
    turnoId, limite,
  );
}
