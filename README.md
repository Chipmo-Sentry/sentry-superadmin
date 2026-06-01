# sentry-superadmin

Chipmo Sentry super-admin panel — a Vite + React SPA for Chipmo staff to manage
organizations, users, and memberships across all tenants. Consumes
[`@chipmo-sentry/ui-kit`](../sentry-ui-kit).

## Stack

- **Vite 6** + **React 19** SPA
- **React Router 6** (client-side routing)
- **Tailwind CSS v4** (via `@tailwindcss/vite`) + ui-kit design tokens
- Plain `fetch` API client, **cookie-based auth** (`credentials: "include"`)

## Routes

| Path | Page | Backend |
|---|---|---|
| `/login` | Super-admin login | `POST /api/v1/auth/login` |
| `/` | Dashboard (counts) | `GET /api/v1/admin/stats` |
| `/orgs` | Organizations list + create | `GET`/`POST /api/v1/admin/orgs` |
| `/orgs/:orgId` | Org detail + members | `GET /api/v1/admin/orgs/{id}/members` |
| `/users` | Users list, invite, enable/disable, toggle super-admin | `GET`/`POST /api/v1/admin/users`, `PATCH /api/v1/admin/users/{id}` |

All `/admin/*` endpoints require `is_super_admin`. A non-super-admin who logs in
sees a "Хандах эрхгүй" (forbidden) screen.

## Develop

```bash
npm install
cp .env.example .env        # set VITE_API_BASE_URL if backend isn't localhost:8000
npm run dev                 # http://localhost:5173
```

> `@chipmo-sentry/ui-kit` is linked via `file:../sentry-ui-kit`. Build it first
> (`cd ../sentry-ui-kit && npm install && npm run build`) so `dist/` exists.

## Auth & CORS — important

Auth uses the same httpOnly cookie (`sentry_access`) that sentry-backend issues
on login. The browser only attaches it when:

1. **The backend allows this SPA's origin with credentials.** Add the SPA origin
   to the backend's `ALLOWED_ORIGINS` env (it already sets
   `allow_credentials=True`):
   - dev: `ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000`
   - prod: `ALLOWED_ORIGINS=https://admin.sentry.chipmo.mn,...`
2. **The SPA is served same-site as the API in production.** The cookie is
   `SameSite=Lax`, so it rides cross-subdomain fetches only when both sides share
   one registrable domain — e.g. `admin.sentry.chipmo.mn` (SPA) +
   `api.sentry.chipmo.mn` (backend). Hosting the SPA on an unrelated domain would
   require switching the backend cookie to `SameSite=None; Secure`.

In local dev both run on `localhost`, so the Lax cookie works out of the box.

## Scripts

- `npm run dev` — dev server (port 5173)
- `npm run build` — `tsc -b` typecheck + production build to `dist/`
- `npm run preview` — serve the production build
- `npm run typecheck` — `tsc --noEmit`
