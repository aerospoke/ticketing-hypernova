-- 0004: piezas transversales: idempotencia HTTP, auditoría inmutable y control de semilla.

-- ---------------------------------------------------------------------------
-- Claves de idempotencia (patrón de Stripe) para todo endpoint que mueve dinero:
-- reservar, pagar, cancelar, reembolsar.
--   1. INSERT ... ON CONFLICT DO NOTHING con estado 'en_proceso' (gana una sola petición).
--   2. Si la fila ya existía:
--        - hash_peticion distinto      -> 422 (misma clave, otra petición: error del cliente)
--        - 'en_proceso'                -> 409 (la primera sigue corriendo; reintentar luego)
--        - 'completada'                -> se devuelve la respuesta guardada, tal cual.
--   3. La operación de negocio y el paso a 'completada' van en la misma transacción, así
--      no puede quedar "cobrado pero sin respuesta guardada". Si la transacción falla, la
--      fila 'en_proceso' se borra y el cliente puede reintentar con la misma clave.
-- La clave se acota por usuario y por operación: dos usuarios pueden usar el mismo UUID.
-- ---------------------------------------------------------------------------
CREATE TABLE idempotency_keys (
  usuario_id        bigint      NOT NULL REFERENCES usuarios (id),
  operacion         text        NOT NULL CHECK (length(operacion) BETWEEN 1 AND 100),
  clave             text        NOT NULL CHECK (length(clave) BETWEEN 1 AND 200),
  hash_peticion     bytea       NOT NULL CHECK (length(hash_peticion) = 32),
  estado            text        NOT NULL DEFAULT 'en_proceso' CHECK (estado IN ('en_proceso', 'completada')),
  codigo_respuesta  integer,
  respuesta         jsonb,
  creada_en         timestamptz NOT NULL DEFAULT now(),
  completada_en     timestamptz,
  expira_en         timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  PRIMARY KEY (usuario_id, operacion, clave),
  CONSTRAINT idempotency_completada CHECK (
    (estado = 'completada') = (codigo_respuesta IS NOT NULL AND completada_en IS NOT NULL))
);
-- Limpieza periódica de claves vencidas.
CREATE INDEX idempotency_keys_expira_idx ON idempotency_keys (expira_en);

GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO ticketing_app;

-- ---------------------------------------------------------------------------
-- Auditoría: acciones administrativas en un registro que la aplicación no puede
-- modificar ni borrar. Dos capas:
--   1. Permisos: ticketing_app solo tiene INSERT y SELECT (ni UPDATE, ni DELETE, ni TRUNCATE).
--      Aunque haya una inyección SQL en la API, el rol no puede reescribir la historia.
--   2. Trigger: bloquea UPDATE/DELETE/TRUNCATE para cualquier rol, incluido el dueño.
--      Así un error en una migración futura tampoco borra auditoría por accidente.
--      (Un superusuario podría deshabilitar el trigger; eso queda fuera del alcance de
--      la aplicación y quedaría registrado en los logs de PostgreSQL.)
-- ---------------------------------------------------------------------------
CREATE TABLE auditoria (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id        bigint      REFERENCES usuarios (id),  -- NULL = sistema
  accion          text        NOT NULL CHECK (length(accion) BETWEEN 1 AND 100),
  entidad         text        NOT NULL CHECK (length(entidad) BETWEEN 1 AND 100),
  entidad_id      text,
  detalle         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ip              inet,
  correlacion_id  text,
  creado_en       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_creado_idx ON auditoria (creado_en DESC, id DESC);
CREATE INDEX auditoria_entidad_idx ON auditoria (entidad, entidad_id);
CREATE INDEX auditoria_actor_idx ON auditoria (actor_id, creado_en DESC);

CREATE FUNCTION auditoria_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'auditoria es de solo inserción (% bloqueado)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER auditoria_sin_update_delete
  BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE FUNCTION auditoria_inmutable();

CREATE TRIGGER auditoria_sin_truncate
  BEFORE TRUNCATE ON auditoria
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_inmutable();

REVOKE ALL ON auditoria FROM PUBLIC;
GRANT SELECT, INSERT ON auditoria TO ticketing_app;
-- GENERATED ALWAYS no necesita USAGE sobre la secuencia para insertar.

-- ---------------------------------------------------------------------------
-- Control de la semilla: se aplica una sola vez por base. Guarda el desplazamiento
-- de fechas usado, para poder explicar por qué los eventos tienen las fechas que tienen.
-- La app no la toca.
-- ---------------------------------------------------------------------------
CREATE TABLE semillas (
  dataset           text        PRIMARY KEY,
  checksum          text        NOT NULL,
  desplazamiento    interval    NOT NULL,
  aplicada_en       timestamptz NOT NULL DEFAULT now()
);
