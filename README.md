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

El login todavía no tiene endpoint. Las contraseñas se guardan con scrypt.

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

- Sin endpoints de autenticación, eventos, compra, entradas, escáner ni administración.
- Sin prueba de carga (200 compradores contra 50 entradas).
- Portal: por ahora es una página que solo muestra el estado de la API.
- App móvil: plantilla de Expo sin integrar.
- Logs con identificador de correlación: pendiente. nginx ya reenvía `X-Request-Id`.
