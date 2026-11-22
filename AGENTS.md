# AGENTS.md

Reglas canónicas del repositorio, para personas y para agentes. Si otra guía contradice este
archivo, manda este.

- Arranque, URLs, credenciales y verificación: [README.md](README.md)
- Layout, servicios, orden de arranque y semilla: [docs/agent-handoff.md](docs/agent-handoff.md)
- Avance y evidencia por caso de aceptación: [docs/delivery.md](docs/delivery.md)
- Skills de verificación:
  [verify-ticket-sales](.claude/skills/verify-ticket-sales/SKILL.md) ·
  [verify-offline-admission](.claude/skills/verify-offline-admission/SKILL.md)
- Enunciado: plataforma de venta de entradas y control de acceso (Hypernova Labs, 4 días).
  **Los cuatro invariantes van antes que la interfaz.**

## Cómo empezar una tarea

1. Abrir [docs/delivery.md](docs/delivery.md) y tomar el **primer caso sin marcar**.
2. Implementarlo en commits pequeños.
3. **Registrar la evidencia** en la fila: comando o demo realmente ejecutado, salida
   observada, aporte de la IA y próxima acción. Recién entonces cambiar el estado a ✅. Sin
   evidencia, el caso no está hecho.
4. La columna "Revisión humana" queda en `pendiente` hasta que una persona la revise.
5. Si cambia el layout, el arranque o la semilla, actualizar
   [docs/agent-handoff.md](docs/agent-handoff.md).

## Reglas de trabajo

- **Los commits los hace la persona.** Los agentes no hacen commit, push ni deploy. Al
  cerrar un bloque, proponen el commit (archivos y mensaje en Conventional Commits).
- **Antes de cambiar algo de concurrencia o de seguridad, preguntar.** Las decisiones de
  abajo no se cambian sin discutirlas.
- **Explicar el porqué** de cada decisión. Cada línea tiene que poder defenderse en la entrevista.
- **Una migración aplicada no se edita.** Los cambios de esquema van en un `NNNN_*.sql` nuevo.
- **Nada de secretos** en el repo, en los logs ni como valores por defecto.
- No inventar resultados ni comandos de prueba que todavía no existen. Lo no verificado se
  marca como pendiente.
- Dependencias: versiones ancladas en `package-lock.json` (único, en la raíz) y revisión con
  `npm audit`.

## Stack

- Monorepo con npm workspaces y Node 24 LTS (`.nvmrc`).
- `apps/api`: NestJS 12 (CommonJS) con `pg` directo. Las rutas críticas usan SQL explícito,
  sin ORM. Tests con Jest: `npm test -w api`.
- `apps/admin`: React + Vite, construido y servido por nginx con proxy a la API.
- `apps/mobile`: Expo (billetera del asistente y escáner offline del staff). Corre fuera de Docker.
- `packages/shared`: tipos y verificación de tokens compartidos entre la API y la app móvil.
- `docker-compose.yml`: `secrets` → `db` → `migrate` → `api` → `admin`.

## Decisiones tomadas

### Infraestructura
- **Secretos:** se autogeneran en volúmenes Docker (`infra/secrets/init-secrets.mjs`). Nada
  en el repo, nada por defecto. Se leen con la convención `_FILE`. Cada servicio monta solo
  lo que necesita.
- **Dos roles de BD:**
  - `ticketing_owner`: migraciones y semilla.
  - `ticketing_app`: la API. Sin DDL, sin UPDATE ni DELETE en auditoría, ingresos,
    reembolsos y revocaciones.
- **Migraciones:** SQL plano numerado en `apps/api/migrations`. Runner propio con checksum y
  advisory lock.
- **Semilla:**
  - El personal queda con `100000 + id`, porque sus IDs chocan con los de asistentes.
  - Las fechas se desplazan días enteros desde `meta.referencia_temporal` hasta la primera
    carga. El desplazamiento se guarda una sola vez en `semillas`.
- **Estado del evento:** solo administrativo (`borrador`, `publicado`, `cancelado`). Próximo,
  en venta y finalizado se derivan de las fechas.

### Invariantes
- **1. Aforo:**
  - Contadores `vendidas` y `reservadas` en `zonas`, modificados con un UPDATE condicional
    atómico.
  - `CHECK (vendidas + reservadas <= aforo)`.
  - Nunca SELECT y después INSERT.
- **Límite por cuenta:** tabla `cupo_cuenta`, actualizada con un UPSERT condicional atómico.
  Cuenta lo comprado; lo recibido por transferencia no consume cupo.
- **2. Cobro único:**
  - Idempotency-Key en la tabla `idempotency_keys`.
  - `UNIQUE (usuario_id, idempotency_key)` en compras y `UNIQUE (reserva_id)`.
  - Precio congelado en la reserva y calculado por el servidor.
  - Dinero en centésimos (int y bigint).
- **Pago tardío:** se intenta re-reservar el cupo de forma atómica. Si hay cupo, se emite. Si
  no, la compra queda `reembolso_automatico`.
- **Expiración de reservas:**
  - Vigencia resuelta en la consulta (`expira_en > now()`).
  - Barrido con `FOR UPDATE SKIP LOCKED`.
  - No hay estado en memoria, así que sobrevive a reinicios.
- **3. QR:**
  - Ed25519, no HMAC: el escáner verifica offline y no debe tener la llave de firma.
  - El teléfono del titular genera su propio par Ed25519 y solo envía la llave pública.
  - El servidor firma una credencial `{entrada, evento, zona, version, pubkey}`.
  - La app firma `{credencial, timestamp}` cada 15 s. El escáner acepta ±30 s.
  - Si cambia el titular o el dispositivo, `version` sube y la versión anterior se publica en
    `revocaciones`.
- **Revocaciones:** cursor por `id`. Las inserciones toman `pg_advisory_xact_lock(evento_id)`
  para que los ids se confirmen en orden.
- **4. Ingreso único:**
  - `client_scan_id` UNIQUE.
  - Índice único parcial: un solo ingreso `valido` por entrada.
  - El segundo ingreso offline se guarda como `duplicado_offline` y abre un incidente. Nunca
    se borra.

### Seguridad
- **Refresh tokens:**
  - Se guarda solo su hash SHA-256.
  - Rotan dentro de una familia. Si se reusa un token ya rotado, se revoca la familia entera.
  - Logout revoca la familia. El access token dura poco.
- **Rate limiting:** en memoria (`@nestjs/throttler`) con una sola instancia. Redis queda
  documentado como el paso para escalar.
- **Contraseñas:** scrypt nativo de Node (`apps/api/src/auth/password.ts`).
- **Auditoría:** la app solo tiene INSERT y SELECT. Un trigger bloquea UPDATE, DELETE y
  TRUNCATE para cualquier rol.
