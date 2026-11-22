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

## Autenticación y seguridad

| # | Caso | Estado | Comando / demo | Resultado observado | Aporte IA | Revisión humana | Próxima acción |
|---|---|---|---|---|---|---|---|
| A1 | Login, validación en el borde y forma única de errores | ✅ | `curl` a `/v1/auth/login` con datos inválidos, con contraseña mala, con un correo inexistente y con un correo `"Asistente1@correo.test "` | 400 `peticion_invalida` con detalle por campo. Mismo 401 `credenciales_invalidas` exista o no el correo. El correo con mayúscula y espacio se normaliza y entra. | `AuthService`, esquemas zod, `FiltroErrores` | pendiente | — |
| A2 | Refresh con rotación y detección de reuso | ✅ | login, luego refresh, luego reusar el refresh viejo | El refresh emite un par nuevo. Al reusar el viejo: 401 `refresh_invalido`. El refresh nuevo también muere y el access nuevo da 401 `sesion_cerrada`. El log registra `refresh_reusado_familia_revocada`. | `AuthService.refrescar` | pendiente | — |
| A3 | Logout que invalida de verdad | ✅ | registro, `/v1/me` (200), logout (204), `/v1/me` con el **mismo** access | 401 `sesion_cerrada` sin esperar a que el access expire. El refresh posterior da 401. | `AuthGuard` (consulta de la familia activa) | pendiente | — |
| A4 | Token alterado (escalar a admin) | ✅ | Cambiar `rol` en el payload del JWT y llamar a `/v1/me`. También tests en `tokens.spec.ts`: alg `none`, otra llave, expirado, otra audiencia. | 401 `token_invalido`. 7 tests de tokens en verde. | `tokens.ts` y sus tests | pendiente | — |
| A5 | Rate limiting en autenticación | ✅ | 12 logins seguidos desde la misma IP | `401 ×9` y después `429 ×3` (`demasiadas_peticiones`). El límite es 10 por minuto e incluye un login previo. | `ThrottlerGuard` | pendiente | Límite de compra, cuando exista |
| A6 | Logs estructurados con correlación | ✅ | `curl -H 'x-request-id: demo-correlacion-123' /v1/me` | La respuesta trae `X-Request-Id: demo-correlacion-123` y el log JSON tiene `correlacion_id` igual a ese valor. | `CorrelacionMiddleware` | pendiente | — |

## Casos del enunciado ("Cómo se va a probar tu entrega")

| # | Caso | Estado | Comando / demo | Resultado observado | Aporte IA | Revisión humana | Próxima acción |
|---|---|---|---|---|---|---|---|
| 1 | Carrera por el último cupo: 200 compradores, 50 entradas, exactamente 50 vendidas | ✅ | `./load-tests/correr.sh`: stack aislado nuevo y k6 2.3.0 con 200 VUs simultáneos sobre la zona 8. La verificación final se hace en PostgreSQL. Ver [load-tests/README.md](../load-tests/README.md). | 3 de 3 corridas: **50 ventas**, 150 `409 cupo_agotado`, 0 errores. En PostgreSQL: 50 entradas nuevas, 0 zonas con sobreventa y contador = filas. Reserva p50/p95 ≈ 118/144 ms; pago ≈ 103/139 ms. | Script k6, `correr.sh` y el UPDATE condicional | pendiente | — |
| 2 | Doble toque: la misma clave produce un cobro y una entrada | ✅ | Proyecto aislado. 5 `POST /v1/reservas/:id/pago` **simultáneos** con `Idempotency-Key: pago-doble-0001`. Después, pagar con otra clave y reusar una clave con otra petición. | Las 5 respuestas: `201` y la misma `compra=1850`; 4 con `Idempotent-Replayed: true`. En PostgreSQL: 1 compra, 2 entradas, 1 cobro de 8000. Pagar con otra clave devuelve la misma compra. Misma clave con otra petición: `422 idempotency_key_reutilizada`. | `IdempotenciaService`, `CompraService.pagar` | pendiente | Test automatizado contra PostgreSQL |
| 3 | Reserva vencida: el cupo vuelve a estar disponible | ✅ | Proyecto aislado con `RESERVA_TTL_S=20` y `BARRIDO_INTERVALO_MS=2000`: reservar 2 y esperar 24 s. Además: API detenida durante el vencimiento y reiniciada. | `reservadas 2→0` y `cupo_cuenta 2→0`; la reserva queda `expirada` con `segundos_restantes 0`. Con la API caída el cupo sigue retenido; al volver, el barrido de arranque lo libera (`reservas_expiradas liberadas:1`). Pago tardío con cupo: se emite. Sin cupo: `reembolso_automatico`, 0 entradas y reembolso de 10400 con autor sistema. | `ExpiracionService` y la política de pago tardío | pendiente | Test automatizado |
| 4 | Captura de pantalla de hace 1 minuto: se rechaza | ⬜ | — | — | — | pendiente | Credencial firmada y firma del dispositivo |
| 5 | Transferencia: el código anterior deja de servir | ⬜ | — | — | Esquema (`version` y `revocaciones`) | pendiente | Endpoints de transferencia |
| 6 | Dos puertas offline: aparece un incidente | ⬜ | — | — | Esquema (índice parcial e `incidentes`) | pendiente | Sincronización de lotes. Ver [skill](../.claude/skills/verify-offline-admission/SKILL.md). |
| 7 | Reembolso de una entrada ya usada: se rechaza | ⬜ | — | — | — | pendiente | Endpoint de reembolso |
| 8 | Organizador ajeno: el servidor rechaza | ⬜ | — | — | — | pendiente | Auth, roles y filtro por organizador |
| 9 | Precio manipulado: se cobra el precio real | ✅ | `POST /v1/reservas` con `"monto_centesimos":1,"precio_unitario_centesimos":1` en el body | La reserva toma `precio_unitario_centesimos: 4000` (la fase vigente) y `monto 8000`. Los campos del cliente se descartan en el esquema y no cambian el hash de idempotencia. | Esquema zod y `CompraService.reservar` | pendiente | Test automatizado |

**Primer caso sin marcar:** caso 4, captura de pantalla de hace 1 minuto.
