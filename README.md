# sentry-superadmin

The platform-operator console for **Chipmo Sentry** — a single-page app where Chipmo staff (not customers)
run the whole tenancy: organizations, users, demo leads, the AI behaviour catalog, and the fleet of AI
compute nodes.

Vite 6 · React 19 · React Router 6 · Tailwind v4 · [sentry-ui-kit](https://github.com/Chipmo-Sentry/sentry-ui-kit) · Express proxy · Apache-2.0

---

## What it manages

| Page | Does |
|---|---|
| **Dashboard** (`/`) | stat cards (orgs, users, stores, cameras, AI nodes online, alerts/24h) + alert & feedback analytics |
| **Orgs** (`/orgs`, `/orgs/:id`) | list + create organizations; view members |
| **Users** (`/users`) | list, invite, enable/disable, toggle super-admin (with self-lockout guard) |
| **Leads** (`/leads`) | triage demo requests captured by the landing site (status + notes) |
| **Behaviours** (`/behaviors`) | the risk-scoring criteria catalog — add / enable / disable / delete dimensions, edit weights + 4-level thresholds |
| **AI nodes** (`/ai-nodes`) | generate a 6-digit pairing code, watch a node come online with live telemetry, configure (provider / frame-skip / enabled) or revoke it; resource time-series charts |

Every route is wrapped in `<RequireSuperAdmin>` — non-super-admins get a "Хандах эрхгүй" screen.

---

## How auth works (the same-origin trick)

The SPA shares the backend's httpOnly `sentry_access` cookie. To keep that cookie `SameSite=Lax` and
avoid any cross-site CORS problem, the app is **served by its own Express server** (`server.mjs`) that
proxies `/api/*` to `BACKEND_ORIGIN` and serves the built SPA for everything else. The browser only ever
talks to one origin ([ADR-0017](../docs/07-DECISIONS.md)). API calls go out with `credentials: "include"`.

Types are generated from the backend's OpenAPI spec (`openapi/backend.openapi.json` →
`src/lib/api.types.ts`) and a CI `codegen:check` fails on drift — the admin app can never disagree with the
backend about a field name.

```
src/
├── pages/        — LoginPage, DashboardPage, OrgsPage, OrgDetailPage, UsersPage,
│                   LeadsPage, BehaviorsPage, AiNodesPage
├── components/   — Layout, RequireSuperAdmin, Field, NodeMetricsChart
├── context/      — AuthContext
├── lib/          — api (credentials: include), api.types (generated), types
└── main.tsx
server.mjs        — Express: proxy /api/* → backend, SPA fallback
```

---

## Quick start

```bash
( cd ../sentry-ui-kit && npm install && npm run build )   # file: dependency
npm install
cp .env.example .env
npm run dev            # Vite dev server → http://localhost:5173
```

Scripts: `dev` · `build` (`tsc --noEmit` + `vite build`) · `preview` · `typecheck` · `lint` ·
`fetch-openapi` · `codegen` · `codegen:check`.

You'll need a backend running and a super-admin user (seed one in the backend, or bootstrap via
`BOOTSTRAP_SUPERADMIN_*`). In dev the Vite proxy points at the backend; in production `server.mjs` does.

---

## Deployment

Target: **Railway** (Dockerfile + `railway.toml`), live at `sentry-superadmin-production.up.railway.app`.

The Dockerfile clones + builds `sentry-ui-kit`, builds the SPA, and ships a Node-Alpine runtime that runs
`server.mjs` on `:8080` (healthcheck `/`). Set `BACKEND_ORIGIN` in the Railway dashboard; the backend must
list this app's origin in `ALLOWED_ORIGINS`. Do **not** bake an absolute `VITE_API_BASE_URL` — that would
break the same-origin cookie. CI (`codegen:check` + lint + typecheck + build) runs against the real ui-kit.

---

## Related repos

- [sentry-backend](https://github.com/Chipmo-Sentry/sentry-backend) — the admin + ai-node + leads APIs this consumes
- [sentry-frontend](https://github.com/Chipmo-Sentry/sentry-frontend) — the customer-facing sibling
- [sentry-ui-kit](https://github.com/Chipmo-Sentry/sentry-ui-kit) — shared components + tokens

Platform overview: [Sentry-v.3 README](../README.md).
