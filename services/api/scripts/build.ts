// Bundles the api into dist/ with rolldown. Workspace packages (contracts,
// database, the generated Prisma client) are TypeScript sources, so they are
// bundled; npm dependencies stay external and load from node_modules.
// NestJS needs legacy decorators and their emitted type metadata, which
// rolldown takes from tsconfig.json.
//
// Usage: node scripts/build.ts
import { copyFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "rolldown";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};
const external = Object.entries(pkg.dependencies)
  .filter(([, version]) => !version.startsWith("workspace:"))
  .map(([name]) => name);
// Dependencies of the bundled workspace packages.
external.push("@prisma/client", "@prisma/adapter-pg", "pg", "@asteasolutions/zod-to-openapi");

await build({
  input: { main: join(root, "src/main.ts"), worker: join(root, "src/worker-main.ts") },
  platform: "node",
  external: (id) =>
    id.startsWith("node:") || external.some((name) => id === name || id.startsWith(`${name}/`)),
  tsconfig: join(root, "tsconfig.json"),
  output: { dir: join(root, "dist"), format: "esm", sourcemap: true },
});
// Data files the code loads next to itself (new URL("./…", import.meta.url)).
copyFileSync(join(root, "src/auth/common-passwords.txt.gz"), join(root, "dist/common-passwords.txt.gz"));
console.log("built dist/main.js and dist/worker.js");
