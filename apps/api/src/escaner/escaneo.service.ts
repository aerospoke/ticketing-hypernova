import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { log } from '../common/contexto';
import { ErrorApi } from '../common/errores';
import { PG_POOL } from '../db/db.module';
import { enTransaccion } from '../db/transaccion';

export interface EscaneoLocal {
  client_scan_id: string;
  turno_id: string;
  entrada_id: string | null;
  version: number | null;
  /** lo que decidió el escáner SIN red */
  resultado: 'valido' | 'rechazado';
  motivo?: string;
  escaneado_en: string;
}

export interface ResultadoSync {
  client_scan_id: string;
  resultado: 'valido' | 'duplicado_offline' | 'rechazado';
  /** true si este client_scan_id ya se había sincronizado antes (reenvío del lote) */
  repetido: boolean;
  incidente_id?: string;
}

// Motivos del escáner -> motivos que guarda la tabla ingresos.
const MOTIVOS: Record<string, string> = {
  firma_invalida: 'firma_invalida',
  formato_invalido: 'firma_invalida',
  expirado: 'expirado',
  credencial_vencida: 'expirado',
  revocada: 'revocada',
  ya_usada: 'ya_usada',
  otro_evento: 'otro_evento',
  otra_zona: 'otra_zona',
};

interface Turno {
  id: string;
  evento_id: string;
  puerta_id: string;
  staff_id: string;
  dispositivo_id: string;
}

/**
 * Sincronización de escaneos offline (invariante 4).
 *
 * Cada escaneo va en su PROPIA transacción: un lote de miles no retiene locks mucho
 * tiempo, y si algo falla a mitad, lo ya procesado queda; reenviar el lote es seguro
 * porque client_scan_id es UNIQUE.
 *
 * Para un escaneo que el dispositivo dio por válido:
 *   INSERT ... 'valido' ON CONFLICT DO NOTHING
 * Sin columna en ON CONFLICT cubre TODOS los índices únicos: el de client_scan_id (reenvío)
 * y el parcial "un solo 'valido' por entrada". Si no insertó:
 *   - el client_scan_id ya existía -> reenvío, se devuelve lo que se decidió entonces;
 *   - si no, otra puerta ya registró el ingreso válido -> se guarda como
 *     'duplicado_offline' y se abre un incidente 'doble_ingreso'. Nada se borra.
 * Dos puertas sincronizando a la vez: el segundo INSERT espera en el índice único al
 * primero, y cuando este confirma, cae en "duplicado". Exactamente un válido.
 *
 * Criterio: queda como válido el que SINCRONIZA primero (no el que escaneó primero). Los
 * dos ingresos y sus horas de escaneo quedan en el incidente para revisión humana.
 */
@Injectable()
export class EscaneoService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Registro (o renombre) del dispositivo. El id lo genera el teléfono. */
  async registrarDispositivo(staffId: string, id: string, nombre: string, plataforma?: string) {
    const { rows } = await this.pool.query(
      `INSERT INTO dispositivos (id, staff_id, nombre, plataforma) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, plataforma = EXCLUDED.plataforma
         WHERE dispositivos.staff_id = EXCLUDED.staff_id
       RETURNING id, nombre, plataforma, registrado_en, ultima_sync`,
      [id, staffId, nombre, plataforma ?? null],
    );
    if (!rows[0]) throw new ErrorApi(409, 'dispositivo_de_otro', 'El dispositivo está registrado por otro miembro del staff');
    return rows[0];
  }

  /** Inicio de turno: staff + puerta + dispositivo. Un turno abierto por dispositivo. */
  async abrirTurno(staffId: string, eventoId: string, puertaId: string, dispositivoId: string) {
    return enTransaccion(this.pool, async (c) => {
      const asignado = await c.query('SELECT 1 FROM asignaciones_staff WHERE evento_id = $1 AND staff_id = $2', [eventoId, staffId]);
      if (!asignado.rowCount) throw new ErrorApi(404, 'evento_no_encontrado', 'El evento no existe o no tienes acceso');
      const puerta = await c.query('SELECT 1 FROM puertas WHERE id = $1 AND evento_id = $2', [puertaId, eventoId]);
      if (!puerta.rowCount) throw new ErrorApi(404, 'puerta_no_encontrada', 'La puerta no pertenece al evento');
      await this.exigirDispositivoPropio(c, dispositivoId, staffId);

      // Cambiar de puerta = cerrar el turno anterior del dispositivo y abrir otro.
      await c.query('UPDATE turnos SET fin = now() WHERE dispositivo_id = $1 AND fin IS NULL', [dispositivoId]);
      const { rows } = await c.query(
        `INSERT INTO turnos (staff_id, evento_id, puerta_id, dispositivo_id) VALUES ($1, $2, $3, $4)
         RETURNING id, evento_id, puerta_id, dispositivo_id, inicio`,
        [staffId, eventoId, puertaId, dispositivoId],
      );
      log('info', 'turno_abierto', { turno: rows[0].id, puerta: puertaId });
      return rows[0];
    });
  }

  async cerrarTurno(staffId: string, turnoId: string) {
    const { rows } = await this.pool.query(
      `UPDATE turnos SET fin = now() WHERE id = $1 AND staff_id = $2 AND fin IS NULL RETURNING id, fin`,
      [turnoId, staffId],
    );
    if (!rows[0]) throw new ErrorApi(404, 'turno_no_encontrado', 'No hay un turno abierto con ese id');
    return rows[0];
  }

  async sincronizar(staffId: string, dispositivoId: string, escaneos: EscaneoLocal[], cursorRevocaciones?: number) {
    await this.exigirDispositivoPropio(this.pool, dispositivoId, staffId);

    const turnos = new Map<string, Turno>();
    const ids = [...new Set(escaneos.map((e) => e.turno_id))];
    const { rows } = await this.pool.query<Turno>(
      `SELECT id, evento_id, puerta_id, staff_id, dispositivo_id FROM turnos
        WHERE id = ANY($1::bigint[]) AND staff_id = $2 AND dispositivo_id = $3`,
      [ids, staffId, dispositivoId],
    );
    rows.forEach((t) => turnos.set(t.id, t));
    const faltante = ids.find((id) => !turnos.has(id));
    if (faltante) throw new ErrorApi(404, 'turno_no_encontrado', `El turno ${faltante} no es de este dispositivo`);

    // En el orden en que se escanearon en el dispositivo.
    const ordenados = [...escaneos].sort((a, b) => a.escaneado_en.localeCompare(b.escaneado_en));
    const resultados: ResultadoSync[] = [];
    for (const e of ordenados) {
      resultados.push(await enTransaccion(this.pool, (c) => this.procesar(c, turnos.get(e.turno_id)!, e)));
    }

    await this.pool.query(
      `UPDATE dispositivos SET ultima_sync = now(), cursor_revocaciones = GREATEST(cursor_revocaciones, $2) WHERE id = $1`,
      [dispositivoId, cursorRevocaciones ?? 0],
    );
    const resumen = resultados.reduce<Record<string, number>>((acc, r) => ((acc[r.resultado] = (acc[r.resultado] ?? 0) + 1), acc), {});
    log('info', 'lote_sincronizado', { dispositivo: dispositivoId, escaneos: escaneos.length, ...resumen });
    return { procesados: resultados.length, resultados };
  }

  // ---------------------------------------------------------------------------

  private async procesar(c: PoolClient, t: Turno, e: EscaneoLocal): Promise<ResultadoSync> {
    const repetido = await this.yaSincronizado(c, e.client_scan_id);
    if (repetido) return repetido;

    // ¿La entrada existe y es de este evento? Si el escáner aceptó una que no lo es, se
    // registra como rechazo: nunca se marca usada una entrada de otro evento.
    let entrada: { id: string; estado: string; evento_id: string } | undefined;
    if (e.entrada_id) {
      const r = await c.query<{ id: string; estado: string; evento_id: string }>(
        'SELECT id, estado, evento_id FROM entradas WHERE id = $1 FOR UPDATE',
        [e.entrada_id],
      );
      entrada = r.rows[0];
    }
    const deOtroEvento = !entrada || entrada.evento_id !== t.evento_id;

    if (e.resultado === 'rechazado' || deOtroEvento) {
      const motivo = e.resultado === 'rechazado' ? (MOTIVOS[e.motivo ?? ''] ?? 'firma_invalida') : 'otro_evento';
      const ingreso = await this.insertar(c, t, e, deOtroEvento ? null : entrada!.id, 'rechazado', motivo);
      let incidente: string | undefined;
      if (motivo === 'firma_invalida') {
        incidente = await this.incidente(c, 'firma_invalida', t, ingreso, deOtroEvento ? null : entrada!.id, {
          client_scan_id: e.client_scan_id, escaneado_en: e.escaneado_en, puerta_id: t.puerta_id,
        });
      }
      return { client_scan_id: e.client_scan_id, resultado: 'rechazado', repetido: false, incidente_id: incidente };
    }

    // El escáner lo dio por válido: se intenta registrar como el ingreso válido.
    const valido = await c.query<{ id: string }>(
      `INSERT INTO ingresos (client_scan_id, entrada_id, evento_id, puerta_id, staff_id, dispositivo_id, turno_id,
                             version_entrada, resultado, escaneado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'valido', $9)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [e.client_scan_id, entrada!.id, t.evento_id, t.puerta_id, t.staff_id, t.dispositivo_id, t.id, e.version, e.escaneado_en],
    );

    if (valido.rows[0]) {
      const usada = await c.query(
        `UPDATE entradas SET estado = 'usada', usada_en = $2 WHERE id = $1 AND estado IN ('pagada', 'transferida')`,
        [entrada!.id, e.escaneado_en],
      );
      // Entró una entrada que ya estaba reembolsada o anulada: el escáner no tenía la
      // revocación. El ingreso ocurrió y se registra; se avisa para revisión.
      let incidente: string | undefined;
      if (!usada.rowCount) {
        incidente = await this.incidente(c, 'escaner_desincronizado', t, valido.rows[0].id, entrada!.id, {
          estado_entrada: entrada!.estado, client_scan_id: e.client_scan_id,
        });
      }
      return { client_scan_id: e.client_scan_id, resultado: 'valido', repetido: false, incidente_id: incidente };
    }

    // No insertó: o es un reenvío que llegó en paralelo, o ya hay un ingreso válido.
    const reenvio = await this.yaSincronizado(c, e.client_scan_id);
    if (reenvio) return reenvio;

    const previo = await c.query<{ id: string; puerta_id: string; escaneado_en: Date; dispositivo_id: string | null }>(
      `SELECT id, puerta_id, escaneado_en, dispositivo_id FROM ingresos WHERE entrada_id = $1 AND resultado = 'valido'`,
      [entrada!.id],
    );
    const duplicado = await this.insertar(c, t, e, entrada!.id, 'duplicado_offline', null);
    const incidente = await this.incidente(c, 'doble_ingreso', t, duplicado, entrada!.id, {
      ingreso_valido: { id: previo.rows[0].id, puerta_id: previo.rows[0].puerta_id, escaneado_en: previo.rows[0].escaneado_en, dispositivo_id: previo.rows[0].dispositivo_id },
      ingreso_duplicado: { id: duplicado, puerta_id: t.puerta_id, escaneado_en: e.escaneado_en, dispositivo_id: t.dispositivo_id },
    });
    log('warn', 'doble_ingreso_detectado', { entrada: entrada!.id, incidente });
    return { client_scan_id: e.client_scan_id, resultado: 'duplicado_offline', repetido: false, incidente_id: incidente };
  }

  private async yaSincronizado(c: PoolClient, clientScanId: string): Promise<ResultadoSync | undefined> {
    const { rows } = await c.query<{ resultado: ResultadoSync['resultado']; incidente_id: string | null }>(
      `SELECT i.resultado, (SELECT x.id FROM incidentes x WHERE x.ingreso_id = i.id ORDER BY x.id LIMIT 1) AS incidente_id
         FROM ingresos i WHERE i.client_scan_id = $1`,
      [clientScanId],
    );
    if (!rows[0]) return undefined;
    return { client_scan_id: clientScanId, resultado: rows[0].resultado, repetido: true, incidente_id: rows[0].incidente_id ?? undefined };
  }

  private async insertar(c: PoolClient, t: Turno, e: EscaneoLocal, entradaId: string | null, resultado: string, motivo: string | null) {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO ingresos (client_scan_id, entrada_id, evento_id, puerta_id, staff_id, dispositivo_id, turno_id,
                             version_entrada, resultado, motivo_rechazo, escaneado_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [e.client_scan_id, entradaId, t.evento_id, t.puerta_id, t.staff_id, t.dispositivo_id, t.id, e.version, resultado, motivo, e.escaneado_en],
    );
    return rows[0].id;
  }

  private async incidente(c: PoolClient, tipo: string, t: Turno, ingresoId: string, entradaId: string | null, detalle: object) {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO incidentes (tipo, evento_id, entrada_id, ingreso_id, dispositivo_id, detalle)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tipo, t.evento_id, entradaId, ingresoId, t.dispositivo_id, JSON.stringify(detalle)],
    );
    return rows[0].id;
  }

  private async exigirDispositivoPropio(db: Pool | PoolClient, dispositivoId: string, staffId: string) {
    const { rowCount } = await db.query('SELECT 1 FROM dispositivos WHERE id = $1 AND staff_id = $2', [dispositivoId, staffId]);
    if (!rowCount) throw new ErrorApi(404, 'dispositivo_no_encontrado', 'Dispositivo no registrado por este usuario');
  }
}
