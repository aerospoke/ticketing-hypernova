# Ticketing de eventos y control de acceso

Plataforma de venta de entradas con aforo limitado y control de acceso offline.
Prueba técnica de Hypernova Labs.

> **Video del recorrido:** pendiente.

## Estado

Este primer corte deja lista la base: `docker compose up` levanta la base de datos, aplica
las migraciones, carga el dataset oficial y sirve la API y el portal. El esquema ya
contiene las restricciones de los cuatro invariantes. Los flujos de negocio (compra, pago,
entradas, escaneo) **aún no tienen endpoints**. Ver [Huecos conocidos](#huecos-conocidos)
y el avance caso por caso en [docs/delivery.md](docs/delivery.md).

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
| POST | `/v1/reservas` | sesión + `Idempotency-Key` | Reserva `{zona_id, cantidad}`: retiene cupo y congela el precio de la fase vigente. Cualquier monto que mande el cliente se ignora. |
| GET | `/v1/reservas/:id` | sesión (dueño) | Estado y `segundos_restantes` para el contador |
| POST | `/v1/reservas/:id/cancelar` | sesión + `Idempotency-Key` | Libera el cupo. Cancelar dos veces no es error. |
| POST | `/v1/reservas/:id/pago` | sesión + `Idempotency-Key` | Pago simulado y emisión de las entradas |
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
curl -s localhost:3000/ready        # {"estado":"listo","esquema":"0004"}
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
- **Cancelación y expiración:**
  - Cancelar libera el cupo y es idempotente.
  - Una reserva vencida devuelve el cupo a la zona y a la cuenta.
  - Pago tardío con cupo: se emite.
  - Pago tardío sin cupo: `reembolso_automatico`, sin entradas.

**¿Los tests detectan bugs de verdad?** Se comprobó rompiendo a propósito el UPDATE de aforo
(sin `vendidas + reservadas + n <= aforo`): fallan 2 tests. Aun así **no hubo sobreventa**:
el `CHECK` de la tabla rechazó las escrituras (la API respondió 500 en lugar de 409). Las dos
capas funcionan por separado.

### Prueba de carga (200 compradores contra 50 entradas)

```bash
./load-tests/correr.sh
```

Solo requiere Docker. Resultado: **exactamente 50 vendidas** en 3 de 3 corridas, verificado
en PostgreSQL. Detalle, resultados y explicación en [load-tests/README.md](load-tests/README.md).

## Arquitectura (resumen)

- **Monorepo** con npm workspaces y un solo lockfile, en Node 24 LTS:
  - `apps/api`: NestJS con `pg` directo. Las rutas críticas usan SQL explícito.
  - `apps/admin`: React + Vite servido por nginx.
  - `apps/mobile`: Expo (billetera y escáner).
  - `packages/shared`: tipos compartidos.
- **Dos roles de base de datos:**
  - `ticketing_owner` ejecuta migraciones y semilla.
  - `ticketing_app` es el rol de la API: no puede crear tablas, no puede editar ni borrar
    hechos (ingresos, reembolsos, revocaciones) y solo tiene INSERT y SELECT en `auditoria`.
- **Migraciones:** SQL plano numerado. Un runner propio las aplica con checksum (si alguien
  edita una migración ya aplicada, el runner se niega a seguir) y advisory lock.

Más detalle en [docs/agent-handoff.md](docs/agent-handoff.md).

### Garantías que ya están en el esquema

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

## App móvil

Existe la base Expo en `apps/mobile` y se ejecuta **fuera** de Docker. Todavía no consume la
API (**pendiente**). Cuando lo haga, la URL se configurará con `EXPO_PUBLIC_API_URL`:

- Emulador Android: `http://10.0.2.2:3000`
- Simulador iOS: `http://localhost:3000`
- Teléfono físico: levantar la API con `API_BIND=0.0.0.0 docker compose up` y usar
  `http://<IP-de-tu-PC-en-la-LAN>:3000`.

## Huecos conocidos

- Sin endpoints de eventos (cartelera y disponibilidad), entradas, escáner ni administración.
- Rate limiting por IP en memoria: con varias instancias de la API haría falta un almacén
  compartido (Redis). Detrás de un proxy, todos los clientes comparten la IP del proxy;
  todavía no se configuró `trust proxy`.
- `npm audit`: la API no tiene vulnerabilidades. Hay 3 moderadas en `minimatch`, que solo usan
  las herramientas de build de Expo y no llegan a la API. La corrección que propone npm baja
  Expo de versión mayor, así que se dejó documentado.
- Portal: por ahora es una página que solo muestra el estado de la API.
- App móvil: plantilla de Expo sin integrar.
