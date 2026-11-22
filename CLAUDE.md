@AGENTS.md

## Solo para Claude Code

- Responder en español y con explicaciones simples. Primero la idea, después el detalle técnico.
- Trabajar por bloques. Al cerrar cada bloque, **hacer una pausa**: resumir qué cambió y por
  qué, mostrar lo verificado y dar los comandos `git add` y `git commit` exactos para que la
  persona haga el commit. No avanzar al siguiente bloque hasta que confirme ("listo").
- Si hay cambios sin commitear que el siguiente bloque va a tocar, pedir primero ese commit,
  para que los commits sigan siendo pequeños.
- Para verificar en limpio, usar un proyecto Compose aislado (`COMPOSE_PROJECT_NAME` y puertos
  distintos) y no tocar los volúmenes del stack local.
