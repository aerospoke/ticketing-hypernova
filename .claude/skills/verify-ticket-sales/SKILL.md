---
name: verify-ticket-sales
description: Verifica contra PostgreSQL las garantías de venta (aforo, límite por cuenta, cobro único, expiración de reservas) y, cuando exista, la prueba de carga de 200 compradores contra 50 entradas. Usar al tocar migraciones de zonas, reservas o compras, el módulo de compra o la semilla, o antes de marcar los casos 1, 2, 3 o 9 de docs/delivery.md.
---

# Verificar la venta de entradas

## Cuándo activarla

- Cambios en `apps/api/migrations/` que afecten a `zonas`, `cupo_cuenta`, `reservas`,
  `compras` o `idempotency_keys`.
- Cambios en el módulo de compra (reservar, pagar, cancelar, barrido de expiración).
- Cambios en `apps/api/src/db/seed.ts`.
- Antes de marcar como ✅ los casos 1, 2, 3 o 9 de [docs/delivery.md](../../../docs/delivery.md).

Contexto: [AGENTS.md](../../../AGENTS.md#invariantes) (invariantes 1 y 2) y
[docs/agent-handoff.md](../../../docs/agent-handoff.md).

## Pasos

Verificar siempre en un proyecto Compose aislado, para no tocar el stack local:

```bash
export COMPOSE_PROJECT_NAME=ticketing-verif DB_PORT=5532 API_PORT=3100 ADMIN_PORT=8180
docker compose up -d --build --wait
psql_() { docker compose exec -T db psql -U ticketing_owner -d ticketing "$@"; }
```

### 1. Línea base (disponible)

Las entradas se cuentan directamente en `entradas`, no solo con el contador:

```bash
psql_ -c "SELECT z.aforo,
  (SELECT count(*) FROM entradas e WHERE e.zona_id = z.id AND e.estado <> 'reembolsada') AS no_reembolsadas,
  z.vendidas, z.reservadas, z.aforo - z.vendidas - z.reservadas AS restantes
  FROM zonas z WHERE z.id = 8;"
```

Esperado: `500 | 450 | 450 | 0 | 50`.

### 2. El contador coincide con las filas en todas las zonas (disponible)

```bash
psql_ -c "SELECT z.id, z.vendidas, count(e.*) FILTER (WHERE e.estado IN ('pagada','transferida','usada')) AS reales
  FROM zonas z LEFT JOIN entradas e ON e.zona_id = z.id GROUP BY z.id
  HAVING z.vendidas <> count(e.*) FILTER (WHERE e.estado IN ('pagada','transferida','usada'));"
```

Esperado: **0 filas**.

### 3. La base rechaza la sobreventa aunque el código falle (disponible)

```bash
psql_ -c "BEGIN; UPDATE zonas SET vendidas = vendidas + 51 WHERE id = 8; ROLLBACK;"
```

Esperado: `violates check constraint "zonas_no_sobreventa"`.

### 4. Carrera de 200 compradores contra 50 entradas (**pendiente**)

Todavía no existen los endpoints de compra ni el script de carga. Cuando existan, documentar
aquí el comando exacto (k6 en `load-tests/`) y verificar después **en PostgreSQL**, no en la
salida de k6:

- entradas vigentes nuevas en la zona 8 = exactamente 50;
- `vendidas + reservadas <= aforo`;
- respuestas 409 (sin cupo) = el resto de los compradores, ningún 500.

### 5. Doble toque, reserva vencida y precio manipulado (**pendiente**)

Dependen de los endpoints de reservar y pagar. No inventar comandos hasta que existan.

## Evidencia esperada

Pegar en la fila del caso en [docs/delivery.md](../../../docs/delivery.md):

- el commit (`git log -1 --oneline`);
- el comando ejecutado;
- la salida real de psql (y el resumen de k6 con p50/p95 cuando exista).

Al terminar: `docker compose down -v` **solo** con `COMPOSE_PROJECT_NAME=ticketing-verif`.
