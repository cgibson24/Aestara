// Generates generated/enums.ts from the enums of packages/database/prisma/schema.prisma,
// so API contracts and services use exactly the database's values (spec §6.8).
// Only the enums of layers already built are included.
//
// Usage: node scripts/generate-enums.ts
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(here, "../../database/prisma/schema.prisma");
const outPath = join(here, "../generated/enums.ts");

export function parseEnums(schema: string): Map<string, string[]> {
  const enums = new Map<string, string[]>();
  for (const match of schema.matchAll(/^enum (\w+) \{([\s\S]*?)^\}/gm)) {
    const values = [...(match[2] ?? "").matchAll(/^\s+([A-Z][A-Z0-9_]*)\s*$/gm)].map((v) => v[1] as string);
    enums.set(match[1] as string, values);
  }
  return enums;
}

export function renderEnums(enums: Map<string, string[]>): string {
  const blocks = [...enums].map(
    ([name, values]) =>
      `export const ${name} = [${values.map((v) => `"${v}"`).join(", ")}] as const;\n` +
      `export type ${name} = (typeof ${name})[number];\n`,
  );
  return [
    "// GENERATED from packages/database/prisma/schema.prisma by scripts/generate-enums.ts. Do not edit.",
    "// Clients must tolerate values added later (spec §6.1.1).",
    "",
    blocks.join("\n"),
  ].join("\n");
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  writeFileSync(outPath, renderEnums(parseEnums(readFileSync(schemaPath, "utf8"))));
  console.log(`wrote ${outPath}`);
}
