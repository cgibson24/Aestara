import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TABLE_OWNERSHIP, TENANT_CLASSES } from "../src/ownership.ts";

const schema = readFileSync(join(import.meta.dirname, "../prisma/schema.prisma"), "utf8");
const models = new Map(
  [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => [m[1] as string, m[2] as string]),
);
const hasColumn = (model: string, column: string, required?: boolean) => {
  const match = new RegExp(`^\\s+${column}\\s+(\\w+)(\\?)?`, "m").exec(models.get(model) ?? "");
  return match !== null && (required === undefined || required === (match[2] === undefined));
};

describe("ownership classification (ADR-0018 K-08)", () => {
  it("classifies every model in prisma/schema.prisma exactly once", () => {
    const classified = TABLE_OWNERSHIP.map((t) => t.table);
    expect(new Set(classified).size).toBe(classified.length);
    expect([...classified].sort()).toEqual([...models.keys()].sort());
  });

  for (const entry of TABLE_OWNERSHIP) {
    it(`${entry.table} (${entry.class}) has the columns its class needs`, () => {
      if (entry.class === "tenant-root") expect(entry.table).toBe("Organization");
      if (["organization", "practice"].includes(entry.class)) {
        expect(hasColumn(entry.table, "organizationId", true)).toBe(true);
      }
      // UserRole's organizationId is NULL only for PLATFORM-scope grants (spec §4.3).
      if (entry.class === "user-management") expect(hasColumn(entry.table, "organizationId")).toBe(true);
      if (entry.class === "system") expect(hasColumn(entry.table, "organizationId", false)).toBe(true);
      if (entry.class === "practice") {
        expect(entry.practiceColumn).toBeDefined();
        expect(hasColumn(entry.table, entry.practiceColumn as string, true)).toBe(true);
      } else {
        expect(entry.practiceColumn).toBeUndefined();
      }
      if (entry.locationColumn) expect(hasColumn(entry.table, entry.locationColumn, true)).toBe(true);
    });
  }

  it("keeps the platform role away from patient data (ADR-0018 K-06)", () => {
    for (const table of ["Patient", "PatientContact"]) {
      expect(TABLE_OWNERSHIP.find((t) => t.table === table)?.platform).toBe("none");
    }
    for (const entry of TABLE_OWNERSHIP.filter((t) => t.class === "organization")) {
      expect(entry.platform).toBe("none");
    }
  });

  it("treats only identity and catalog tables as platform-level", () => {
    const platformLevel = TABLE_OWNERSHIP.filter((t) => !TENANT_CLASSES.includes(t.class)).map(
      (t) => t.class,
    );
    expect(new Set(platformLevel)).toEqual(new Set(["identity", "catalog"]));
  });
});
