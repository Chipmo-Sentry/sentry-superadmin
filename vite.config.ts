import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite SPA for the Chipmo Sentry super-admin panel.
// Dev server on 5173. `/api` is proxied to the backend so the browser stays
// same-origin and the host-only SameSite=Lax auth cookie is sent (mirrors the
// prod server.mjs proxy). Override the target with BACKEND_ORIGIN.
const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: BACKEND_ORIGIN, changeOrigin: true },
    },
  },
});
