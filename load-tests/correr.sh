#!/usr/bin/env bash
# Prueba de carga reproducible: 200 compradores contra las últimas 50 entradas.
#
# Requisitos: solo Docker (k6 corre en su imagen oficial, versión fijada).
# Uso:        ./load-tests/correr.sh            (levanta, prueba, verifica y borra el stack)
#             ./load-tests/correr.sh --conservar (deja el stack arriba para inspeccionarlo)
#
# Usa un proyecto Compose aparte (ticketing-carga) con volúmenes propios: no toca el stack
# local. Los límites de rate se suben SOLO aquí, porque todos los compradores salen de la
# misma IP (el contenedor de k6) y el límite normal los frenaría antes de la base.
set -euo pipefail

cd "$(dirname "$0")/.."
export COMPOSE_PROJECT_NAME=ticketing-carga
export DB_PORT=${DB_PORT:-5632} API_PORT=${API_PORT:-3200} ADMIN_PORT=${ADMIN_PORT:-8280}
export AUTH_RATE_LIMIT=100000 COMPRA_RATE_LIMIT=100000 RATE_LIMIT=1000000
K6_IMAGEN=grafana/k6:2.3.0
ZONA=8
RESULTADOS=load-tests/resultados
mkdir -p "$RESULTADOS"

psql_() { docker compose exec -T db psql -U ticketing_owner -d ticketing -tA -F ' | ' -c "$1"; }
conteo() {
  psql_ "SELECT z.aforo, z.vendidas, z.reservadas,
                (SELECT count(*) FROM entradas e WHERE e.zona_id = z.id AND e.estado IN ('pagada','transferida','usada')),
                z.aforo - z.vendidas - z.reservadas
           FROM zonas z WHERE z.id = $ZONA"
}

echo "== Levantando stack aislado ($COMPOSE_PROJECT_NAME) con volúmenes nuevos"
docker compose down -v --remove-orphans >/dev/null 2>&1 || true
docker compose up -d --build --wait db migrate api >/dev/null 2>&1

SALIDA="$RESULTADOS/ultima-corrida.txt"
exec > >(tee "$SALIDA") 2>&1
echo "Fecha:  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
# Incluye archivos nuevos sin trackear: si el código probado no es exactamente el commit, se avisa.
echo "Commit: $(git rev-parse --short HEAD)$([ -z "$(git status --porcelain -- apps load-tests docker-compose.yml ':!load-tests/resultados')" ] || echo ' (con cambios sin commitear)')"
echo "k6:     $K6_IMAGEN"
echo "== Antes   (aforo | vendidas | reservadas | entradas vigentes en la tabla | disponibles)"
ANTES=$(conteo); echo "   $ANTES"
VIGENTES_ANTES=$(echo "$ANTES" | cut -d'|' -f4 | tr -d ' ')

echo "== k6: 200 compradores concurrentes"
set +e
docker run --rm --network "${COMPOSE_PROJECT_NAME}_default" \
  -v "$PWD/load-tests:/scripts:ro" -v "$PWD/$RESULTADOS:/resultados" \
  -e API=http://api:3000 -e ZONA=$ZONA -e COMPRADORES=200 \
  "$K6_IMAGEN" run --quiet /scripts/carrera-ultimo-cupo.js
K6_SALIDA=$?
set -e

# Las reservas que no se pagaron (si hubiera) no cuentan como vendidas: se espera a que
# todo esté resuelto y se cuenta en la tabla de entradas, no en el contador.
echo "== Después (verificado en PostgreSQL)"
DESPUES=$(conteo); echo "   $DESPUES"
VIGENTES_DESPUES=$(echo "$DESPUES" | cut -d'|' -f4 | tr -d ' ')
NUEVAS=$((VIGENTES_DESPUES - VIGENTES_ANTES))
SOBREVENTA=$(psql_ "SELECT count(*) FROM zonas WHERE vendidas + reservadas > aforo")
CONTADOR_OK=$(psql_ "SELECT count(*) = 0 FROM zonas z WHERE z.vendidas <> (SELECT count(*) FROM entradas e WHERE e.zona_id = z.id AND e.estado IN ('pagada','transferida','usada'))")

echo "   Entradas nuevas emitidas en la zona $ZONA: $NUEVAS"
echo "   Zonas con sobreventa:                    $SOBREVENTA"
echo "   Contador vendidas = filas en entradas:   $CONTADOR_OK"

RESULTADO="FALLÓ"
if [ "$NUEVAS" = 50 ] && [ "$SOBREVENTA" = 0 ] && [ "$CONTADOR_OK" = t ] && [ "$K6_SALIDA" = 0 ]; then
  RESULTADO="OK: exactamente 50 vendidas"
fi
echo "== Resultado: $RESULTADO"

if [ "${1:-}" != "--conservar" ]; then
  docker compose down -v >/dev/null 2>&1
fi
[ "$RESULTADO" != "FALLÓ" ]
