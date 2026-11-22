---
name: verify-offline-admission
description: Verifica el ingreso único con escáneres offline. Cubre el rechazo local de duplicados en el dispositivo, la reconciliación al sincronizar (duplicado_offline más incidente), la idempotencia del reenvío de lotes y la lista de revocación. Usar al tocar ingresos, incidentes, revocaciones, la sincronización del escáner o la app móvil en modo escáner, o antes de marcar los casos 4, 5 o 6 de docs/delivery.md.
---

# Verificar la admisión offline

## Cuándo activarla

- Cambios en las tablas `ingresos`, `incidentes`, `revocaciones`, `dispositivos` o `turnos`
  (migración 0003).
- Cambios en los endpoints del escáner (registro de dispositivo, subida de lotes, bajada de
  revocaciones).
- Cambios en el modo escáner de `apps/mobile`.
- Antes de marcar como ✅ los casos 4, 5 o 6 de [docs/delivery.md](../../../docs/delivery.md).

Contexto: [AGENTS.md](../../../AGENTS.md#invariantes) (invariantes 3 y 4) y
[docs/agent-handoff.md](../../../docs/agent-handoff.md).

## Pasos

Usar un proyecto Compose aislado:

```bash
export COMPOSE_PROJECT_NAME=ticketing-verif DB_PORT=5532 API_PORT=3100 ADMIN_PORT=8180
docker compose up -d --build --wait
psql_() { docker compose exec -T db psql -U ticketing_owner -d ticketing "$@"; }
```

### 1. La base impide dos ingresos válidos (disponible)

La entrada 5 ya tiene un ingreso `valido` en el dataset:

```bash
psql_ -c "BEGIN;
  INSERT INTO ingresos (client_scan_id, entrada_id, evento_id, puerta_id, staff_id, resultado, escaneado_en)
  SELECT 'verif-dup', entrada_id, evento_id, puerta_id, staff_id, 'valido', now() FROM ingresos WHERE entrada_id = 5;
  ROLLBACK;"
```

Esperado: `violates unique constraint "ingresos_un_valido_por_entrada_uk"`.

### 2. El mismo `client_scan_id` no se duplica (disponible)

```bash
psql_ -c "SELECT client_scan_id, count(*) FROM ingresos GROUP BY 1 HAVING count(*) > 1;"
```

Esperado: **0 filas**. El UNIQUE `ingresos_client_scan_uk` lo garantiza.

### 3. Rechazo local de duplicados en el dispositivo (**pendiente**)

Requiere el escáner en `apps/mobile`. En modo avión: escanear la misma entrada dos veces en
el mismo teléfono. La segunda lectura debe mostrar "ya usada" sin conexión. Evidencia: video
o capturas y el contador de escaneos pendientes.

### 4. Dos puertas offline y reconciliación (**pendiente**)

Requiere el endpoint de subida de lotes. Dos dispositivos en modo avión escanean la misma
entrada y sincronizan. Verificar en PostgreSQL:

- un ingreso `valido` y uno `duplicado_offline` para esa entrada (ninguno borrado);
- una fila en `incidentes` con `tipo = 'doble_ingreso'` y el ingreso duplicado;
- reenviar el mismo lote no cambia los conteos;
- el incidente aparece en el portal.

### 5. Revocación tras reembolso o transferencia (**pendiente**)

Después de sincronizar las revocaciones, el escáner rechaza offline la credencial anterior
(`version` menor) o la entrada anulada.

## Evidencia esperada

Pegar en la fila del caso en [docs/delivery.md](../../../docs/delivery.md):

- el commit;
- el comando;
- la salida real de psql;
- para los pasos con dispositivo, el enlace al video o GIF (el enunciado lo exige para el
  doble ingreso).

No marcar ✅ un paso pendiente por analogía con otro.

Al terminar: `docker compose down -v` **solo** con `COMPOSE_PROJECT_NAME=ticketing-verif`.
