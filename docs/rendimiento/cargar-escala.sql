-- Datos sintéticos para medir planes de consulta a escala (NO es parte de la semilla).
-- 200 000 usuarios y un evento masivo con 300 000 compras/entradas (5 % reembolsadas).
-- Uso: docs/rendimiento/medir.sh (proyecto Compose aislado, se borra al terminar).
BEGIN;

INSERT INTO usuarios (nombre, email, password_hash, rol)
SELECT 'Persona Masiva ' || g, 'masivo' || g || '@correo.test', 'sin-login', 'asistente'
  FROM generate_series(1, 200000) g;

INSERT INTO eventos (codigo, nombre, organizador_id, recinto, fecha, venta_abre, reembolsable_hasta, limite_por_cuenta)
VALUES ('MASIVO', 'Festival masivo', 100201, 'Estadio', now() + interval '60 days', now() - interval '30 days', now() + interval '50 days', 10);

INSERT INTO zonas (evento_id, nombre, aforo)
SELECT e.id, 'Zona ' || g, 100000 FROM eventos e, generate_series(1, 3) g WHERE e.codigo = 'MASIVO';

INSERT INTO fases_precio (zona_id, fase, precio_centesimos, desde, hasta)
SELECT z.id, 'general', 5000, now() - interval '30 days', now() + interval '59 days'
  FROM zonas z JOIN eventos e ON e.id = z.evento_id WHERE e.codigo = 'MASIVO';

-- 300 000 compras de 1 entrada, repartidas en las 3 zonas y entre los usuarios masivos.
WITH ev AS (SELECT id FROM eventos WHERE codigo = 'MASIVO'),
     zs AS (SELECT z.id, f.id AS fase, row_number() OVER (ORDER BY z.id) - 1 AS n
              FROM zonas z JOIN fases_precio f ON f.zona_id = z.id WHERE z.evento_id = (SELECT id FROM ev)),
     us AS (SELECT min(id) AS primero FROM usuarios WHERE email LIKE 'masivo%')
INSERT INTO compras (usuario_id, evento_id, zona_id, fase_precio_id, cantidad, precio_unitario_centesimos,
                     monto_centesimos, idempotency_key, estado, referencia_pago, pagada_en)
SELECT (SELECT primero FROM us) + (g % 200000), (SELECT id FROM ev), zs.id, zs.fase, 1, 5000, 5000,
       'masivo-' || g, 'pagada', 'sim-masivo-' || g, now() - (g % 1000) * interval '1 minute'
  FROM generate_series(1, 300000) g JOIN zs ON zs.n = g % 3;

INSERT INTO entradas (compra_id, evento_id, zona_id, comprador_id, titular_id, estado, precio_centesimos, emitida_en)
SELECT c.id, c.evento_id, c.zona_id, c.usuario_id, c.usuario_id, 'pagada', 5000, c.pagada_en
  FROM compras c WHERE c.idempotency_key LIKE 'masivo-%';

-- 5 % reembolsadas.
WITH r AS (
  UPDATE entradas SET estado = 'reembolsada', anulada_en = now()
   WHERE id IN (SELECT e.id FROM entradas e JOIN eventos ev ON ev.id = e.evento_id WHERE ev.codigo = 'MASIVO' AND e.id % 20 = 0)
  RETURNING id, compra_id)
INSERT INTO reembolsos (compra_id, entrada_id, monto_centesimos, motivo) SELECT compra_id, id, 5000, 'sintético' FROM r;
UPDATE compras SET estado = 'reembolsada', reembolsada_en = now()
 WHERE id IN (SELECT compra_id FROM entradas WHERE estado = 'reembolsada' AND compra_id IN (SELECT id FROM compras WHERE idempotency_key LIKE 'masivo-%'));

UPDATE zonas z SET vendidas = (SELECT count(*) FROM entradas e WHERE e.zona_id = z.id AND e.estado IN ('pagada','transferida','usada'))
 WHERE z.evento_id = (SELECT id FROM eventos WHERE codigo = 'MASIVO');

COMMIT;
ANALYZE;
