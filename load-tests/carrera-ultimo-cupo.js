// Carrera por el último cupo (invariante 1).
//
// 200 compradores concurrentes compiten por las 50 entradas que quedan en la zona 8
// (evento 4). Cada uno reserva 1 entrada y, si lo logra, la paga. Resultado esperado:
// exactamente 50 ventas, 150 rechazos "cupo_agotado" (409) y 0 errores inesperados.
//
// No correr directo: usar load-tests/correr.sh, que levanta un stack aislado, corre esto
// y después verifica el conteo final EN POSTGRESQL (no solo en la salida de k6).

import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const API = __ENV.API || 'http://api:3000';
const ZONA = __ENV.ZONA || '8';
const COMPRADORES = Number(__ENV.COMPRADORES || 200);
const CORRIDA = __ENV.CORRIDA || String(Date.now());

const reservaMs = new Trend('reserva_ms', true);
const pagoMs = new Trend('pago_ms', true);
const ventasOk = new Counter('ventas_ok');
const cupoAgotado = new Counter('cupo_agotado');
const errores = new Counter('errores_inesperados');

export const options = {
  scenarios: {
    carrera: {
      // Cada comprador hace exactamente una compra, todos arrancan juntos.
      executor: 'per-vu-iterations',
      vus: COMPRADORES,
      iterations: 1,
      maxDuration: '2m',
    },
  },
  // Si cualquiera de estos falla, k6 termina con código distinto de 0.
  thresholds: {
    ventas_ok: ['count==50'],
    cupo_agotado: [`count==${COMPRADORES - 50}`],
    errores_inesperados: ['count==0'],
  },
  setupTimeout: '2m',
};

const JSON_H = { 'Content-Type': 'application/json' };

// Registra compradores nuevos (no del dataset) para que ninguno arranque con su límite
// por cuenta ya consumido. Va en lotes para no saturar el hash de contraseñas.
export function setup() {
  const tokens = [];
  for (let base = 0; base < COMPRADORES; base += 50) {
    const lote = [];
    for (let i = base; i < Math.min(base + 50, COMPRADORES); i++) {
      lote.push(['POST', `${API}/v1/auth/registro`, JSON.stringify({
        nombre: `Comprador ${i + 1}`,
        email: `carga-${CORRIDA}-${i + 1}@correo.test`,
        password: 'carga-clave-larga',
      }), { headers: JSON_H }]);
    }
    for (const r of http.batch(lote)) {
      if (r.status !== 201) throw new Error(`registro falló: ${r.status} ${r.body}`);
      tokens.push(r.json('access_token'));
    }
  }
  return { tokens };
}

export default function ({ tokens }) {
  const token = tokens[__VU - 1];
  const h = (clave) => ({ headers: { ...JSON_H, Authorization: `Bearer ${token}`, 'Idempotency-Key': clave } });

  const r = http.post(`${API}/v1/reservas`, JSON.stringify({ zona_id: ZONA, cantidad: 1 }), h(`res-${CORRIDA}-${__VU}`));
  reservaMs.add(r.timings.duration);

  if (r.status === 409 && r.json('error.codigo') === 'cupo_agotado') {
    cupoAgotado.add(1);
    return;
  }
  if (!check(r, { 'reserva 201': (x) => x.status === 201 })) {
    errores.add(1);
    console.error(`reserva inesperada: ${r.status} ${r.body}`);
    return;
  }

  const p = http.post(`${API}/v1/reservas/${r.json('id')}/pago`, null, h(`pago-${CORRIDA}-${__VU}`));
  pagoMs.add(p.timings.duration);
  if (check(p, { 'pago 201 con 1 entrada': (x) => x.status === 201 && x.json('entradas').length === 1 })) {
    ventasOk.add(1);
  } else {
    errores.add(1);
    console.error(`pago inesperado: ${p.status} ${p.body}`);
  }
}

export function handleSummary(data) {
  const m = data.metrics;
  const n = (k) => (m[k] ? m[k].values.count : 0);
  const t = (k, p) => (m[k] ? m[k].values[p].toFixed(1) : '-');
  const fallos = Object.entries(m).filter(([, v]) => v.thresholds && Object.values(v.thresholds).some((x) => !x.ok));
  const texto = [
    `Compradores:          ${COMPRADORES} (zona ${ZONA})`,
    `Ventas (k6):          ${n('ventas_ok')}`,
    `Rechazos 409:         ${n('cupo_agotado')}`,
    `Errores inesperados:  ${n('errores_inesperados')}`,
    `Reserva  p50 / p95:   ${t('reserva_ms', 'med')} ms / ${t('reserva_ms', 'p(95)')} ms`,
    `Pago     p50 / p95:   ${t('pago_ms', 'med')} ms / ${t('pago_ms', 'p(95)')} ms`,
    `Umbrales:             ${fallos.length === 0 ? 'todos OK' : 'FALLARON: ' + fallos.map(([k]) => k).join(', ')}`,
    '',
  ].join('\n');
  return { stdout: texto, '/resultados/k6-resumen.json': JSON.stringify(data, null, 2) };
}
