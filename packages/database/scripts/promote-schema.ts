// Generates prisma/schema.prisma from the design schema for the layers built so far.
//
// The design (docs/technical-spec/schema.prisma) stays the single source of every
// table. Spec §5.8 says which layer creates which table; this script copies the
// models of layers 1..PROMOTED_THROUGH_LAYER verbatim, drops only the relation
// fields that point at tables a later layer creates, together with the foreign
// key columns that serve only those relations (spec §5.8: a forward reference
// arrives with the later table), and keeps the enums those models use.
// `--check` fails if the committed file differs (CI drift gate).
//
// Usage: node scripts/promote-schema.ts [--check]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The highest layer whose tables exist in packages/database. */
export const PROMOTED_THROUGH_LAYER = 4;

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const designPath = join(root, "docs/technical-spec/schema.prisma");
const specPath = join(root, "docs/TECHNICAL_SPECIFICATION.md");
const outPath = join(here, "..", "prisma/schema.prisma");

interface Block {
  kind: "model" | "enum";
  name: string;
  /** `///` doc comment lines directly above the block. */
  doc: string[];
  lines: string[];
}

function parseBlocks(source: string): Block[] {
  const lines = source.split("\n");
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const head = /^(model|enum) (\w+) \{$/.exec(lines[i] ?? "");
    if (!head) continue;
    const doc: string[] = [];
    for (let j = i - 1; j >= 0 && (lines[j] ?? "").startsWith("///"); j--) doc.unshift(lines[j] ?? "");
    const body: string[] = [];
    let k = i + 1;
    for (; k < lines.length && lines[k] !== "}"; k++) body.push(lines[k] ?? "");
    if (k === lines.length) throw new Error(`unterminated ${head[1]} ${head[2]}`);
    blocks.push({ kind: head[1] as Block["kind"], name: head[2] ?? "", doc, lines: body });
    i = k;
  }
  return blocks;
}

/** Spec §5.8: table name → layer that creates it. */
function rolloutLayers(spec: string): Map<string, number> {
  const start = spec.indexOf("### 5.8 Migration rollout by layer");
  const end = spec.indexOf("ⁱ Beyond the literal", start);
  if (start < 0 || end < 0) throw new Error("spec §5.8 rollout table not found");
  const layers = new Map<string, number>();
  for (const match of spec.slice(start, end).matchAll(/^\| (\d+) \| (.+?) \|$/gm)) {
    const cells = (match[2] ?? "").replace(/\(\+[^)]*\)/g, "").replace(/[ⁱ]+/g, "");
    for (const name of cells.split(",").map((c) => c.trim().split(/\s/)[0] ?? "")) {
      if (name) layers.set(name, Number(match[1]));
    }
  }
  return layers;
}

/** The type a field line refers to, without `?` or `[]`; undefined for non-field lines. */
function fieldType(line: string): { name: string; type: string } | undefined {
  const match = /^ {2}(\w+)\s+(\w+)(\?|\[\])?(\s|$)/.exec(line);
  return match ? { name: match[1] ?? "", type: match[2] ?? "" } : undefined;
}

export function promote(design: string, spec: string, throughLayer: number): string {
  const blocks = parseBlocks(design);
  const layers = rolloutLayers(spec);
  const models = new Set(blocks.filter((b) => b.kind === "model").map((b) => b.name));
  const enums = new Map(blocks.filter((b) => b.kind === "enum").map((b) => [b.name, b]));

  for (const model of models) {
    if (!layers.has(model)) throw new Error(`model ${model} is not placed in spec §5.8`);
  }
  const promoted = new Set([...models].filter((m) => (layers.get(m) ?? 99) <= throughLayer));

  const out: Block[] = [];
  const usedEnums = new Set<string>();
  const fkColumnsOf = (line: string): string[] =>
    (/fields: \[([^\]]*)\]/.exec(line)?.[1] ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c !== "");
  for (const block of blocks) {
    if (block.kind !== "model" || !promoted.has(block.name)) continue;
    const isLater = (line: string) => {
      const field = fieldType(line);
      return field !== undefined && models.has(field.type) && !promoted.has(field.type);
    };
    // A relation to a later layer is dropped, and so are its FK columns unless a
    // kept relation also uses them (spec §5.8: forward references arrive with the
    // later table, which adds the column and its FK together).
    const keptRelationColumns = new Set(block.lines.filter((l) => !isLater(l)).flatMap(fkColumnsOf));
    const droppedColumns = new Set(
      block.lines
        .filter(isLater)
        .flatMap(fkColumnsOf)
        .filter((c) => !keptRelationColumns.has(c)),
    );
    const kept: string[] = [];
    for (const line of block.lines) {
      const field = fieldType(line);
      if (isLater(line) || (field !== undefined && droppedColumns.has(field.name))) {
        // A `///` comment documents the field below it; it goes with the field.
        while ((kept.at(-1) ?? "").trim().startsWith("///")) kept.pop();
        continue;
      }
      if (/^\s*@@/.test(line)) {
        const used =
          /\[([^\]]*)\]/
            .exec(line)?.[1]
            ?.split(",")
            .map((c) => c.trim()) ?? [];
        const stale = used.filter((c) => droppedColumns.has(c));
        if (stale.length > 0)
          throw new Error(
            `${block.name}: ${line.trim()} uses columns of a later layer (${stale.join(", ")})`,
          );
      }
      if (field && enums.has(field.type)) usedEnums.add(field.type);
      kept.push(line);
    }
    // Drop a back-relation comment header that no longer has fields under it.
    const cleaned = kept.filter((line, i) => {
      if (!line.trim().startsWith("// ---")) return true;
      const next = kept.slice(i + 1).find((l) => l.trim() !== "");
      return next !== undefined && fieldType(next) !== undefined;
    });
    // Remove blank lines left doubled or trailing by the drops.
    const compact = cleaned.filter(
      (line, i) => !(line.trim() === "" && (cleaned[i + 1] ?? "").trim() === ""),
    );
    while (compact.length > 0 && (compact[compact.length - 1] ?? "").trim() === "") compact.pop();
    out.push({ ...block, lines: compact });
  }

  const header = [
    "// =============================================================================",
    "// GENERATED FILE. Do not edit. Source: docs/technical-spec/schema.prisma.",
    `// Contains the tables of layers 1..${throughLayer} (spec §5.8), copied verbatim.`,
    "// Regenerate: pnpm --filter @aestara/database schema:promote",
    "// =============================================================================",
    "",
    "generator client {",
    '  provider = "prisma-client"',
    '  output   = "../generated/prisma"',
    "}",
    "",
    "datasource db {",
    '  provider = "postgresql"',
    "}",
    "",
  ];
  const render = (b: Block) => [...b.doc, `${b.kind} ${b.name} {`, ...b.lines, "}", ""];
  const enumBlocks = blocks.filter((b) => b.kind === "enum" && usedEnums.has(b.name));
  return [...header, ...enumBlocks.flatMap(render), ...out.flatMap(render)].join("\n");
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const rendered = promote(
    readFileSync(designPath, "utf8"),
    readFileSync(specPath, "utf8"),
    PROMOTED_THROUGH_LAYER,
  );
  if (process.argv.includes("--check")) {
    const current = readFileSync(outPath, "utf8");
    if (current !== rendered) {
      console.error("prisma/schema.prisma is out of date with the design schema. Run: pnpm schema:promote");
      process.exit(1);
    }
    console.log("prisma/schema.prisma matches the design schema");
  } else {
    writeFileSync(outPath, rendered);
    console.log(`wrote ${outPath}`);
  }
}
