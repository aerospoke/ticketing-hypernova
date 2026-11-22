# Checklist de entrega

Una fila por caso de aceptación. Antes de marcar un caso como hecho, registrar la
**evidencia observada** (comando y salida real). Un caso sin evidencia no está hecho.

Estados: ✅ hecho con evidencia · 🟡 en curso · ⬜ pendiente.
Revisión humana: `pendiente` hasta que una persona revise el código **y** la evidencia.

## Base (arranque y datos)

| # | Caso | Estado | Comando / demo | Resultado observado | Aporte IA | Revisión humana | Próxima acción |
|---|---|---|---|---|---|---|---|
| B1 | `docker compose up` desde clon limpio, sin pasos manuales | ✅ | Clon nuevo en un proyecto aislado con volúmenes nuevos: `COMPOSE_PROJECT_NAME=ticketing-verif DB_PORT=5532 API_PORT=3100 ADMIN_PORT=8180 docker compose up -d --build --wait` | Commit `322d315`, 2026-11-22. En unos 24 s: `secrets` y `migrate` terminaron con código 0, `db`, `api` y `admin` quedaron *healthy*. | Compose, Dockerfiles, runner y semilla | pendiente | — |
| B2 | API lista (readiness real) | ✅ | `curl localhost:3100/ready`; apagar `db` y volver a consultar | `200 {"estado":"listo","esquema":"0004"}`. Con `db` detenida: `/health` 200 y `/ready` **503** `base_inaccesible`. Se recupera sola. | `HealthController` y 5 tests unitarios | pendiente | — |
| B3 | Portal servido construido | ✅ | `curl localhost:8180/` y `curl localhost:8180/ready` | Sirve `index.html` con assets hasheados. El proxy a `/ready` responde 200. Las rutas del SPA devuelven 200. Headers `X-Frame-Options: DENY` y `nosniff` presentes. | Dockerfile de nginx sin root y `default.conf` | pendiente | — |
| B4 | Línea base sembrada: evento 4, zona 8 | ✅ | Consulta en psql (ver README, sección Verificación) | `aforo 500`, `no_reembolsadas 450` (contadas en `entradas`), `vendidas 450`, `reservadas 0`, `restantes 50` | Semilla | pendiente | — |
| B5 | Importador idempotente y ancla de fechas persistida | ✅ | `docker compose run --rm migrate`, luego `... migrate node dist/db/seed.js`, luego `down` y `up` sin `-v`. Diff de conteos antes y después. | `migraciones_ok nuevas:0` y `semilla_ya_aplicada` las 3 veces. El diff salió vacío: 16 tablas con los mismos conteos, el mismo `desplazamiento` (82 días), la misma `aplicada_en` y la misma huella de fechas. | Semilla y tabla `semillas` | pendiente | — |
| B6 | Ningún secreto en el repo ni en los logs | ✅ | Buscar el valor de cada secreto en `docker compose logs`, y revisar `git ls-files` | Ningún secreto en 48 líneas de log. En git solo está `infra/secrets/init-secrets.mjs`. | Script de verificación | pendiente | — |

## Casos del enunciado ("Cómo se va a probar tu entrega")

| # | Caso | Estado | Comando / demo | Resultado observado | Aporte IA | Revisión humana | Próxima acción |
|---|---|---|---|---|---|---|---|
| 1 | Carrera por el último cupo: 200 compradores, 50 entradas, exactamente 50 vendidas | ⬜ | — | — | Esquema (CHECK y contadores) | pendiente | Endpoints de reservar y pagar, luego script k6. Ver [skill](../.claude/skills/verify-ticket-sales/SKILL.md). |
| 2 | Doble toque: la misma clave produce un cobro y una entrada | ⬜ | — | — | Esquema (UNIQUE e `idempotency_keys`) | pendiente | Endpoint de pago idempotente |
| 3 | Reserva vencida: el cupo vuelve a estar disponible | ⬜ | — | — | Índice parcial para el barrido | pendiente | Barrido con `FOR UPDATE SKIP LOCKED` |
| 4 | Captura de pantalla de hace 1 minuto: se rechaza | ⬜ | — | — | — | pendiente | Credencial firmada y firma del dispositivo |
| 5 | Transferencia: el código anterior deja de servir | ⬜ | — | — | Esquema (`version` y `revocaciones`) | pendiente | Endpoints de transferencia |
| 6 | Dos puertas offline: aparece un incidente | ⬜ | — | — | Esquema (índice parcial e `incidentes`) | pendiente | Sincronización de lotes. Ver [skill](../.claude/skills/verify-offline-admission/SKILL.md). |
| 7 | Reembolso de una entrada ya usada: se rechaza | ⬜ | — | — | — | pendiente | Endpoint de reembolso |
| 8 | Organizador ajeno: el servidor rechaza | ⬜ | — | — | — | pendiente | Auth, roles y filtro por organizador |
| 9 | Precio manipulado: se cobra el precio real | ⬜ | — | — | Esquema (precio congelado en la reserva) | pendiente | Endpoint de reserva que ignora montos del cliente |

**Primer caso sin marcar:** caso 1, carrera por el último cupo.
