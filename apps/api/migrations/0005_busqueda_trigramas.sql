-- 0005: búsqueda de entradas por comprador en el portal.
--
-- El portal busca con ILIKE '%texto%' sobre correo y nombre. Un índice B-tree no sirve
-- con un comodín al principio: con muchos usuarios, cada búsqueda recorría la tabla
-- entera. pg_trgm indexa trigramas (fragmentos de 3 letras) y GIN permite resolver
-- ILIKE '%texto%' con el índice. Medición antes/después en docs/rendimiento.md.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX usuarios_email_trgm_idx  ON usuarios USING gin (email gin_trgm_ops);
CREATE INDEX usuarios_nombre_trgm_idx ON usuarios USING gin (nombre gin_trgm_ops);
