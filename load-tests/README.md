# Prueba de carga: carrera por el último cupo

200 compradores concurrentes compiten por las **últimas 50 entradas** de la zona 8
(evento 4, aforo 500 con 450 vendidas en el dataset). Cada comprador reserva 1 entrada y,
si lo logra, la paga.

## Cómo correrla

Solo hace falta Docker. k6 corre en su imagen oficial, con la versión fijada (`grafana/k6:2.3.0`).

```bash
./load-tests/correr.sh              # levanta, prueba, verifica y borra el stack
./load-tests/correr.sh --conservar  # deja el stack arriba para inspeccionarlo
```

El script:

1. Levanta un proyecto Compose **aislado** (`ticketing-carga`) con volúmenes nuevos. No toca
   el stack local.
2. Sube los límites de rate **solo en ese proyecto**. Los 200 compradores salen de la misma
   IP (el contenedor de k6), y el límite normal los frenaría antes de llegar a la base.
3. Corre [`carrera-ultimo-cupo.js`](carrera-ultimo-cupo.js):
   - El `setup` registra 200 usuarios nuevos, para que ninguno arranque con su límite por
     cuenta consumido.
   - Después, los 200 arrancan a la vez.
4. **Verifica en PostgreSQL**, no en la salida de k6:
   - entradas vigentes nuevas en la zona = 50;
   - ninguna zona con `vendidas + reservadas > aforo`;
   - el contador `vendidas` coincide con las filas de `entradas` en todas las zonas.
5. Guarda la salida en [`resultados/ultima-corrida.txt`](resultados/ultima-corrida.txt).

k6 termina con error si no hay **exactamente** 50 ventas, 150 rechazos `409 cupo_agotado` y
0 errores inesperados (umbrales en el script).

## Resultados

Tres corridas seguidas, cada una con un stack nuevo (MacBook con Apple Silicon, Docker Desktop):

| Corrida | Ventas | 409 `cupo_agotado` | Errores | Reserva p50 / p95 | Pago p50 / p95 | Sobreventa |
|---|---|---|---|---|---|---|
| 1 | **50** | 150 | 0 | 173 / 202 ms | 122 / 150 ms | 0 |
| 2 | **50** | 150 | 0 | 119 / 147 ms | 101 / 131 ms | 0 |
| 3 | **50** | 150 | 0 | 118 / 144 ms | 103 / 139 ms | 0 |

Salida completa de la última corrida: [`resultados/ultima-corrida.txt`](resultados/ultima-corrida.txt).

## Por qué da exactamente 50

La decisión de si hay cupo no la toma el código, la toma PostgreSQL en una sola sentencia:

```sql
UPDATE zonas SET reservadas = reservadas + 1
 WHERE id = 8 AND vendidas + reservadas + 1 <= aforo
```

- El UPDATE bloquea la fila de la zona. Los 200 compradores se **serializan en esa fila**
  solo durante su transacción, que dura pocos milisegundos.
- Cada uno evalúa el `WHERE` con el valor ya confirmado por el anterior. Cuando no queda
  lugar, la sentencia afecta 0 filas y la API responde `409 cupo_agotado`.
- No existe un momento entre "leer cuántas quedan" e "insertar" en el que dos compradores
  puedan ver el mismo último lugar, porque no hay lectura separada.
- Además, `CHECK (vendidas + reservadas <= aforo)` rechaza cualquier sobreventa aunque un
  bug intentara escribirla.

## Sobre la latencia

Los ~120 ms de p50 son, casi todos, **espera en cola**, no trabajo:

- Los 200 llegan en el mismo instante.
- El pool tiene 20 conexiones (`DB_POOL_MAX`).
- Todos necesitan la misma fila de la zona.

Una reserva sola, sin competencia, tarda unos pocos ms. La primera corrida es más lenta
porque la API arranca en frío. Es el comportamiento esperado de un recurso que, por diseño,
no puede venderse en paralelo. Esta prueba mide la **corrección bajo contención**, no el
throughput máximo.
