#!/usr/bin/env bash
# Tests e2e de la API contra un PostgreSQL real y aislado.
#
# Levanta un proyecto Compose propio (ticketing-test) con volúmenes nuevos: secretos,
# base, migraciones y semilla. Corre los e2e con la app DENTRO del proceso de jest,
# conectada como el rol de aplicación (los mismos permisos que en producción).
# Al terminar borra el proyecto. Con --conservar lo deja arriba.
set -euo pipefail

cd "$(dirname "$0")/../../.."
export COMPOSE_PROJECT_NAME=ticketing-test
export DB_PORT=${E2E_DB_PORT:-5732}

# Jest carga Nest 12 (solo ESM) con require(esm): necesita Node 24.9 o superior.
NODE_MAYOR=$(node -p 'process.versions.node.split(".").map(Number).reduce((a,b,i)=>i<2?a*100+b:a)')
if [ "$NODE_MAYOR" -lt 2409 ]; then
  echo "Se necesita Node >= 24.9 (tienes $(node -v)). Ejecuta 'fnm use' o 'nvm use' (lee .nvmrc)." >&2
  exit 1
fi

CONSERVAR=""
if [ "${1:-}" = "--conservar" ]; then CONSERVAR=1; shift; fi
limpiar() { [ -n "$CONSERVAR" ] || docker compose down -v >/dev/null 2>&1 || true; }
trap limpiar EXIT

echo "== Base aislada ($COMPOSE_PROJECT_NAME, puerto $DB_PORT)"
docker compose down -v >/dev/null 2>&1 || true
docker compose up -d --build --wait db >/dev/null 2>&1
# `up --wait` no espera a que un servicio de una sola vez TERMINE: se corre migrate de
# forma síncrona (migraciones + semilla) y si falla, el script se detiene.
docker compose run --rm migrate >/dev/null 2>&1 || { echo 'Falló migrate/semilla' >&2; docker compose logs migrate >&2; exit 1; }

export PGHOST=127.0.0.1 PGPORT=$DB_PORT PGDATABASE=ticketing
# La contraseña del rol de app se lee del volumen de secretos de ESTE proyecto de prueba.
DB_APP_PASSWORD=$(docker compose run --rm --no-deps -T --entrypoint cat migrate /run/secrets-gen/db_app_password 2>/dev/null)
export DB_APP_PASSWORD

echo "== Tests e2e"
npm run test:e2e --workspace api -- "$@"
