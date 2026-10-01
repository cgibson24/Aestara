// The admin web is a static SPA (ADR-0003). In development and in the
// end-to-end tests, /api is proxied to the api, so the refresh cookie and the
// Origin check behave as they do behind one site in production.
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from "./security-headers.ts";

const api = process.env.AESTARA_API_URL ?? "http://127.0.0.1:3000";
const proxy = { "/api": { target: api, changeOrigin: false } };

/** Puts the policy in the built index.html (the dev server needs inline scripts for HMR). */
const contentSecurityPolicy: Plugin = {
  name: "aestara-content-security-policy",
  apply: "build",
  transformIndexHtml: () => [
    {
      tag: "meta",
      attrs: { "http-equiv": "Content-Security-Policy", content: CONTENT_SECURITY_POLICY },
      injectTo: "head-prepend",
    },
  ],
};

export default defineConfig({
  plugins: [react(), contentSecurityPolicy],
  server: { port: 5174, strictPort: true, proxy },
  preview: { port: 5174, strictPort: true, proxy, headers: SECURITY_HEADERS },
  build: { outDir: "dist", sourcemap: true },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts?(x)"],
    setupFiles: ["test/setup.ts"],
    env: { VITE_API_BASE_URL: "http://localhost/api/v1" },
  },
});
