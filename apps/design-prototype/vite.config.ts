// Two outputs from one source:
// - `vite` / `vite build`: a normal app for local development (React bundled).
// - `ARTIFACT=1 vite build`: a single IIFE with React left external, so the
//   published prototype page loads React 18 from cdnjs (see scripts/build-artifact.mjs).
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const artifact = process.env.ARTIFACT === "1";

export default defineConfig({
  plugins: [react({ jsxRuntime: "classic" })],
  build: artifact
    ? {
        outDir: "dist-artifact",
        emptyOutDir: true,
        cssCodeSplit: false,
        assetsInlineLimit: 100_000_000,
        rolldownOptions: {
          input: "src/main.tsx",
          external: ["react", "react-dom", "react-dom/client"],
          output: {
            format: "iife",
            entryFileNames: "prototype.js",
            assetFileNames: "prototype[extname]",
            globals: { react: "React", "react-dom": "ReactDOM", "react-dom/client": "ReactDOM" },
          },
        },
      }
    : { outDir: "dist" },
});
