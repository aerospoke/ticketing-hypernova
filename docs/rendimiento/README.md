# Rendimiento: índices y EXPLAIN

## Cómo se midió

Con el dataset oficial (3899 entradas, 617 usuarios), todas las consultas tardan menos de
1,3 ms y PostgreSQL elige *seq scan*, porque con tablas tan chicas leerlas enteras es más
barato que usar un índice. Ese `EXPLAIN` no demostraría nada, así que se midió **a escala**:

```bash
./docs/rendimiento/medir.sh   # proyecto Compose aislado; se borra al terminar
```

El script:
1. Levanta una base nueva y aplica migraciones y semilla.
2. Carga [datos sintéticos](cargar-escala.sql): **200 000 usuarios** y un evento con
   **300 000 compras y entradas**, 5 % reembolsadas.
3. Corre `EXPLAIN (ANALYZE, BUFFERS)` antes y después de cada mejora.

Salida completa: [resultado.txt](resultado.txt).

## Resultados

| Consulta | Antes | Después | Qué cambió |
|---|---|---|---|
| **Búsqueda de entradas por comprador** (portal, `ILIKE '%texto%'`) | 181 ms, seq scan de `entradas` y de `usuarios` (dos veces) | **8,4 ms** | Índices trigrama (migración `0005`) y `UNION ALL` en vez de `OR` |
| **Reporte de ventas** de un evento con 300 000 compras | 100 ms | **64 ms** | Filtro por `evento_id` (primera columna del índice) y reembolsado calculado desde `entradas` |
| **Reservar** (`UPDATE` condicional del aforo, la ruta caliente) | — | **0,2 ms** | Acceso por PK a una fila |

### La consulta más costosa: reporte de ventas a escala

```
Seq Scan on zonas z  (actual time=26.831..68.693 rows=3 loops=1)
  Filter: (evento_id = 10)
  SubPlan 1   -- cobrado
    ->  Aggregate  (actual time=22.120..22.120 rows=1 loops=3)
          ->  Index Scan using compras_evento_idx on compras c  (actual rows=100000 loops=3)
                Index Cond: ((evento_id = z.evento_id) AND (zona_id = z.id))
                Filter: (estado <> 'reembolso_automatico'::text)
  SubPlan 2   -- reembolsado
    ->  Aggregate  (actual time=0.620..0.620 rows=1 loops=3)
          ->  Index Scan using entradas_evento_idx on entradas e  (actual rows=5000 loops=3)
                Index Cond: ((evento_id = z.evento_id) AND (zona_id = z.id) AND (estado = 'reembolsada'::text))
  SubPlan 3   -- ingresaron
    ->  Index Only Scan using entradas_evento_idx on entradas e_1  (Heap Fetches: 0)
Execution Time: 64.287 ms
```

**Cómo leerlo:**
- Todo usa índices. El costo que queda (22 ms × 3 zonas) es **sumar 100 000 montos por
  zona**: es trabajo real, no un mal plan.
- Para un reporte de portal que se refresca cada 5 s, 64 ms está bien.
- **Siguiente paso si creciera:** guardar `cobrado` y `reembolsado` como contadores en `zonas`,
  igual que `vendidas` y `reservadas`, mantenidos en la misma transacción de cada pago y
  reembolso. Así la lectura sería O(zonas) en vez de O(compras). No se hizo para no sumar
  escrituras a la ruta caliente de la compra sin una necesidad medida.

**Antes del cambio**, el filtro era solo `zona_id`. Como `compras_evento_idx` es
`(evento_id, zona_id)`, PostgreSQL no podía usarlo de forma eficiente: escaneaba el índice
completo. Además, los reembolsos se sumaban con un *seq scan* de `reembolsos` por cada zona.

### Búsqueda por comprador

**Antes:**

```
Parallel Seq Scan on entradas e   (rows=100000 loops=3)
Parallel Seq Scan on usuarios c   (rows=66872 loops=3)
Parallel Seq Scan on usuarios t   (rows=66872 loops=3)
Execution Time: 181 ms
```

**Después:**

```
Bitmap Index Scan on usuarios_email_trgm_idx   Index Cond: (email ~~* '%masivo12345@%')
Bitmap Index Scan on usuarios_nombre_trgm_idx
Index Scan using entradas_comprador_idx / entradas_titular_idx ...
Execution Time: 8.4 ms
```

- Un B-tree no sirve para `ILIKE '%texto%'` cuando el comodín va al principio. `pg_trgm`
  indexa fragmentos de 3 letras y GIN resuelve esa búsqueda con el índice.
- Con `OR` entre "es el comprador" y "es el titular", el planificador elegía recorrer las
  entradas por `id`. Con `UNION ALL`, cada rama usa su propio índice.

## Por qué existe cada índice

| Índice | Consulta que lo usa |
|---|---|
| `zonas` PK | `UPDATE` condicional al reservar, pagar o liberar: la ruta caliente de la compra |
| `reservas_activas_expira_idx` (parcial `WHERE estado = 'activa'`) | Barrido de reservas vencidas. Solo contiene las activas, así que queda chico aunque haya millones de reservas históricas |
| `reservas_idempotencia_uk`, `compras_idempotencia_uk`, `compras_reserva_uk` | Garantías de cobro único (UNIQUE), y también búsqueda por clave |
| `compras_usuario_idx (usuario_id, pagada_en, id)` | Historial de compras con paginación por cursor |
| `compras_evento_idx (evento_id, zona_id)` | Reporte de ventas por zona |
| `entradas_titular_idx (titular_id, evento_id)` | Billetera (`/me/entradas`) |
| `entradas_comprador_idx` | Búsqueda por comprador, y cupo por cuenta |
| `entradas_evento_idx (evento_id, zona_id, estado)` | Reportes por zona y estado (reembolsadas, usadas) con *index-only scan* |
| `transferencias_una_pendiente_uk` (parcial) | Garantía: una transferencia pendiente por entrada |
| `revocaciones_evento_cursor_idx (evento_id, id)` | Revocaciones incrementales del escáner (`id > cursor`) |
| `ingresos_client_scan_uk` | Reenvío de lotes idempotente |
| `ingresos_un_valido_por_entrada_uk` (parcial `WHERE resultado = 'valido'`) | **Invariante 4**: un solo ingreso válido por entrada |
| `ingresos_evento_tiempo_idx (evento_id, escaneado_en)` | Accesos por hora |
| `incidentes_evento_idx (evento_id, creado_en)` | Panel de incidentes |
| `auditoria_creado_idx (creado_en, id)` | Auditoría con paginación por cursor |
| `refresh_tokens_hash_uk`, `refresh_tokens_familia_idx` | Refresh por hash, y comprobación de "sesión activa" en cada petición |
| `usuarios_email_trgm_idx`, `usuarios_nombre_trgm_idx` (GIN, `0005`) | Búsqueda `ILIKE '%…%'` del portal |
| `fases_precio_sin_solape` (GiST, EXCLUDE) | Garantía de una sola fase vigente, y búsqueda de la fase vigente de una zona |

## Paginación por cursor

Todos los listados que pueden crecer usan cursor (`id < cursor`, o `(fecha, id) > cursor`) y
nunca `OFFSET`. Así cada página cuesta lo mismo, sin importar cuán atrás esté:
- cartelera;
- billetera;
- historial de compras;
- entradas del portal;
- incidentes;
- auditoría;
- revocaciones del escáner.
