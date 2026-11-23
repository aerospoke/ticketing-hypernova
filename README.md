# Ticketing de eventos y control de acceso

Plataforma de venta de entradas con aforo limitado y control de acceso offline.
Prueba técnica de Hypernova Labs.

> **🎥 Video del recorrido:** _(pendiente: enlace no listado)_
> **🎥 Video de dos escáneres offline detectando el doble ingreso:** _(pendiente)_

## Resumen de la entrega

```bash
docker compose up                  # base + migraciones + semilla + API + portal, sin pasos manuales
./load-tests/correr.sh             # 200 compradores contra 50 entradas: exactamente 50 vendidas
./apps/api/test/correr-e2e.sh      # 55 tests e2e contra PostgreSQL real (Node 24)
```

| Caso del enunciado | Cómo se garantiza | Evidencia |
|---|---|---|
| 1. Carrera por el último cupo | `UPDATE zonas ... WHERE vendidas + reservadas + n <= aforo` y `CHECK` en la tabla | k6: **50 de 50** en 3 de 3 corridas, verificado en PostgreSQL ([load-tests](load-tests/README.md)) |
| 2. Doble toque | `Idempotency-Key` en la misma transacción, más `UNIQUE (reserva_id)` | e2e: 5 pagos simultáneos dan 1 compra y 1 cobro |
| 3. Reserva vencida | Vigencia en la consulta y barrido con `FOR UPDATE SKIP LOCKED` | e2e, y prueba con la API caída durante el vencimiento |
| 4. Captura de pantalla | Ed25519: credencial firmada por el servidor más firma del teléfono cada 15 s; ventana de 30 s | e2e: una captura de 60 s se rechaza como `expirado` |
| 5. Transferencia | `version` y revocaciones incrementales con cursor | e2e: el código anterior queda `revocada` |
| 6. Dos puertas offline | `client_scan_id` UNIQUE e índice único parcial de ingreso `valido` | e2e: 1 válido, 1 `duplicado_offline` e incidente en el portal |
| 7. Reembolso tras uso | `UPDATE ... WHERE estado IN ('pagada','transferida')` | e2e: `409 entrada_usada` |
| 8. Organizador ajeno | Acceso por evento verificado en el servidor (404, igual que inexistente) | e2e: 8 operaciones dan 404 y nada cambia |
| 9. Precio manipulado | El esquema descarta los campos del cliente; precio de la fase congelado al reservar | e2e |

Avance detallado, con comandos y salidas observadas: [docs/delivery.md](docs/delivery.md).
Las pruebas de mutación (romper el código a propósito y ver que los tests fallan) están en
[Pruebas automatizadas](#pruebas-automatizadas).

**Índice:**
- [Arranque](#arranque-desde-un-clon-limpio)
- [URLs](#urls)
- [Variables](#variables-de-entorno)
- [Acceso de prueba](#acceso-de-prueba)
- [Endpoints](#endpoints)
- [Compra e idempotencia](#flujo-de-compra-e-idempotencia)
- [Disponibilidad](#disponibilidad-bajo-mucho-tráfico)
- [Reembolsos](#reembolsos-y-anulaciones)
- [QR](#código-qr-rotativo-invariante-3)
- [Escaneo offline](#ingreso-único-con-puertas-offline-invariante-4)
- [Datos de prueba](#datos-de-prueba)
- [Pruebas](#pruebas-automatizadas)
- [Rendimiento](#rendimiento)
- [Arquitectura](#arquitectura-resumen)
- [Portal](#portal-web)
- [App móvil](#app-móvil)
- [Decisiones y omisiones](#decisiones-y-lo-que-no-se-hizo)

## Arranque desde un clon limpio

Requisitos: Docker Engine 26 o superior con Compose v2 reciente (se usa `volume.subpath`).
Verificado con Docker 29.8 y Compose 5.5.

```bash
git clone <repo> ticketing && cd ticketing
docker compose up
```

No hace falta copiar un `.env` ni correr migraciones o semillas a mano. Orden de arranque:

```
secrets ──► db (healthy) ──► migrate (termina con 0) ──► api (healthy) ──► admin
```

| Servicio | Qué hace |
|---|---|
| `secrets` | Genera los secretos locales en volúmenes Docker la primera vez y termina. Nunca los vuelve a generar si ya existen. |
| `db` | PostgreSQL 16. |
| `migrate` | Aplica `apps/api/migrations/*.sql` y carga la semilla. Termina con código 0. |
| `api` | NestJS. Se marca *healthy* cuando `/ready` responde 200. |
| `admin` | Portal (React + Vite) construido y servido por nginx. Hace de proxy de `/v1`, `/ready` y `/health` hacia la API. |

## URLs

| Qué | URL por defecto |
|---|---|
| Portal admin | http://localhost:8080 |
| API | http://localhost:3000 (rutas de negocio bajo `/v1`) |
| Liveness | http://localhost:3000/health |
| Readiness | http://localhost:3000/ready (base accesible y esquema en la versión esperada) |
| PostgreSQL | `localhost:5432`, solo en 127.0.0.1 |

## Variables de entorno

Todas son opcionales. Los secretos **no** son variables: se generan solos.

| Variable | Defecto | Uso |
|---|---|---|
| `API_PORT` | `3000` | Puerto publicado de la API |
| `API_BIND` | `127.0.0.1` | Interfaz donde se publica la API. `0.0.0.0` para probar desde un teléfono físico. |
| `ADMIN_PORT` | `8080` | Puerto publicado del portal |
| `DB_PORT` | `5432` | Puerto publicado de PostgreSQL (solo en 127.0.0.1) |
| `POSTGRES_DB` | `ticketing` | Nombre de la base |
| `DB_OWNER_USER` | `ticketing_owner` | Rol dueño del esquema (lo usan migraciones y semilla) |
| `DB_POOL_MAX` | `20` | Conexiones del pool de la API |
| `AUTH_RATE_LIMIT` | `10` | Peticiones por minuto y por IP a login y registro (refresh: el triple). Se sube solo para la prueba de carga. |
| `COMPRA_RATE_LIMIT` | `30` | Reservas o pagos por minuto y por IP |
| `RATE_LIMIT` | `300` | Límite global por minuto y por IP |
| `RESERVA_TTL_S` | `600` | Vida de una reserva en segundos (bajarlo para demostrar la expiración) |
| `BARRIDO_INTERVALO_MS` | `5000` | Cada cuánto se liberan las reservas vencidas |

### Secretos

Los genera `infra/secrets/init-secrets.mjs` en volúmenes Docker. No hay ninguno en el
repositorio ni valores por defecto. Se leen con la convención `NOMBRE_FILE`.

| Secreto | Volumen | Quién lo monta |
|---|---|---|
| Contraseña del rol dueño | `db-secrets` | `db` y `migrate` (solo ese archivo) |
| Contraseña del rol de app | `api-secrets` | `api` y `migrate` (solo ese archivo) |
| Secreto JWT | `api-secrets` | `api` |
| Par Ed25519 de firma de entradas | `api-secrets` | `api` |

Para empezar de cero, incluidos los secretos: `docker compose down -v`.

## Acceso de prueba

Credenciales del dataset oficial (solo para el entorno local):

| Rol | Correo | Contraseña |
|---|---|---|
| admin | `admin@ticketing.test` | `Admin2026!` |
| organizador | `org.istmo@ticketing.test`, `org.canal@ticketing.test`, `org.pacifico@ticketing.test` | `Organizador2026!` |
| staff | `staff1@ticketing.test` … `staff12@ticketing.test` | `Staff2026!` |
| asistente | `asistente1@correo.test` … `asistente600@correo.test` | `Asistente2026!` |

Las contraseñas se guardan con scrypt. Ejemplo:

```bash
curl -s localhost:3000/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"asistente1@correo.test","password":"Asistente2026!"}'
```

## Endpoints

Todas las rutas de negocio llevan el prefijo `/v1`. **Cerradas por defecto:** exigen
`Authorization: Bearer <access_token>`, salvo las marcadas como públicas.

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/v1/auth/registro` | pública | Crea una cuenta de asistente y abre sesión |
| POST | `/v1/auth/login` | pública | Abre sesión: devuelve el access token (10 min) y el refresh token (30 días) |
| POST | `/v1/auth/refresh` | pública | Canjea el refresh **una sola vez** por un par nuevo (rotación) |
| POST | `/v1/auth/logout` | pública | Cierra la sesión: el refresh y **también el access vigente** dejan de servir |
| GET | `/v1/me` | sesión | Perfil del usuario autenticado |
| GET | `/v1/eventos?cursor=` | pública | Cartelera: eventos publicados que no terminaron, con estado de venta, precio desde y disponibles |
| GET | `/v1/eventos/:id` | pública | Detalle con disponibilidad por zona y fase vigente (caché de a lo sumo ~1 s) |
| POST | `/v1/reservas` | sesión + `Idempotency-Key` | Reserva `{zona_id, cantidad}`: retiene cupo y congela el precio de la fase vigente. Cualquier monto que mande el cliente se ignora. |
| GET | `/v1/reservas/:id` | sesión (dueño) | Estado y `segundos_restantes` para el contador |
| POST | `/v1/reservas/:id/cancelar` | sesión + `Idempotency-Key` | Libera el cupo. Cancelar dos veces no es error. |
| POST | `/v1/reservas/:id/pago` | sesión + `Idempotency-Key` | Pago simulado y emisión de las entradas |
| GET | `/v1/me/entradas?cursor=` | sesión | Billetera (paginación por cursor) |
| POST | `/v1/entradas/:id/material` | sesión (titular) | Material del código rotativo: `{dispositivo_pubkey}` y devuelve la credencial firmada por el servidor |
| POST | `/v1/entradas/:id/transferencias` | sesión (titular) | Transferir por correo `{email}`. Queda pendiente. |
| GET | `/v1/me/transferencias` | sesión | Transferencias enviadas y recibidas, con su estado |
| GET | `/v1/me/compras?cursor=` | sesión | Historial de compras, con el estado de cada entrada y el monto reembolsado |
| POST | `/v1/entradas/:id/reembolso` | sesión (comprador titular) + `Idempotency-Key` | Reembolso hasta la fecha límite del evento |
| POST | `/v1/transferencias/:id/aceptar` | sesión (destinatario) | Cambia el titular, sube la versión y revoca el código anterior |
| POST | `/v1/transferencias/:id/rechazar` | sesión (destinatario) | Rechaza la transferencia |
| POST | `/v1/transferencias/:id/cancelar` | sesión (emisor) | Cancela una transferencia pendiente |
| GET | `/v1/escaner/llave` | pública | Llave pública Ed25519 del servidor, para verificar sin red |
| GET | `/v1/escaner/eventos` | staff | Eventos asignados, con puertas y zonas, para iniciar turno |
| GET | `/v1/escaner/eventos/:id/revocaciones?desde=` | staff asignado, organizador dueño o admin | Revocaciones incrementales por cursor |
| POST | `/v1/escaner/dispositivos` | staff | Registro del dispositivo `{id (uuid generado en el teléfono), nombre, plataforma}` |
| POST | `/v1/escaner/turnos` | staff asignado | Inicio de turno `{evento_id, puerta_id, dispositivo_id}`: queda registrado quién escanea, dónde y con qué equipo |
| POST | `/v1/escaner/turnos/:id/cerrar` | staff | Fin de turno |
| POST | `/v1/escaner/lotes` | staff (dueño del dispositivo) | Sube hasta 500 escaneos hechos sin red. Reenviar el lote es seguro. |
| GET | `/v1/admin/eventos/:id/incidentes` | organizador dueño o admin | Incidentes del evento (doble ingreso, firma inválida, escáner desincronizado) |
| GET / POST | `/v1/admin/eventos` | organizador (los suyos) o admin | Listar con resumen de ventas / crear (en `borrador` por defecto) |
| GET / PATCH | `/v1/admin/eventos/:id` | organizador dueño o admin | Detalle (zonas, fases, puertas, staff) / editar |
| POST | `/v1/admin/eventos/:id/zonas` · `PATCH /v1/admin/zonas/:id` | organizador dueño o admin | Zonas con aforo |
| POST | `/v1/admin/zonas/:id/fases` · `PATCH /v1/admin/fases/:id` | organizador dueño o admin | Fases de precio (preventa, general, taquilla) |
| POST | `/v1/admin/eventos/:id/puertas` | organizador dueño o admin | Puertas |
| PUT / DELETE | `/v1/admin/eventos/:id/staff/:staffId` | organizador dueño o admin | Asignar o quitar staff (solo staff del mismo organizador) |
| GET | `/v1/admin/eventos/:id/ventas` | organizador dueño o admin | Por zona: vendidas, reservadas, disponibles, precio vigente, cobrado, reembolsado y neto |
| GET | `/v1/admin/eventos/:id/accesos` | organizador dueño o admin | Ingresos por puerta y por hora, aforo dentro del recinto, dispositivos y su última sincronización |
| GET | `/v1/admin/eventos/:id/entradas?q=` | organizador dueño o admin | Buscar entradas por correo o nombre del comprador o titular, o por número |
| POST | `/v1/admin/incidentes/:id/resolver` | organizador dueño o admin | Marca un incidente como resuelto `{nota}` (auditado) |
| GET | `/v1/admin/auditoria?cursor=` | organizador (sus acciones) o admin (todas) | Registro inmutable de acciones administrativas |
| POST | `/v1/admin/entradas/:id/reembolso` | organizador dueño o admin + `Idempotency-Key` | Reembolso `{motivo}`, sin fecha límite. Queda en la auditoría. |
| POST | `/v1/admin/entradas/:id/anular` | organizador dueño o admin + `Idempotency-Key` | Anulación sin devolución `{motivo}` (por ejemplo, fraude). Queda en la auditoría. |
| GET | `/health` | pública | Liveness |
| GET | `/ready` | pública | Readiness |

**Errores.** Todas las respuestas de error tienen la misma forma. El cliente decide por
`codigo`, no por el texto:

```json
{ "error": { "codigo": "credenciales_invalidas", "mensaje": "...", "detalles": [] }, "correlacion_id": "..." }
```

**Sesiones.**
- Si llega un refresh token **ya usado**, se interpreta como robo: se revoca toda la sesión
  (la familia de tokens) y hay que volver a iniciar sesión.
- El access token lleva el id de su sesión, y en cada petición se comprueba que esa sesión
  siga activa. Por eso el logout invalida de inmediato, sin esperar a que el token expire.
- Login responde lo mismo, y tarda lo mismo, exista o no el correo. Así no se puede averiguar
  qué correos están registrados.

### Flujo de compra e idempotencia

```
POST /reservas ──► reserva activa (10 min) ──► POST /reservas/:id/pago ──► compra + entradas
                        │
                        ├── POST /reservas/:id/cancelar ──► cancelada (cupo devuelto)
                        └── vence ──► barrido ──► expirada (cupo devuelto)
```

- **Aforo.** Reservar suma a `zonas.reservadas` con
  `UPDATE ... WHERE vendidas + reservadas + n <= aforo`. Si no afecta filas, responde
  `409 cupo_agotado`. Pagar mueve de `reservadas` a `vendidas` en un solo UPDATE. El
  `CHECK` de la tabla es la red de seguridad.
- **Orden de locks** en todos los caminos: `reservas` → `cupo_cuenta` → `zonas`. Así no hay
  deadlocks.
- **Idempotency-Key.** Es obligatoria en reservar, pagar y cancelar. La fila de la clave se
  inserta en la **misma transacción** que la operación:
  - Un duplicado simultáneo espera en el índice único y después devuelve la respuesta
    guardada, con el header `Idempotent-Replayed: true`.
  - La misma clave con otra petición responde `422`.
  - Los errores de negocio (4xx) quedan asociados a la clave; para reintentar más tarde se
    usa una clave nueva.
  - Los 5xx no se guardan, así que se puede reintentar con la misma clave.
- **Un pago por reserva.** `UNIQUE (reserva_id)` en compras: pagar con otra clave devuelve la
  compra que ya existe.
- **Expiración.**
  - Un barrido corre cada `BARRIDO_INTERVALO_MS` con `FOR UPDATE SKIP LOCKED` y un advisory
    lock (con varias instancias, barre una sola).
  - No guarda nada en memoria: **si la API se reinicia**, el barrido de arranque libera lo
    que venció mientras estaba caída.
- **Pago tardío** (la reserva venció antes de pagar):
  - Si el barrido todavía no pasó, el cupo sigue retenido y se emite.
  - Si ya pasó, se intenta recuperar el cupo con los mismos UPDATE condicionales. Si hay
    cupo, se emite. Si no, la compra queda `reembolso_automatico`: el cobro se registra y se
    devuelve en `reembolsos` con autor "sistema", y no se emiten entradas.

### Disponibilidad bajo mucho tráfico

La consulta de disponibilidad aguanta mucho más que la compra por dos razones:

1. **No cuenta filas.** `zonas.vendidas` y `zonas.reservadas` son una proyección que cada
   reserva, pago, cancelación, expiración y reembolso mantiene **en su misma transacción**.
   Leer la disponibilidad es leer 1 fila por zona.
2. **Micro-cache de 1 s** en memoria por evento (`CACHE_DISPONIBILIDAD_MS`), más
   `Cache-Control: public, max-age=1`. Se cachea la *promesa*: si miles de clientes piden el
   mismo evento en el mismo instante, la base recibe **una** consulta.

**¿Cuánto puede mentir?** Como máximo ~1 s, y está probado en los e2e. Además es solo
informativo: si alguien ve "quedan 2" y ya no quedan, su reserva recibe `409 cupo_agotado`
del UPDATE atómico. Nunca hay sobreventa por mirar un dato viejo.

### Administración: reglas y permisos

- **Permisos.** Toda ruta de `/v1/admin` verifica en el servidor que el evento sea del
  organizador. Para zonas y fases, primero se resuelve a qué evento pertenecen. Un evento
  ajeno responde **404, igual que uno inexistente**: probar ids no revela qué existe.
- **Reglas.** Las impone la base y se traducen a errores legibles:
  - bajar el aforo por debajo de lo vendido más lo reservado: `CHECK`, `409 aforo_menor_que_ocupado`;
  - fases que se solapan: `EXCLUDE`, `409 fases_solapadas`;
  - nombres duplicados: `UNIQUE`, `409`;
  - fechas inconsistentes: `CHECK`, `400 fechas_invalidas`;
  - quitar a un staff con turnos: `FK`, `409 staff_con_turnos`.
- **Precio congelado.** Cambiar el precio de una fase no afecta las reservas ya hechas.
- **Auditoría.** Cada cambio queda registrado en `auditoria`, en la misma transacción, con el
  valor anterior y el nuevo.

### Reembolsos y anulaciones

- **Quién puede:**
  - El **comprador**, mientras siga siendo titular y **antes de `reembolsable_hasta`**. El
    dinero vuelve a quien pagó, así que quien recibió una entrada por transferencia no
    puede reembolsarla.
  - El **organizador dueño o el admin**, con motivo obligatorio y sin fecha límite. Queda
    registrado con su autor en `reembolsos` y en la **auditoría inmutable**.
- **Nunca si la entrada se usó:**
  `UPDATE entradas SET estado = 'reembolsada' WHERE id = $1 AND estado IN ('pagada','transferida')`.
  Con la entrada `usada` la sentencia afecta 0 filas y la API responde `409 entrada_usada`. El
  escaneo bloquea la misma fila, así que un reembolso y un ingreso simultáneos se serializan.
- **En la misma transacción:**
  1. Se cancelan las transferencias pendientes.
  2. Se devuelve el cupo de la cuenta y de la zona, así que **vuelve a la venta**.
  3. Se registra el reembolso (`UNIQUE (entrada_id)`: una entrada no se reembolsa dos veces).
  4. Se publica la revocación para los escáneres.
  5. La compra pasa a `reembolsada` cuando no le queda ninguna entrada vigente.
- **Anular** es lo mismo, pero sin devolución de dinero.

### Código QR rotativo (invariante 3)

```
T1.<credencial>.<firma del servidor>.<timestamp>.<firma del teléfono>
```

1. **Llave del teléfono.** Al pedir el material, el teléfono del titular envía la llave
   **pública** de un par Ed25519 propio. La privada nunca sale del dispositivo.
2. **Credencial.** El servidor firma `{entrada, evento, zona, versión, llave del teléfono,
   vencimiento}` con **su** llave privada, que vive solo en el volumen de secretos de la API.
3. **Código.** Cada 15 s, el teléfono firma `credencial + hora actual` con su llave privada.
4. **Escáner, sin red.** Verifica:
   - la firma del servidor sobre la credencial;
   - la firma del teléfono sobre el código;
   - que `|ahora − hora del código| ≤ 30 s`;
   - que el evento y la zona correspondan a la puerta;
   - la lista de revocaciones sincronizada.

| Ataque | Por qué falla |
|---|---|
| Falsificar una entrada | No se puede firmar una credencial sin la llave privada del servidor. |
| Captura de pantalla o foto reenviada | Queda fuera de la ventana de 30 s (`expirado`). |
| Copiar la credencial a otro teléfono | Falta la llave privada del teléfono vinculado (`firma_invalida`). |
| Usar el código del dueño anterior tras una transferencia | La versión subió y la anterior está en la lista de revocación (`revocada`). |

Una entrada vale en **un solo teléfono a la vez**: si se pide material desde otro
dispositivo, la versión sube y el anterior queda revocado.

La verificación vive en `packages/shared` (`verificarToken`). Usa `@noble/curves`, que es JS
puro y corre igual en la API, en los tests y en la app. Los tests e2e verifican con esa misma
función credenciales firmadas por la API con `node:crypto`.

**Riesgo aceptado:** un código reenviado dentro de los 30 s sigue siendo válido. Ese caso lo
cubre el invariante 4: la entrada entra una sola vez.

**Revocaciones con cursor.** Las inserciones toman `pg_advisory_xact_lock` por evento. Así el
orden de los `id` coincide con el de confirmación y un escáner que pide `id > cursor` no se
saltea ninguna.

### Ingreso único con puertas offline (invariante 4)

**En el escáner, sin red:**
- Verifica el código con `verificarToken`.
- Rechaza localmente una entrada que ya escaneó.
- Guarda cada escaneo con un `client_scan_id` (UUID generado en el teléfono).

**Al sincronizar (`POST /v1/escaner/lotes`).** Cada escaneo va en su **propia transacción**:

```sql
INSERT INTO ingresos (..., resultado) VALUES (..., 'valido') ON CONFLICT DO NOTHING
```

Un `ON CONFLICT` sin columna cubre **todos** los índices únicos:
- `UNIQUE (client_scan_id)`: si el lote se reenvía, se devuelve lo que se decidió la primera
  vez (`repetido: true`) y no se duplica nada.
- El índice parcial `UNIQUE (entrada_id) WHERE resultado = 'valido'`: si otra puerta ya
  registró el ingreso válido, este se guarda como `duplicado_offline` y se abre un incidente
  `doble_ingreso` con los dos ingresos (puerta, dispositivo y hora). **Nada se borra.**

Si dos puertas sincronizan **al mismo tiempo**, el segundo INSERT espera en el índice al
primero y cae en "duplicado". Siempre queda **exactamente un** ingreso válido.

| Situación | Resultado |
|---|---|
| Misma entrada dos veces en el mismo escáner | Rechazo local `ya_usada`, sin red |
| Misma entrada en dos puertas offline | 1 `valido`, 1 `duplicado_offline` e incidente `doble_ingreso` en el portal |
| Reenvío del mismo lote | `repetido: true`, sin filas nuevas |
| Código con firma inválida | Rechazo guardado e incidente `firma_invalida` |
| Entra una entrada ya reembolsada (el escáner no tenía la revocación) | Ingreso registrado (ocurrió), la entrada sigue reembolsada e incidente `escaner_desincronizado` |

Queda como válido el escaneo que **sincroniza** primero, no necesariamente el que escaneó
primero. Las dos horas quedan en el incidente para revisión humana.

**Correlación.** Cada respuesta trae `X-Request-Id`, que es el mismo `correlacion_id` de los
logs JSON. Si el cliente o nginx mandan un `X-Request-Id`, se reutiliza.

## Datos de prueba

`apps/api/seed/datos-prueba-ticketing.json` es el dataset oficial y no se modifica. Al
cargarlo se hacen tres transformaciones:

1. **Fechas.** El dataset es una foto tomada en `meta.referencia_temporal`
   (2026-09-01T06:00Z). La primera carga calcula cuántos días enteros pasaron desde
   entonces y mueve **todas** las fechas esa misma cantidad. Así se conservan las relaciones
   entre fechas: el evento 4 sigue en venta y la zona 8 conserva 50 entradas disponibles.
   El desplazamiento se guarda **una sola vez** en la tabla `semillas`. Volver a arrancar no
   mueve las fechas otra vez.
2. **IDs del personal.** Los IDs de admin (101), organizadores (201-203) y staff (301-312)
   chocan con los de asistentes en la tabla única `usuarios`. Por eso el personal queda con
   `100000 + id` (por ejemplo, el admin es 100101).
3. **Datos derivados** que el dataset no trae:
   - contadores `vendidas` y `reservadas` de cada zona;
   - cupo usado por cuenta;
   - `version` de cada entrada (1 + transferencias aceptadas);
   - fase y precio congelado de las reservas históricas;
   - reembolsos y revocaciones de las entradas anuladas.

**Idempotencia.** La carga corre en una sola transacción, bajo un advisory lock, y termina
registrando el dataset en `semillas`. Si el dataset ya está registrado, no hace nada. Si
falla a mitad, no deja nada a medias y se reintenta en el siguiente arranque.

## Verificación

```bash
# Servicios y salud
docker compose ps
curl -s localhost:3000/ready        # {"estado":"listo","esquema":"0005"}
curl -s localhost:8080/ready        # lo mismo, pasando por el proxy de nginx

# Línea base de la prueba de concurrencia (evento 4, zona 8)
docker compose exec db psql -U ticketing_owner -d ticketing -c "
  SELECT z.aforo,
         (SELECT count(*) FROM entradas e WHERE e.zona_id = z.id AND e.estado <> 'reembolsada') AS no_reembolsadas,
         z.vendidas, z.reservadas, z.aforo - z.vendidas - z.reservadas AS restantes
    FROM zonas z WHERE z.id = 8;"
# aforo 500 | no_reembolsadas 450 | vendidas 450 | reservadas 0 | restantes 50

# Volver a correr el importador: debe responder "semilla_ya_aplicada" sin cambiar nada
docker compose run --rm migrate

# Tests unitarios de la API (Node 24: `fnm use` o `nvm use` lee .nvmrc)
npm ci && npm test -w api
```

Los resultados observados están en [docs/delivery.md](docs/delivery.md).

## Pruebas automatizadas

Requieren Node 24.9 o superior (`fnm use` o `nvm use`, que leen `.nvmrc`) y Docker.

| Comando | Tipo | Qué cubre |
|---|---|---|
| `npm test -w api` | Unitarias (sin base) | Tokens: firma, alteración del payload, `alg: none`, otra llave, expirado, otra audiencia. `/health` y `/ready` (esquema desactualizado, base caída). |
| `./apps/api/test/correr-e2e.sh` | e2e contra **PostgreSQL real** (proyecto aislado `ticketing-test`, se borra al terminar) | Ver la lista de abajo. |
| `./load-tests/correr.sh` | Carga (k6) | 200 compradores contra 50 entradas, verificado en PostgreSQL. |

Los e2e levantan la app dentro de jest, conectada con el **rol de aplicación** (los mismos
permisos que en producción). Cada test crea su propio evento y su zona. Cubren:

- **Aforo:**
  - 20 compradores simultáneos por 5 lugares: exactamente 5 reservan y 15 reciben `409`.
  - El `CHECK` rechaza una sobreventa escrita directo en la base.
- **Límite por cuenta:** dos reservas simultáneas que juntas lo superan: solo una entra.
- **Cobro único:**
  - Precio manipulado: se ignora y se cobra el de la fase.
  - 5 pagos simultáneos con la misma clave: 1 compra y 1 cobro.
  - Pagar con otra clave devuelve la misma compra.
  - Reservar dos veces con la misma clave retiene cupo una sola vez.
  - Misma clave con otra petición: `422`. Sin clave: `400`.
- **Acceso:** la reserva ajena da `404` y sin sesión da `401`.
- **Código rotativo:**
  - Un código recién generado es válido.
  - Una captura de hace 60 s se rechaza como `expirado`; una de hace 15 s sigue valiendo.
  - La credencial copiada a otro teléfono da `firma_invalida`.
  - Una credencial alterada o firmada con otra llave da `firma_invalida`.
  - Otro evento u otra zona se rechazan.
  - Cambiar de teléfono revoca el código del teléfono anterior.
- **Transferencias:**
  - Al aceptar, el código del dueño anterior queda `revocada` y el nuevo dueño obtiene el suyo.
  - Hay una sola transferencia pendiente por entrada, que se puede cancelar o rechazar.
  - No se puede transferir a uno mismo, ni a quien no es asistente, ni una entrada usada.
- **Revocaciones:** solo las ve el staff asignado al evento, y el cursor devuelve solo lo nuevo.
- **Escaneo offline:**
  - Rechazo local del duplicado en el mismo escáner.
  - Dos puertas con la misma entrada: 1 válido, 1 duplicado e incidente visible en el portal.
  - El reenvío de lotes, incluso en paralelo, no duplica nada.
  - 10 entradas escaneadas en dos puertas que sincronizan **a la vez**: exactamente 10 válidos
    y 10 incidentes.
  - Una firma inválida abre un incidente.
  - Una entrada reembolsada que entra genera `escaner_desincronizado`.
- **Reembolsos:**
  - Devuelve el dinero una vez, libera el cupo (otro comprador puede tomar el lugar) y
    revoca el código.
  - Una entrada **usada** no se reembolsa, ni por el asistente ni por administración.
  - Doble toque con la misma clave: un solo reembolso.
  - Fuera de plazo: el asistente no puede, el organizador sí.
  - Solo el comprador que sigue siendo titular puede pedirlo, y una transferencia pendiente
    se cancela.
  - Una compra de 2 entradas queda `reembolsada` recién cuando se reembolsan las dos.
  - Reembolso y anulación administrativos quedan con motivo y autor en la auditoría.
  - Organizador ajeno: 404. Asistente en una ruta de admin: 403.
- **Cartelera:**
  - Muestra la disponibilidad por zona y la fase vigente; un borrador no es visible.
  - El cursor recorre todo sin repetidos.
  - La caché devuelve el dato viejo dentro del segundo y el dato real después.
- **Administración:**
  - Un borrador se publica y se compra, y todo queda auditado.
  - Las reglas de la base llegan como 409/400 claros.
  - El precio queda congelado al reservar.
  - **Caso 8:** el organizador ajeno recibe 404 en 8 operaciones (ver, editar evento, zonas,
    fases, puertas y staff) y nada cambia en la base.
  - Asistente: 403. Admin: acceso total.
- **Reportes:**
  - Ventas netas de reembolsos.
  - Accesos por puerta y hora, con dispositivos.
  - Búsqueda por comprador, escapando los comodines de `LIKE`.
  - Auditoría: el organizador ve solo sus acciones.
  - Resolver incidentes: queda auditado; el organizador ajeno recibe 404 y resolver dos veces da 409.
- **Permisos:**
  - Staff no asignado: no puede abrir turno.
  - Dispositivo ajeno: no se puede registrar ni usar para subir lotes.
  - Un asistente no puede usar el modo escáner (403).
  - Un organizador ajeno ve 404 en los incidentes de otro evento.
- **Cancelación y expiración:**
  - Cancelar libera el cupo y es idempotente.
  - Una reserva vencida devuelve el cupo a la zona y a la cuenta.
  - Pago tardío con cupo: se emite.
  - Pago tardío sin cupo: `reembolso_automatico`, sin entradas.

**¿Los tests detectan bugs de verdad?** Se comprobó rompiendo el código a propósito:
- **Aforo:** sin `vendidas + reservadas + n <= aforo` en el UPDATE, fallan 2 tests.
- **QR:** sin el chequeo de la ventana de 30 s, falla el test de la captura de pantalla.
- **Reembolso:** sin `AND estado IN ('pagada','transferida')`, fallan el test de la entrada
  usada y el del doble reembolso.
- **Organizador ajeno:** sin el chequeo de dueño al editar un evento, falla el test del caso 8.

En el caso del aforo, además, **no hubo sobreventa**: el `CHECK` de la tabla rechazó las escrituras (la API respondió 500 en lugar de 409). Las dos
capas funcionan por separado.

### Prueba de carga (200 compradores contra 50 entradas)

```bash
./load-tests/correr.sh
```

Solo requiere Docker. Resultado: **exactamente 50 vendidas** en 3 de 3 corridas, verificado
en PostgreSQL. Detalle, resultados y explicación en [load-tests/README.md](load-tests/README.md).

## Rendimiento

- **Disponibilidad:** proyección en `zonas` y micro-cache de 1 s. Ver
  [Disponibilidad](#disponibilidad-bajo-mucho-tráfico).
- **Índices justificados, uno por uno, y `EXPLAIN (ANALYZE)` de las consultas más costosas,
  medidos a escala** (200 000 usuarios y 300 000 compras):
  [docs/rendimiento/README.md](docs/rendimiento/README.md). Resultados:
  - búsqueda por comprador: de 181 ms a **8,4 ms** (índices trigrama, migración `0005`);
  - reporte de ventas: de 100 ms a **64 ms**;
  - reservar: **0,2 ms**.
- **Paginación por cursor** en todos los listados que crecen.
- **App:** listas virtualizadas (`FlatList`) y QR que se recalcula solo cuando cambia la
  ventana de 15 s. El escáner usa SQLite con índices parciales para miles de escaneos.

## Arquitectura (resumen)

- **Monorepo** con npm workspaces y un solo lockfile, en Node 24 LTS:
  - `apps/api`: NestJS con `pg` directo. Las rutas críticas usan SQL explícito.
  - `apps/admin`: React + Vite servido por nginx.
  - `apps/mobile`: Expo (billetera y escáner).
  - `packages/shared`: formato, generación y **verificación offline del QR**. La misma función corre en la API, en los tests y en la app.
- **Capas en la API:** los controllers solo validan (zod) y delegan; la lógica vive en los
  servicios; el SQL crítico es explícito. Errores con forma única y logs JSON con correlación.
- **Dos roles de base de datos:**
  - `ticketing_owner` ejecuta migraciones y semilla.
  - `ticketing_app` es el rol de la API: no puede crear tablas, no puede editar ni borrar
    hechos (ingresos, reembolsos, revocaciones) y solo tiene INSERT y SELECT en `auditoria`.
- **Migraciones:** SQL plano numerado. Un runner propio las aplica con checksum (si alguien
  edita una migración ya aplicada, el runner se niega a seguir) y advisory lock.

Más detalle en [docs/agent-handoff.md](docs/agent-handoff.md).

### Garantías en el esquema

| Invariante | Mecanismo en la base de datos |
|---|---|
| 1. Aforo | `CHECK (vendidas + reservadas <= aforo)` en `zonas`. El cupo se toma con un `UPDATE` condicional atómico, nunca leyendo y luego insertando. |
| 1b. Límite por cuenta | Tabla `cupo_cuenta`, que se actualiza con un UPSERT condicional. |
| 2. Cobro único | `UNIQUE (usuario_id, idempotency_key)` en reservas y compras, `UNIQUE (reserva_id)` en compras, y tabla `idempotency_keys`. El precio se congela en la reserva. |
| 3. QR | Columnas `version` y `dispositivo_pubkey` en entradas, más tabla `revocaciones` con cursor incremental. |
| 4. Ingreso único | `UNIQUE (client_scan_id)` e índice único parcial: como máximo un ingreso `valido` por entrada. |
| Auditoría | Trigger que bloquea UPDATE, DELETE y TRUNCATE, más permisos de solo inserción para la app. |

Cada `CREATE TABLE` en `apps/api/migrations/` explica en sus comentarios el porqué de cada
restricción.

## Portal web

React + Vite, construido y servido por nginx en `http://localhost:8080`. Entran
organizadores y admin (`org.istmo@ticketing.test` / `Organizador2026!`,
`admin@ticketing.test` / `Admin2026!`).

| Sección | Qué permite |
|---|---|
| Eventos | Listado con ocupación. Crear eventos en borrador. |
| Ventas | Por zona: vendidas, reservadas vigentes, disponibles e ingresos (cobrado, reembolsado y neto). Se refresca cada 5 s. |
| Configuración | Datos del evento y publicación, zonas con aforo, fases de precio, puertas y staff asignado. Los errores de la base se muestran tal cual (por ejemplo, "aforo menor que lo vendido"). |
| Entradas | Buscar por comprador, y reembolsar o anular con motivo. |
| Accesos | Ingresos por puerta y por hora, cuántos hay dentro del recinto, y dispositivos con su última sincronización (avisa si un escáner con turno abierto lleva más de 10 min sin sincronizar). |
| Incidentes | Doble ingreso, firma inválida y escáner desincronizado, con el detalle de ambos ingresos. Se pueden resolver con una nota. Se refresca cada 10 s. |
| Auditoría | Registro inmutable de acciones administrativas. |

Para desarrollo con recarga en caliente: `npm run dev -w admin`. Vite hace de proxy de `/v1`
hacia `http://localhost:3000`.

**Decisión sobre la sesión del portal:** el access token vive en memoria y el refresh en
`sessionStorage`, que se borra al cerrar la pestaña. Con más tiempo, el refresh iría en una
cookie `httpOnly` y `SameSite=Strict` emitida por la API.

## App móvil

`apps/mobile` (Expo SDK 58) corre **fuera** de Docker, con Expo Go: no hace falta compilar
nada nativo. Instrucciones exactas, pantallas y el guion de la demo de dos puertas offline en
[apps/mobile/README.md](apps/mobile/README.md).

```bash
API_BIND=0.0.0.0 docker compose up          # API visible en la red local
cd apps/mobile && EXPO_PUBLIC_API_URL=http://<IP-de-tu-PC>:3000 npx expo start
```

- Emulador Android o teléfono físico: `http://<IP-de-tu-Mac>:3000`, con `API_BIND=0.0.0.0`.
  Con Docker Desktop, `10.0.2.2` no llega al API. La IP se obtiene con `ipconfig getifaddr en0`.
- Simulador iOS: `http://localhost:3000`.

## Decisiones y lo que no se hizo

**Decisiones de diseño** (el porqué completo está en [AGENTS.md](AGENTS.md) y en los
comentarios de cada migración):
- **Ed25519 y no HMAC.** El escáner verifica sin red, así que no puede tener la llave que
  firma.
- **Sin Redis.** Postgres resuelve la concurrencia (UPDATE condicional, UNIQUE, `SKIP LOCKED`).
  El rate limiting es en memoria, porque hay una sola instancia. Con varias instancias, el
  contador del rate limit iría a Redis.
- **Pago tardío.** Si hay cupo se emite; si no, `reembolso_automatico`.
- **Doble ingreso offline.** Queda válido el escaneo que sincroniza primero; los dos quedan
  registrados en el incidente.

**Omitido a propósito** (el enunciado pide priorizar los invariantes):

| Omitido | Motivo y estado |
|---|---|
| Compra como invitado y fila virtual | Diseñados y aprobados (ver [AGENTS.md](AGENTS.md#compra-con-cuenta-o-como-invitado-bonus-después-de-los-invariantes)), no implementados por tiempo. La fila virtual es un bonus del enunciado. |
| Detector de "picos sospechosos de compra" | El tipo de incidente existe en la base y en el portal; falta el proceso que lo genere. |
| Lista de espera, asientos numerados, wallets, notificaciones, despliegue en la nube | Bonus. |
| CI en GitHub Actions y OpenTelemetry | Bonus. Los logs ya son JSON con `correlacion_id`. |
| Tests e2e de la app (Detox o Maestro) | Bonus. La criptografía de la app está cubierta por los e2e del backend (misma función). |

## Huecos conocidos

- Rate limiting por IP en memoria: con varias instancias de la API haría falta un almacén
  compartido (Redis). Detrás de un proxy, todos los clientes comparten la IP del proxy;
  todavía no se configuró `trust proxy`.
- `npm audit`: la API no tiene vulnerabilidades. Hay 3 moderadas en `minimatch`, que solo usan
  las herramientas de build de Expo y no llegan a la API. La corrección que propone npm baja
  Expo de versión mayor, así que se dejó documentado.
- App móvil: sin build instalable; se ejecuta con Expo Go siguiendo las instrucciones exactas de [apps/mobile/README.md](apps/mobile/README.md).
- Sesión del portal: el refresh token vive en `sessionStorage`. Lo ideal es una cookie `httpOnly`.

## Créditos

- Íconos: [Icons8](https://icons8.com) (licencia gratuita con atribución). Están en
  `apps/admin/public/iconos/` y `apps/mobile/assets/iconos/`, y el portal enlaza a Icons8
  desde el login.
- Fotos del carrusel del portal (`apps/admin/public/carrusel/`): se usan solo con fines
  demostrativos. Los derechos pertenecen a sus autores.
- Tipografía [Outfit](https://fonts.google.com/specimen/Outfit) (SIL Open Font License),
  empaquetada con `@fontsource-variable/outfit`.
