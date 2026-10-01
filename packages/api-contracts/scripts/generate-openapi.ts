// Writes openapi.json from the Zod schemas. `--check` fails instead of writing
// when the committed document is out of date (CI drift gate, spec §6.8).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderOpenApiDocument } from "../src/openapi.ts";

const target = fileURLToPath(new URL("../openapi.json", import.meta.url));
// The iOS client is generated from a copy inside CoreNetworking (swift-openapi-generator reads
// the document from the target's sources).
const iosCopy = fileURLToPath(
  new URL("../../../apps/ios-provider/Modules/CoreNetworking/Sources/CoreNetworking/openapi.json", import.meta.url),
);
const rendered = renderOpenApiDocument();

if (process.argv.includes("--check")) {
  const read = (file: string) => {
    try {
      return readFileSync(file, "utf8");
    } catch {
      return ""; // Missing file counts as drift.
    }
  };
  if (read(target) !== rendered || read(iosCopy) !== rendered) {
    console.error(
      "api-contracts: openapi.json is out of date. Run `pnpm --filter @aestara/api-contracts build`.",
    );
    process.exit(1);
  }
  console.log("api-contracts: openapi.json is up to date");
} else {
  writeFileSync(target, rendered);
  writeFileSync(iosCopy, rendered);
  console.log("api-contracts: wrote openapi.json");
}
