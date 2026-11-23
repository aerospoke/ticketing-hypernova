#!/usr/bin/env bash
# Mide los planes de las consultas más costosas a escala (antes y después de los índices).
# Levanta un proyecto Compose aislado (ticketing-rendimiento), carga el dataset oficial +
# datos sintéticos, corre EXPLAIN (ANALYZE, BUFFERS) y lo borra todo al terminar.
set -euo pipefail
cd "$(dirname "$0")/../.."
export COMPOSE_PROJECT_NAME=ticketing-rendimiento DB_PORT=${DB_PORT:-5832}
trap 'docker compose down -v >/dev/null 2>&1 || true' EXIT

docker compose down -v >/dev/null 2>&1 || true
# La imagen de migrate se construye explícitamente: `run` usaría una imagen vieja
# sin las migraciones nuevas.
docker compose build migrate >/dev/null 2>&1
docker compose up -d --wait db >/dev/null 2>&1
docker compose run --rm migrate >/dev/null 2>&1
psql_() { docker compose exec -T db psql -U ticketing_owner -d ticketing -v ON_ERROR_STOP=1 "$@"; }

echo "== Cargando datos sintéticos"
psql_ -q -f - < docs/rendimiento/cargar-escala.sql
psql_ -tA -c "SELECT 'usuarios=' || (SELECT count(*) FROM usuarios) || ' compras=' || (SELECT count(*) FROM compras) || ' entradas=' || (SELECT count(*) FROM entradas)"

EV=$(psql_ -tA -c "SELECT id FROM eventos WHERE codigo = 'MASIVO'")
BUSCA="'%masivo12345@%'"

echo
echo "################ 1. BÚSQUEDA DE ENTRADAS POR COMPRADOR — ANTES (consulta original, sin índices trigrama)"
psql_ -c "BEGIN; DROP INDEX usuarios_email_trgm_idx; DROP INDEX usuarios_nombre_trgm_idx;
EXPLAIN (ANALYZE, BUFFERS) SELECT e.id FROM entradas e JOIN usuarios c ON c.id = e.comprador_id JOIN usuarios t ON t.id = e.titular_id
 WHERE e.evento_id = $EV AND (c.email ILIKE $BUSCA OR c.nombre ILIKE $BUSCA OR t.email ILIKE $BUSCA OR t.nombre ILIKE $BUSCA)
 ORDER BY e.id DESC LIMIT 51; ROLLBACK;"

echo "################ 1. BÚSQUEDA DE ENTRADAS POR COMPRADOR — DESPUÉS (consulta actual + 0005)"
psql_ -c "EXPLAIN (ANALYZE, BUFFERS) WITH coinciden AS (SELECT id FROM usuarios WHERE email ILIKE $BUSCA OR nombre ILIKE $BUSCA)
 SELECT e.id FROM entradas e JOIN usuarios c ON c.id = e.comprador_id JOIN usuarios t ON t.id = e.titular_id
 WHERE e.evento_id = $EV AND e.id IN (
   SELECT x.id FROM entradas x JOIN coinciden u ON x.comprador_id = u.id
   UNION ALL SELECT x.id FROM entradas x JOIN coinciden u ON x.titular_id = u.id)
 ORDER BY e.id DESC LIMIT 51;"

echo "################ 2. REPORTE DE VENTAS del evento masivo (300 000 compras) — ANTES"
psql_ -c "EXPLAIN (ANALYZE, BUFFERS) SELECT z.id,
  (SELECT sum(c.monto_centesimos) FROM compras c WHERE c.zona_id = z.id AND c.estado <> 'reembolso_automatico'),
  (SELECT sum(r.monto_centesimos) FROM reembolsos r JOIN compras c ON c.id = r.compra_id WHERE c.zona_id = z.id AND r.entrada_id IS NOT NULL),
  (SELECT count(*) FROM entradas e WHERE e.zona_id = z.id AND e.estado = 'usada')
 FROM zonas z WHERE z.evento_id = $EV;"

echo "################ 2. REPORTE DE VENTAS del evento masivo — DESPUÉS (consulta actual)"
psql_ -c "EXPLAIN (ANALYZE, BUFFERS) SELECT z.id,
  (SELECT sum(c.monto_centesimos) FROM compras c WHERE c.evento_id = z.evento_id AND c.zona_id = z.id AND c.estado <> 'reembolso_automatico'),
  (SELECT sum(e.precio_centesimos) FROM entradas e WHERE e.evento_id = z.evento_id AND e.zona_id = z.id AND e.estado = 'reembolsada'),
  (SELECT count(*) FROM entradas e WHERE e.evento_id = z.evento_id AND e.zona_id = z.id AND e.estado = 'usada')
 FROM zonas z WHERE z.evento_id = $EV;"

echo "################ 3. RUTA CALIENTE: reservar (UPDATE condicional del aforo)"
psql_ -c "BEGIN; EXPLAIN (ANALYZE, BUFFERS) UPDATE zonas SET reservadas = reservadas + 1 WHERE id = 8 AND vendidas + reservadas + 1 <= aforo; ROLLBACK;"
