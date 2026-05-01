FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* bun.lockb* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

# Custom nginx config with SPA fallback + cache rules
COPY docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

# runtime-config.js is mounted at runtime (docker-compose) so the base image copy
# is fine; provide a default empty file for local runs without a mount.
RUN test -f /usr/share/nginx/html/runtime-config.js || echo "window.__CRM_RUNTIME_CONFIG__ = window.__CRM_RUNTIME_CONFIG__ || {};" > /usr/share/nginx/html/runtime-config.js

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
