// Writes openapi.json from the Zod schemas. `--check` fails instead of writing
// when the committed document is out of date (CI drift gate, spec §6.8).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderOpenApiDocument } from "../src/openapi.ts";

const target = fileURLToPath(new URL("../openapi.json", import.meta.url));
const rendered = renderOpenApiDocument();

if (process.argv.includes("--check")) {
  let committed = "";
  try {
    committed = readFileSync(target, "utf8");
  } catch {
    // Missing file counts as drift.
  }
  if (committed !== rendered) {
    console.error(
      "api-contracts: openapi.json is out of date. Run `pnpm --filter @aestara/api-contracts build`.",
    );
    process.exit(1);
  }
  console.log("api-contracts: openapi.json is up to date");
} else {
  writeFileSync(target, rendered);
  console.log("api-contracts: wrote openapi.json");
}
