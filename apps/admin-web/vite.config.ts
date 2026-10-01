// The admin web is a static SPA (ADR-0003). In development and in the
// end-to-end tests, /api is proxied to the api, so the refresh cookie and the
// Origin check behave as they do behind one site in production.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const api = process.env.AESTARA_API_URL ?? "http://127.0.0.1:3000";
const proxy = { "/api": { target: api, changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true, proxy },
  preview: { port: 5174, strictPort: true, proxy },
  build: { outDir: "dist", sourcemap: true },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts?(x)"],
    env: { VITE_API_BASE_URL: "http://localhost/api/v1" },
  },
});
