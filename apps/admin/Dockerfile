# Portal de administración: se construye con Vite y se sirve como estáticos con nginx
# (el enunciado pide el portal "servido construido", no un servidor de desarrollo).
# Contexto de build: raíz del monorepo (lockfile único).

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/admin/package.json apps/admin/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/
RUN npm ci --workspace admin --include-workspace-root=false --no-audit --no-fund
COPY apps/admin apps/admin
RUN npm run build --workspace admin

# Imagen sin privilegios de root: escucha en 8080.
FROM nginxinc/nginx-unprivileged:1.29-alpine AS runtime
COPY apps/admin/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist /usr/share/nginx/html
EXPOSE 8080
