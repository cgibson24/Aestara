import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  catalogId,
  isPlatformUngrantable,
  PERMISSIONS,
  type PermissionKey,
  ROLE_PERMISSIONS,
  ROLES,
  type RoleKey,
} from "../src/catalog.ts";

const spec = readFileSync(join(import.meta.dirname, "../../../docs/TECHNICAL_SPECIFICATION.md"), "utf8");

function section(start: string, end: string): string {
  const from = spec.indexOf(start);
  const to = spec.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`spec section ${start} not found`);
  return spec.slice(from, to);
}

const bibleTable = section("**Bible permissions [B §3.3]", "**Gaps [UD-16]:**");
const matrixTable = section("### 4.5 Proposed default role → permission matrix", "¹ MARKETING");
const proposedDefaults = section("**Defaults for the proposed keys", "**Separation-of-duties rules");

const bibleKeys = [...bibleTable.matchAll(/`([a-z.]+)`/g)].map((m) => m[1]);
const proposedKeys = [...proposedDefaults.matchAll(/`([a-z.]+)`/g)].map((m) => m[1]);
const columns = ROLES.filter((r) => r.column !== null).map((r) => r.column as string);

/** Spec §4.5 table: permission → set of role columns granted (● or ○). */
function specMatrix(): Map<string, Set<string>> {
  const grants = new Map<string, Set<string>>();
  for (const line of matrixTable.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    const key = cells[1];
    if (!key || !/^[a-z]+(\.[a-z]+)+$/.test(key)) continue;
    const roles = new Set<string>();
    cells.slice(2, 2 + columns.length).forEach((cell, i) => {
      if (/^[●○]/.test(cell)) roles.add(columns[i] as string);
    });
    grants.set(key, roles);
  }
  // Proposed keys: "`key` SA OA PA(○) · …"
  for (const entry of proposedDefaults.split("·")) {
    const key = /`([a-z.]+)`/.exec(entry)?.[1];
    if (!key) continue;
    const roles = new Set(entry.match(new RegExp(`\\b(${columns.join("|")})\\b`, "g")) ?? []);
    grants.set(key, roles);
  }
  return grants;
}

describe("permission catalog (spec §4.4)", () => {
  it("contains the 41 Bible keys exactly", () => {
    expect(bibleKeys).toHaveLength(41);
    expect(PERMISSIONS.filter((p) => p.source === "bible").map((p) => p.key)).toEqual(bibleKeys);
  });

  it("contains the 12 proposed keys confirmed in ADR-0018", () => {
    expect(proposedKeys).toHaveLength(12);
    expect(PERMISSIONS.filter((p) => p.source === "proposed").map((p) => p.key)).toEqual(proposedKeys);
  });

  it("has unique keys and a description for each", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of PERMISSIONS) expect(p.description.length).toBeGreaterThan(5);
  });
});

describe("system roles (spec §4.3)", () => {
  it("are the ten Bible roles", () => {
    expect(ROLES.map((r) => r.key)).toEqual([
      "SUPER_ADMIN",
      "ORGANIZATION_ADMIN",
      "PRACTICE_ADMIN",
      "SURGEON_PHYSICIAN",
      "NURSE_INJECTOR_AESTHETICIAN",
      "PHOTOGRAPHER",
      "CONSULTANT",
      "FRONT_DESK",
      "MARKETING",
      "PATIENT",
    ]);
  });
});

describe("default matrix (spec §4.5)", () => {
  const grants = specMatrix();

  it("covers every catalog key", () => {
    expect([...grants.keys()].sort()).toEqual(PERMISSIONS.map((p) => p.key).sort());
  });

  for (const role of ROLES) {
    it(`${role.key} holds exactly the spec grants`, () => {
      const expected = [...grants.entries()]
        .filter(([, roles]) => role.column !== null && roles.has(role.column))
        .map(([key]) => key)
        .sort();
      expect([...ROLE_PERMISSIONS[role.key as RoleKey]].sort()).toEqual(expected);
    });
  }

  it("never lists a permission twice for a role", () => {
    for (const role of ROLES) {
      const keys = ROLE_PERMISSIONS[role.key as RoleKey];
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("gives SUPER_ADMIN nothing a platform actor may not hold (ADR-0018 K-06)", () => {
    expect(ROLE_PERMISSIONS.SUPER_ADMIN.filter(isPlatformUngrantable)).toEqual([]);
  });

  it("lets the platform bootstrap an ORGANIZATION_ADMIN (ADR-0018 K-05)", () => {
    expect(ROLE_PERMISSIONS.ORGANIZATION_ADMIN.filter(isPlatformUngrantable)).toEqual([]);
    expect(ROLE_PERMISSIONS.ORGANIZATION_ADMIN).toContain("consent.template.manage" satisfies PermissionKey);
  });
});

describe("catalog identifiers", () => {
  it("are stable UUIDv7 values, unique across the catalog", () => {
    const ids = [
      ...PERMISSIONS.map((p) => catalogId("permission", p.key)),
      ...ROLES.map((r) => catalogId("role", r.key)),
    ];
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Set(ids).size).toBe(ids.length);
    expect(catalogId("role", "SUPER_ADMIN")).toBe(catalogId("role", "SUPER_ADMIN"));
  });
});
