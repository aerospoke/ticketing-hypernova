# Handoff técnico

Estado real del repositorio para quien lo continúe, sea persona o agente. Actualizar al
cerrar cada corte.

## Layout

```
apps/
  api/                 NestJS 12 (CommonJS), pg directo, Jest
    migrations/        0001..0004 en SQL plano (no se editan una vez aplicadas)
    seed/              datos-prueba-ticketing.json (dataset oficial, no se modifica)
    src/db/            config.ts (_FILE), migrate.ts (runner), seed.ts, db.module.ts (pool)
    src/health/        /health y /ready
    src/auth/          password.ts (scrypt)
    Dockerfile         una imagen para los servicios migrate y api
  admin/               React + Vite. Dockerfile y nginx/default.conf (proxy a la api)
  mobile/              Expo (plantilla, fuera de Docker)
packages/shared/       tipos compartidos (vacío por ahora)
infra/secrets/         init-secrets.mjs: genera secretos en volúmenes Docker
docs/                  este archivo y delivery.md
.claude/skills/        verify-ticket-sales, verify-offline-admission
```

Node 24 LTS (`.nvmrc`). Hace falta para que jest cargue Nest 12, que es solo ESM, mediante
`require(esm)`. El script de test pasa `--experimental-vm-modules` por `NODE_OPTIONS`.

## Servicios y límites

| Servicio | Rol de BD | Secretos que ve | Termina o persiste |
|---|---|---|---|
| `secrets` | — | escribe todos | termina (código 0) |
| `db` | — | contraseña del dueño | persiste |
| `migrate` | `ticketing_owner` | contraseña del dueño y de la app (montados por `subpath`, nada más) | termina (código 0) |
| `api` | `ticketing_app` | volumen `api-secrets` completo (base, JWT, Ed25519) | persiste. Healthcheck sobre `/ready`. |
| `admin` | — | ninguno | persiste. nginx sin root, puerto 8080. |

Orden: `secrets` → `db` *healthy* → `migrate` terminado con código 0 → `api` *healthy* → `admin`.

**Rol de la app (`ticketing_app`).** Lo crea el runner, no un `.sql`, porque su contraseña
vive en el volumen de secretos. En cada arranque se re-sincroniza su contraseña. No tiene
CREATE en `public`. Sus permisos:

- **SELECT/INSERT/UPDATE** en las tablas operativas.
- **SELECT/INSERT** en `reembolsos`, `revocaciones`, `ingresos` y `auditoria`.
- **SELECT** en `schema_migrations`, para `/ready`.
- **Sin acceso** a `semillas`.

## Runner de migraciones (`src/db/migrate.ts`)

- Toma `pg_advisory_lock(727001)` por sesión. La semilla usa la misma llave.
- Aplica cada migración en su propia transacción, junto con su fila en `schema_migrations`.
- Se detiene si encuentra un checksum distinto, una versión duplicada o una migración
  aplicada que ya no existe en disco.
- Para cambiar el esquema: crear `0005_*.sql`. Nunca editar una migración aplicada.

## Decisiones de la semilla

- **Desplazamiento de fechas:** `floor((ahora - referencia_temporal) / 1 día)` días enteros,
  aplicado a todas las fechas. Se guarda en `semillas.desplazamiento` y nunca se recalcula.
- **IDs del personal:** `100000 + id`, también en las FKs (`organizador_id`, `staff_id`).
- **Estado de los eventos:** el dataset trae `finalizado`, `en_venta` y `proximo`, que
  dependen del reloj. En la base solo se guarda el estado administrativo (`publicado`); la
  API deriva el estado temporal desde las fechas.
- **Reservas históricas** (todas expiradas): la fase y el precio se derivan de la fase
  vigente en `creada_en`. Su `idempotency_key` es `seed-reserva-<id>`.
- **Entradas:** `version = 1 + transferencias aceptadas`. Las reembolsadas generan una fila en
  `reembolsos` (motivo "Reembolso histórico (dataset)") y una en `revocaciones`.
- **Contadores:** `zonas.vendidas` cuenta las entradas `pagada`, `transferida` y `usada`.
  `cupo_cuenta` usa esas mismas entradas, agrupadas por comprador y evento.
- **Secuencias:** se reajustan a `max(id) + 1`. El próximo usuario es el 100313.
- Inserción masiva: un parámetro jsonb por tabla expandido con `jsonb_to_recordset`. No se
  interpolan datos en el SQL.

## Decisiones aprobadas para los próximos cortes

Están en [AGENTS.md](../AGENTS.md#decisiones-tomadas): QR con llave por dispositivo, política
de pago tardío, refresh tokens por familia, barrido de reservas, rate limiting en memoria y
cursor de revocaciones con lock por evento.

## Siguiente

El primer caso sin marcar de [delivery.md](delivery.md) es la carrera por el último cupo.
