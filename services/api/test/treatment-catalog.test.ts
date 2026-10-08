// Treatment catalog (Bible §11.1, §17.1; spec §6.3 "Treatment plans &
// estimates"; ADR-0028 K4-03, K4-22; ADR-0029): organization-wide categories
// and treatments, changed only through an organization-wide grant, retired
// and never deleted, audited without values.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseAvailable, startApi, type TestApi } from "./support/app.ts";
import { bearer, Fixtures, type StaffMember } from "./support/fixtures.ts";

describe.runIf(databaseAvailable())("treatment catalog (Layer 4)", () => {
  let api: TestApi;
  let fx: Fixtures;
  let org: string;
  let admin: StaffMember;
  let surgeon: StaffMember;
  let practiceAdmin: StaffMember;
  let frontDesk: StaffMember;

  const call = (
    who: StaffMember,
    method: string,
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) =>
    api.request({
      method: method as "GET",
      url: `/api/v1${url}`,
      headers: { ...bearer(who), ...headers },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
  const v = (version: number) => ({ "if-match": `"v${version}"` });

  async function category(name: string, parentId?: string) {
    const res = await call(admin, "POST", "/treatment-categories", {
      name,
      ...(parentId ? { parentId } : {}),
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data as { id: string; version: number; status: string };
  }

  async function treatment(categoryId: string, body: Record<string, unknown> = {}) {
    const res = await call(admin, "POST", "/treatments", { categoryId, name: "Lip filler", ...body });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data as { id: string; version: number; status: string };
  }

  const audits = async (resourceId: string) =>
    (
      await api.db.query<{ action: string; metadata: Record<string, string> }>(
        `SELECT action, metadata FROM "AuditEvent" WHERE "resourceId" = $1 ORDER BY "occurredAt", id`,
        [resourceId],
      )
    ).rows;

  beforeAll(async () => {
    api = await startApi();
    fx = new Fixtures(api);
    org = await fx.organization();
    const practice = await fx.practice(org);
    admin = await fx.staff(org, "ORGANIZATION_ADMIN");
    surgeon = await fx.staff(org, "SURGEON_PHYSICIAN");
    practiceAdmin = await fx.staff(org, "PRACTICE_ADMIN", { practiceId: practice });
    frontDesk = await fx.staff(org, "FRONT_DESK");
  });
  afterAll(async () => api?.close());

  it("builds a category tree with priced treatments; nothing is seeded", async () => {
    const before = await call(admin, "GET", "/treatment-categories");
    expect(before.json().data).toEqual([]);

    const injectables = await category("Injectables");
    const fillers = await category("Fillers", injectables.id);
    const lip = await treatment(fillers.id, {
      code: "LIP-1",
      unitLabel: "syringe",
      description: "Hyaluronic acid filler for the lips.",
      defaultUnitPrice: { amount: "450.00", currency: "USD" },
    });

    const listed = await call(surgeon, "GET", `/treatments?categoryId=${fillers.id}`);
    expect(listed.statusCode, listed.body).toBe(200);
    expect(listed.json().data).toEqual([
      expect.objectContaining({
        id: lip.id,
        categoryId: fillers.id,
        name: "Lip filler",
        code: "LIP-1",
        unitLabel: "syringe",
        defaultUnitPrice: { amount: "450.00", currency: "USD" },
        status: "ACTIVE",
        version: 1,
      }),
    ]);
    expect(listed.json().data[0]).not.toHaveProperty("simulationCategory");
    const categories = (await call(surgeon, "GET", "/treatment-categories")).json().data;
    expect(categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: injectables.id, sortOrder: 0 }),
        expect.objectContaining({ id: fillers.id, parentId: injectables.id }),
      ]),
    );
    expect(categories.find((c: { id: string }) => c.id === injectables.id)).not.toHaveProperty("parentId");

    // CONFIGURATION_CHANGED names the change and the fields, never their values.
    const rows = await audits(lip.id);
    expect(rows).toEqual([
      {
        action: "CONFIGURATION_CHANGED",
        metadata: {
          change: "CREATED",
          fields: "categoryId,code,defaultUnitPrice,description,name,unitLabel",
        },
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("450");
    expect(JSON.stringify(rows)).not.toContain("Lip filler");
  });

  it("is read by clinicians and administrators, and changed only through an organization-wide grant", async () => {
    const c = await category("Lasers");
    expect((await call(surgeon, "GET", "/treatment-categories")).statusCode).toBe(200);
    expect((await call(practiceAdmin, "GET", "/treatments")).statusCode).toBe(200);
    expect((await call(frontDesk, "GET", "/treatments")).statusCode).toBe(403);

    for (const who of [surgeon, practiceAdmin]) {
      const res = await call(who, "POST", "/treatments", { categoryId: c.id, name: "Resurfacing" });
      expect(res.statusCode, res.body).toBe(403);
      expect(res.json().error.code).toBe("PERMISSION_DENIED");
    }
    const patch = await call(
      practiceAdmin,
      "PATCH",
      `/treatment-categories/${c.id}`,
      { name: "Light" },
      v(1),
    );
    expect(patch.statusCode).toBe(403);
  });

  it("keeps codes unique, prices non-negative and categories out of their own subtree", async () => {
    const root = await category("Skin");
    const child = await category("Peels", root.id);
    await treatment(child.id, { code: "PEEL-1", name: "Light peel" });

    const duplicate = await call(admin, "POST", "/treatments", {
      categoryId: child.id,
      name: "Other",
      code: "PEEL-1",
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("CONFLICT");

    const negative = await call(admin, "POST", "/treatments", {
      categoryId: child.id,
      name: "Free",
      defaultUnitPrice: { amount: "-1.00", currency: "USD" },
    });
    expect(negative.statusCode).toBe(400);
    const float = await call(admin, "POST", "/treatments", {
      categoryId: child.id,
      name: "Float",
      defaultUnitPrice: { amount: 12.5, currency: "USD" },
    });
    expect(float.statusCode).toBe(400);

    const cycle = await call(
      admin,
      "PATCH",
      `/treatment-categories/${root.id}`,
      { parentId: child.id },
      v(1),
    );
    expect(cycle.statusCode, cycle.body).toBe(400);
    expect(cycle.json().error.details.fieldErrors[0].code).toBe("CATEGORY_CYCLE");
    const self = await call(admin, "PATCH", `/treatment-categories/${root.id}`, { parentId: root.id }, v(1));
    expect(self.json().error.details.fieldErrors[0].code).toBe("CATEGORY_CYCLE");

    const unknown = await call(admin, "POST", "/treatments", { categoryId: crypto.randomUUID(), name: "X" });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.details.fieldErrors[0].code).toBe("UNKNOWN_CATEGORY");
  });

  it("retires instead of deleting, and leaves nothing active under a retired category", async () => {
    const c = await category("Body");
    const t = await treatment(c.id, {
      name: "Contouring",
      defaultUnitPrice: { amount: "1200.00", currency: "USD" },
    });

    const blocked = await call(admin, "PATCH", `/treatment-categories/${c.id}`, { status: "INACTIVE" }, v(1));
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.details).toMatchObject({ activeTreatments: 1, activeSubcategories: 0 });

    const retired = await call(admin, "PATCH", `/treatments/${t.id}`, { status: "INACTIVE" }, v(1));
    expect(retired.statusCode, retired.body).toBe(200);
    expect(retired.json().data).toMatchObject({ status: "INACTIVE", version: 2 });
    const closed = await call(admin, "PATCH", `/treatment-categories/${c.id}`, { status: "INACTIVE" }, v(1));
    expect(closed.statusCode, closed.body).toBe(200);

    const inRetired = await call(admin, "POST", "/treatments", { categoryId: c.id, name: "New" });
    expect(inRetired.json().error.details.fieldErrors[0].code).toBe("CATEGORY_INACTIVE");
    const reactivate = await call(admin, "PATCH", `/treatments/${t.id}`, { status: "ACTIVE" }, v(2));
    expect(reactivate.json().error.details.fieldErrors[0].code).toBe("CATEGORY_INACTIVE");

    expect(
      (await call(admin, "PATCH", `/treatment-categories/${c.id}`, { status: "ACTIVE" }, v(2))).statusCode,
    ).toBe(200);
    const back = await call(
      admin,
      "PATCH",
      `/treatments/${t.id}`,
      { status: "ACTIVE", defaultUnitPrice: null },
      v(2),
    );
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json().data).not.toHaveProperty("defaultUnitPrice");

    expect((await audits(t.id)).map((r) => r.metadata.change)).toEqual(["CREATED", "RETIRED", "REACTIVATED"]);
    const rows = await api.db.query(`SELECT 1 FROM "Treatment" WHERE id = $1`, [t.id]);
    expect(rows.rowCount).toBe(1);
    await expect(api.db.query(`DELETE FROM "Treatment" WHERE id = $1`, [t.id])).rejects.toThrow(
      /IMMUTABLE_RECORD/,
    );
  });

  it("needs the current version to change an entry", async () => {
    const c = await category("Hair");
    const missing = await call(admin, "PATCH", `/treatment-categories/${c.id}`, { name: "Hair removal" });
    expect(missing.statusCode).toBe(428);
    const ok = await call(admin, "PATCH", `/treatment-categories/${c.id}`, { name: "Hair removal" }, v(1));
    expect(ok.statusCode).toBe(200);
    expect(ok.headers.etag).toBe('"v2"');
    const stale = await call(admin, "PATCH", `/treatment-categories/${c.id}`, { sortOrder: 3 }, v(1));
    expect(stale.statusCode).toBe(412);
    expect(stale.json().error.details).toEqual({ currentVersion: 2 });
  });
});
