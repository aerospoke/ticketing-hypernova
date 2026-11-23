# Imagen de la API. La usan dos servicios de compose: `migrate` (migraciones + semilla)
# y `api`. Contexto de build: raíz del monorepo (lockfile único).

FROM node:24-alpine AS base
WORKDIR /app
# npm ci valida el lockfile contra todos los workspaces: se copian todos los package.json.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/

FROM base AS build
RUN npm ci --workspace api --workspace @ticketing/shared --include-workspace-root=false --no-audit --no-fund
# Paquete compartido (verificación del QR): se construye antes que la API que lo usa.
COPY packages/shared packages/shared
RUN npm run build --workspace @ticketing/shared
COPY apps/api apps/api
RUN npm run build --workspace api

FROM base AS deps
RUN npm ci --workspace api --include-workspace-root=false --omit=dev --no-audit --no-fund

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
# node_modules/@ticketing/shared es un enlace al workspace: se copia su build.
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node apps/api/migrations ./apps/api/migrations
COPY --chown=node:node apps/api/seed ./apps/api/seed
WORKDIR /app/apps/api
USER node
CMD ["node", "dist/main.js"]
