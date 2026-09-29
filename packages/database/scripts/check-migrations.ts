// Proves every layer's constraint migration carries exactly that layer's
// fragment of docs/technical-spec/constraints.sql (spec §5.8), so the design
// and the database never disagree. Static; needs no database.
//
// Usage: node scripts/check-migrations.ts
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PROMOTED_THROUGH_LAYER } from "./promote-schema.ts";

const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, "..", "prisma/migrations");
const constraints = readFileSync(join(here, "../../../docs/technical-spec/constraints.sql"), "utf8");
const BAR = "-- #############################################################################\n";

function fragment(layer: number): string {
  const start = constraints.indexOf(`${BAR}-- LAYER ${layer} `);
  if (start < 0) throw new Error(`constraints.sql has no LAYER ${layer} fragment`);
  const next = constraints.indexOf(`${BAR}-- LAYER ${layer + 1} `, start);
  return `${constraints.slice(start, next < 0 ? undefined : next).trimEnd()}\n`;
}

let failed = false;
for (let layer = 1; layer <= PROMOTED_THROUGH_LAYER; layer++) {
  const dirs = readdirSync(migrations).filter((d) => d.endsWith(`_layer${layer}_constraints`));
  if (dirs.length !== 1) {
    console.error(`FAIL  expected one *_layer${layer}_constraints migration, found ${dirs.length}`);
    failed = true;
    continue;
  }
  const sql = readFileSync(join(migrations, dirs[0] as string, "migration.sql"), "utf8");
  const body = sql.slice(sql.indexOf(BAR));
  if (body !== fragment(layer)) {
    console.error(`FAIL  ${dirs[0]} differs from the LAYER ${layer} fragment of constraints.sql`);
    failed = true;
  } else {
    console.log(`PASS  ${dirs[0]} equals the LAYER ${layer} fragment of constraints.sql`);
  }
}
process.exit(failed ? 1 : 0);
