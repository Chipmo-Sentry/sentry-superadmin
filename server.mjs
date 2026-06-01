// Static SPA server + same-origin API proxy for sentry-superadmin.
// The browser only talks to THIS origin; /api/* is proxied server-side to the
// backend so the auth cookie is host-only/same-origin (SameSite=Lax works) —
// no cross-site cookie problem, no custom domain needed.
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PORT = process.env.PORT || 8080;
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || "http://localhost:8000";
const distDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");

const app = express();

// Mount at root with a pathFilter so Express does NOT strip the /api prefix
// (backend routes are /api/v1/...). Non-/api requests fall through to static.
app.use(
  createProxyMiddleware({
    target: BACKEND_ORIGIN,
    changeOrigin: true,
    xfwd: true,
    pathFilter: (pathname) => pathname.startsWith("/api"),
  }),
);

app.use(express.static(distDir));

// SPA fallback — any non-/api route returns index.html
app.get("*", (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`sentry-superadmin listening on :${PORT} → API ${BACKEND_ORIGIN}`);
});
