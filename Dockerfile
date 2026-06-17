# syntax=docker/dockerfile:1.7
# ============================================================================
# Single-repo build for Railway. ui-kit is a separate public repo (file: dep),
# so we clone + build it as a sibling at build time. Vite SPA → static dist/,
# served by `serve` with SPA fallback. No BuildKit cache mounts (Railway's
# builder rejects them). VITE_* vars are inlined at build time.
# ============================================================================

# ----------------------------------------------------------------------------
# Stage 1 — build: ui-kit + Vite production build
# ----------------------------------------------------------------------------
FROM node:22-alpine AS build
RUN apk add --no-cache git
WORKDIR /app

# Pinned to a tag for reproducible builds (bump deliberately on ui-kit release).
ARG UI_KIT_REF=v0.6.1
RUN git clone --depth 1 --branch "${UI_KIT_REF}" \
      https://github.com/Chipmo-Sentry/sentry-ui-kit.git sentry-ui-kit \
    && cd sentry-ui-kit \
    && npm ci --no-audit --no-fund \
    && npm run build

WORKDIR /app/sentry-superadmin
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# IMPORTANT: do NOT bake VITE_API_BASE_URL. The app talks same-origin and
# server.mjs proxies /api to BACKEND_ORIGIN (a RUNTIME var). Baking an absolute
# API base makes the browser call a cross-site host, dropping the SameSite=Lax
# auth cookie → admin login silently fails (ADR-0017).

COPY . .
RUN npm run build

# ----------------------------------------------------------------------------
# Stage 2 — runtime: static file server with SPA fallback
# ----------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080

RUN apk add --no-cache curl

# Static dist + the proxy server + its node_modules (express,
# http-proxy-middleware). node_modules is copied from build because the
# package.json has a file: ui-kit dep that can't resolve in a clean runtime.
COPY --from=build /app/sentry-superadmin/dist ./dist
COPY --from=build /app/sentry-superadmin/node_modules ./node_modules
COPY --from=build /app/sentry-superadmin/server.mjs ./server.mjs
COPY --from=build /app/sentry-superadmin/package.json ./package.json

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:${PORT:-8080}/ -o /dev/null || exit 1

CMD ["node", "server.mjs"]
