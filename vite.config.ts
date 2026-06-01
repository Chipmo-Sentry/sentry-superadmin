import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Vite SPA for the Chipmo Sentry super-admin panel.
// Dev server on 5173; proxies nothing — talks to the backend directly with
// `credentials: "include"` (cookie auth). See README for CORS / same-site notes.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
