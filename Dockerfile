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

ARG UI_KIT_REF=main
RUN git clone --depth 1 --branch "${UI_KIT_REF}" \
      https://github.com/Chipmo-Sentry/sentry-ui-kit.git sentry-ui-kit \
    && cd sentry-ui-kit \
    && npm ci --no-audit --no-fund \
    && npm run build

WORKDIR /app/sentry-superadmin
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# VITE_* is inlined at build time → declare as build arg (Railway passes vars).
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

COPY . .
RUN npm run build

# ----------------------------------------------------------------------------
# Stage 2 — runtime: static file server with SPA fallback
# ----------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080

RUN apk add --no-cache curl && npm i -g serve@14

COPY --from=build /app/sentry-superadmin/dist ./dist

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:${PORT:-8080}/ -o /dev/null || exit 1

# `-s` = single-page-app fallback (all routes → index.html)
CMD ["sh", "-c", "serve -s dist -l ${PORT:-8080}"]
