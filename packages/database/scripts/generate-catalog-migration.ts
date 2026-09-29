// Renders the Layer 1 catalog migration (permissions, system roles, default
// matrix) from src/catalog.ts. `--check` fails if the committed migration differs.
//
// Usage: node scripts/generate-catalog-migration.ts [--check]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogId, PERMISSIONS, ROLE_PERMISSIONS, ROLES } from "../src/catalog.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "prisma/migrations/20260929000300_layer1_catalog");
const outPath = join(outDir, "migration.sql");

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function renderCatalogMigration(): string {
  const permissionRows = PERMISSIONS.map(
    (p) => `  (${quote(catalogId("permission", p.key))}, ${quote(p.key)}, ${quote(p.description)})`,
  );
  const roleRows = ROLES.map(
    (r) =>
      `  (${quote(catalogId("role", r.key))}, NULL, ${quote(r.key)}, ${quote(r.name)}, ${quote(r.description)}, now())`,
  );
  const grantRows = ROLES.flatMap((r) =>
    ROLE_PERMISSIONS[r.key].map(
      (key) =>
        `  (${quote(catalogId("role", r.key))}, ${quote(catalogId("permission", key))}) -- ${r.key} ${key}`,
    ),
  );
  const grantCount = grantRows.length;
  return [
    "-- Layer 1 catalog data (spec §4.3–§4.5; ADR-0018 K-01): the permission catalog,",
    "-- the system roles and the default role matrix. GENERATED from",
    "-- packages/database/src/catalog.ts by scripts/generate-catalog-migration.ts.",
    "-- Identifiers are fixed so every environment refers to the same rows.",
    "",
    'INSERT INTO "Permission" (id, key, description) VALUES',
    `${permissionRows.join(",\n")};`,
    "",
    'INSERT INTO "Role" (id, "organizationId", key, name, description, "updatedAt") VALUES',
    `${roleRows.join(",\n")};`,
    "",
    'INSERT INTO "RolePermission" ("roleId", "permissionId") VALUES',
    // The trailing comments name each pair; the last row's comma goes before its comment.
    `${grantRows.map((row, i) => (i < grantCount - 1 ? row.replace(") --", "), --") : row.replace(") --", "); --"))).join("\n")}`,
    "",
    "DO $$",
    "BEGIN",
    `  IF (SELECT count(*) FROM "Permission") <> ${PERMISSIONS.length}`,
    `     OR (SELECT count(*) FROM "Role" WHERE "organizationId" IS NULL) <> ${ROLES.length}`,
    `     OR (SELECT count(*) FROM "RolePermission") <> ${grantCount} THEN`,
    "    RAISE EXCEPTION 'catalog seed incomplete';",
    "  END IF;",
    "END $$;",
    "",
  ].join("\n");
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const rendered = renderCatalogMigration();
  if (process.argv.includes("--check")) {
    if (readFileSync(outPath, "utf8") !== rendered) {
      console.error("The catalog migration differs from src/catalog.ts. Run: pnpm catalog:generate");
      process.exit(1);
    }
    console.log("catalog migration matches src/catalog.ts");
  } else {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outPath, rendered);
    console.log(`wrote ${outPath}`);
  }
}
