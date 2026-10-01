// Patients over HTTP (roadmap M1.8; spec §6.3, §6.6.1, §5.4.10; ADR-0020,
// ADR-0021): duplicate check, idempotent create, search keys, profile audit,
// optimistic concurrency, archive and contacts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { nameKey } from "../src/patients/search-keys.ts";
import { databaseAvailable, startApi, type TestApi } from "./support/app.ts";
import { bearer, Fixtures, type StaffMember } from "./support/fixtures.ts";

describe.runIf(databaseAvailable())("patients", () => {
  let api: TestApi;
  let fx: Fixtures;
  let org: string;
  let practice: string;
  let provider: StaffMember;
  let frontDesk: StaffMember;

  beforeAll(async () => {
    api = await startApi();
    fx = new Fixtures(api);
    org = await fx.organization();
    practice = await fx.practice(org);
    provider = await fx.staff(org, "SURGEON_PHYSICIAN");
    frontDesk = await fx.staff(org, "FRONT_DESK");
  });
  afterAll(async () => api?.close());

  const create = (who: StaffMember, payload: Record<string, unknown>, key: string = crypto.randomUUID()) =>
    api.request({
      method: "POST",
      url: "/api/v1/patients",
      headers: { ...bearer(who), "idempotency-key": key },
      payload,
    });
  const search = (who: StaffMember, payload: Record<string, unknown>) =>
    api.request({ method: "POST", url: "/api/v1/patients/search", headers: bearer(who), payload });

  it("creates a patient with the tenant from the token, ETag v1 and an audit event", async () => {
    const res = await create(frontDesk, {
      firstName: "Ana",
      lastName: "Reyes",
      preferredName: "Ana",
      dateOfBirth: "1988-04-12",
      email: "Ana.Reyes@Example.test",
      phone: "+15555550123",
      primaryPracticeId: practice,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.headers.etag).toBe('"v1"');
    const p = res.json().data;
    expect(p).toMatchObject({
      status: "ACTIVE",
      firstName: "Ana",
      email: "ana.reyes@example.test",
      version: 1,
    });
    expect(p).not.toHaveProperty("organizationId");
    expect(p).not.toHaveProperty("middleName");
    const row = await api.db.query(
      `SELECT "organizationId", "lastNameKey", "phoneKey" FROM "Patient" WHERE id = $1`,
      [p.id],
    );
    expect(row.rows[0]).toEqual({ organizationId: org, lastNameKey: "reyes", phoneKey: "15555550123" });
    const audit = await api.db.query(`SELECT action, "patientId" FROM "AuditEvent" WHERE "resourceId" = $1`, [
      p.id,
    ]);
    expect(audit.rows).toEqual([{ action: "PATIENT_CREATED", patientId: p.id }]);
  });

  it("refuses organizationId in the body", async () => {
    const res = await create(frontDesk, {
      firstName: "X",
      lastName: "Y",
      dateOfBirth: "1990-01-01",
      organizationId: org,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.details.fieldErrors[0]).toMatchObject({
      path: "organizationId",
      code: "UNKNOWN_FIELD",
    });
  });

  it("replays a retried create and refuses the key with a different body", async () => {
    const key = crypto.randomUUID();
    const body = { firstName: "Ivo", lastName: "Idempotent", dateOfBirth: "1975-05-05" };
    const first = await create(frontDesk, body, key);
    const second = await create(frontDesk, body, key);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().data.id).toBe(first.json().data.id);
    const count = await api.db.query(
      `SELECT count(*)::int AS n FROM "Patient" WHERE "lastName" = 'Idempotent'`,
    );
    expect(count.rows[0].n).toBe(1);
    const reused = await create(frontDesk, { ...body, firstName: "Other" }, key);
    expect(reused.statusCode).toBe(409);
    expect(reused.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("flags probable duplicates with opaque IDs and reasons until confirmed", async () => {
    await fx.patient(org, {
      firstName: "Maria",
      lastName: "Gonzalez",
      dateOfBirth: "1970-03-03",
      email: "mg@example.test",
    });
    const check = await api.request({
      method: "POST",
      url: "/api/v1/patients/duplicate-check",
      headers: bearer(frontDesk),
      payload: { firstName: "María", lastName: "Gonzales", dateOfBirth: "1970-03-03" },
    });
    expect(check.statusCode).toBe(200);
    expect(check.json().data.candidates[0]).toMatchObject({
      matchReasons: ["SAME_DATE_OF_BIRTH_SIMILAR_NAME"],
    });
    expect(check.json().data.candidates[0].summary.lastName).toBe("Gonzalez");

    const body = {
      firstName: "Maria",
      lastName: "Gonzalez",
      dateOfBirth: "1970-03-03",
      email: "MG@example.test",
    };
    const refused = await create(frontDesk, body);
    expect(refused.statusCode).toBe(409);
    const error = refused.json().error;
    expect(error.code).toBe("DUPLICATE_PATIENT_SUSPECTED");
    expect(error.details.candidates[0].matchReasons).toEqual([
      "SAME_EMAIL",
      "SAME_DATE_OF_BIRTH_SIMILAR_NAME",
    ]);
    expect(JSON.stringify(error)).not.toContain("Gonzalez");
    const confirmed = await create(frontDesk, { ...body, confirmNoDuplicate: true });
    expect(confirmed.statusCode).toBe(201);
  });

  it("keeps MRNs unique per organization", async () => {
    expect(
      (
        await create(frontDesk, {
          firstName: "M",
          lastName: "One",
          dateOfBirth: "1960-01-01",
          mrn: "A-000142",
        })
      ).statusCode,
    ).toBe(201);
    const dup = await create(frontDesk, {
      firstName: "N",
      lastName: "Two",
      dateOfBirth: "1961-01-01",
      mrn: "A-000142",
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe("CONFLICT");
    const other = await fx.organization();
    expect((await fx.patient(other, { mrn: "A-000142" })).length).toBe(36);
  });

  it("searches name prefixes and exact identifiers through the leakproof keys", async () => {
    await fx.patient(org, {
      firstName: "Zoë",
      lastName: "Ørsted-Lund",
      dateOfBirth: "1999-09-09",
      phone: "+1 (555) 555-0199",
    });
    await fx.patient(org, { firstName: "Zachary", lastName: "Orr", dateOfBirth: "1980-01-01" });
    const ids = async (payload: Record<string, unknown>) =>
      (await search(frontDesk, payload)).json().data.map((p: { lastName: string }) => p.lastName);
    expect(await ids({ name: "orst" })).toEqual(["Ørsted-Lund"]);
    expect(await ids({ name: "or" })).toEqual(expect.arrayContaining(["Ørsted-Lund", "Orr"]));
    expect(await ids({ name: "zoe orst" })).toEqual(["Ørsted-Lund"]);
    expect(await ids({ name: "orst zo" })).toEqual(["Ørsted-Lund"]);
    expect(await ids({ dateOfBirth: "1999-09-09" })).toEqual(["Ørsted-Lund"]);
    expect(await ids({ phone: "555-555-0199" })).toEqual([]);
    expect(await ids({ phone: "15555550199" })).toEqual(["Ørsted-Lund"]);
    expect(await ids({ name: "zach", dateOfBirth: "1999-09-09" })).toEqual([]);
    const empty = await search(frontDesk, {});
    expect(empty.statusCode).toBe(400);
  });

  it("matches the database's key normalization", async () => {
    for (const name of ["Ørsted-Lund", "Zoë", "O'Brien", "Straße", "Đặng", "Łukasz", "José María", "Ægir"]) {
      const db = await api.db.query<{ key: string | null }>(`SELECT app_name_search_key($1) AS key`, [name]);
      expect(nameKey(name), name).toBe(db.rows[0]?.key ?? "");
    }
  });

  it("pages search results with a signed cursor", async () => {
    for (let i = 0; i < 5; i++)
      await fx.patient(org, { firstName: `Pat${i}`, lastName: `Pagewise${i}`, dateOfBirth: "2000-01-01" });
    const first = await search(frontDesk, { name: "pagewise", limit: 2 });
    expect(first.json().page.hasMore).toBe(true);
    const second = await search(frontDesk, {
      name: "pagewise",
      limit: 2,
      cursor: first.json().page.nextCursor,
    });
    const third = await search(frontDesk, {
      name: "pagewise",
      limit: 2,
      cursor: second.json().page.nextCursor,
    });
    const all = [first, second, third].flatMap((r) =>
      r.json().data.map((p: { lastName: string }) => p.lastName),
    );
    expect(all).toEqual(["Pagewise0", "Pagewise1", "Pagewise2", "Pagewise3", "Pagewise4"]);
    expect(third.json().page).toEqual({ hasMore: false });
    const tampered = await search(frontDesk, {
      name: "pagewise",
      cursor: `${first.json().page.nextCursor}x`,
    });
    expect(tampered.statusCode).toBe(400);
  });

  it("opens the profile with PATIENT_VIEWED and tab readability by permission", async () => {
    const id = await fx.patient(org, { lastName: "Viewed" });
    const res = await api.request({
      method: "GET",
      url: `/api/v1/patients/${id}`,
      headers: bearer(frontDesk),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers.etag).toBe('"v1"');
    const tabs = Object.fromEntries(
      res.json().data.tabs.map((t: { key: string; readable: boolean }) => [t.key, t.readable]),
    );
    expect(Object.keys(tabs)).toHaveLength(12);
    expect(tabs).toMatchObject({
      OVERVIEW: true,
      APPOINTMENTS: true,
      PHOTOS: false,
      SIMULATIONS: false,
      CONSULTATIONS: false,
    });
    const asProvider = await api.request({
      method: "GET",
      url: `/api/v1/patients/${id}`,
      headers: bearer(provider),
    });
    expect(asProvider.json().data.tabs.find((t: { key: string }) => t.key === "PHOTOS").readable).toBe(true);
    const viewed = await api.db.query(
      `SELECT count(*)::int AS n FROM "AuditEvent" WHERE action = 'PATIENT_VIEWED' AND "patientId" = $1`,
      [id],
    );
    expect(viewed.rows[0].n).toBe(2);
  });

  it("updates with If-Match, refuses stale versions and never sets ARCHIVED", async () => {
    const id = await fx.patient(org, { lastName: "Versioned" });
    const patch = (ifMatch: string | undefined, payload: Record<string, unknown>) =>
      api.request({
        method: "PATCH",
        url: `/api/v1/patients/${id}`,
        headers: { ...bearer(frontDesk), ...(ifMatch ? { "if-match": ifMatch } : {}) },
        payload,
      });
    expect((await patch(undefined, { preferredName: "V" })).statusCode).toBe(428);
    const ok = await patch('"v1"', { preferredName: "V", status: "INACTIVE" });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.headers.etag).toBe('"v2"');
    const stale = await patch('"v1"', { preferredName: "W" });
    expect(stale.statusCode).toBe(412);
    expect(stale.json().error).toMatchObject({ code: "VERSION_CONFLICT", details: { currentVersion: 2 } });
    expect((await patch('"v2"', { status: "ARCHIVED" })).statusCode).toBe(400);
    const cleared = await patch('"v2"', { preferredName: null });
    expect(cleared.json().data).not.toHaveProperty("preferredName");
  });

  it("archives with patient.archive only, then refuses a second archive", async () => {
    const id = await fx.patient(org, { lastName: "Archivable" });
    const denied = await api.request({
      method: "POST",
      url: `/api/v1/patients/${id}/archive`,
      headers: { ...bearer(frontDesk), "if-match": '"v1"' },
    });
    expect(denied.statusCode).toBe(403);
    const ok = await api.request({
      method: "POST",
      url: `/api/v1/patients/${id}/archive`,
      headers: { ...bearer(provider), "if-match": '"v1"' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data).toMatchObject({ status: "ARCHIVED", version: 2 });
    const again = await api.request({
      method: "POST",
      url: `/api/v1/patients/${id}/archive`,
      headers: { ...bearer(provider), "if-match": '"v2"' },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("INVALID_STATE_TRANSITION");
    const found = await search(frontDesk, { name: "archivable" });
    expect(found.json().data).toHaveLength(0);
    const withArchived = await search(frontDesk, { name: "archivable", includeArchived: true });
    expect(withArchived.json().data).toHaveLength(1);
    const unarchive = await api.request({
      method: "PATCH",
      url: `/api/v1/patients/${id}`,
      headers: { ...bearer(provider), "if-match": '"v2"' },
      payload: { status: "ACTIVE" },
    });
    expect(unarchive.statusCode).toBe(409);
  });

  it("lists recent patients without PHI in the query", async () => {
    const res = await api.request({
      method: "GET",
      url: "/api/v1/patients?limit=3",
      headers: bearer(frontDesk),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeLessThanOrEqual(3);
    const phi = await api.request({
      method: "GET",
      url: "/api/v1/patients?lastName=Reyes",
      headers: bearer(frontDesk),
    });
    expect(phi.statusCode).toBe(400);
  });

  it("manages contacts with one primary contact", async () => {
    const id = await fx.patient(org, { lastName: "Contacted" });
    const add = (payload: Record<string, unknown>) =>
      api.request({
        method: "POST",
        url: `/api/v1/patients/${id}/contacts`,
        headers: bearer(frontDesk),
        payload,
      });
    const first = await add({
      kind: "EMERGENCY_CONTACT",
      fullName: "First Contact",
      phone: "+15555550101",
      isPrimary: true,
    });
    expect(first.statusCode, first.body).toBe(201);
    const second = await add({ kind: "GUARDIAN", fullName: "Second Contact", isPrimary: true });
    const list = await api.request({
      method: "GET",
      url: `/api/v1/patients/${id}/contacts`,
      headers: bearer(frontDesk),
    });
    const primary = list.json().data.filter((c: { isPrimary: boolean }) => c.isPrimary);
    expect(primary.map((c: { id: string }) => c.id)).toEqual([second.json().data.id]);
    const contactId = first.json().data.id;
    const stale = await api.request({
      method: "PATCH",
      url: `/api/v1/patients/${id}/contacts/${contactId}`,
      headers: { ...bearer(frontDesk), "if-match": '"v1"' },
      payload: { relationship: "Sibling" },
    });
    expect(stale.statusCode).toBe(412);
    const removed = await api.request({
      method: "DELETE",
      url: `/api/v1/patients/${id}/contacts/${contactId}`,
      headers: bearer(frontDesk),
    });
    expect(removed.statusCode).toBe(204);
    const audit = await api.db.query(
      `SELECT metadata->>'change' AS change FROM "AuditEvent" WHERE "patientId" = $1 ORDER BY "occurredAt"`,
      [id],
    );
    expect(audit.rows.map((r) => r.change)).toEqual(["CONTACT_ADDED", "CONTACT_ADDED", "CONTACT_REMOVED"]);
  });

  it("enforces the primary-practice setting", async () => {
    const admin = await fx.staff(org, "ORGANIZATION_ADMIN");
    const put = await api.request({
      method: "PUT",
      url: "/api/v1/settings/organization/patients.primaryPracticeRequired",
      headers: { ...bearer(admin), "if-match": '"v0"' },
      payload: { value: true },
    });
    expect(put.statusCode, put.body).toBe(200);
    expect(put.headers.etag).toBe('"v1"');
    const missing = await create(frontDesk, {
      firstName: "No",
      lastName: "Practice",
      dateOfBirth: "1990-02-02",
    });
    expect(missing.statusCode).toBe(400);
    const ok = await create(frontDesk, {
      firstName: "Has",
      lastName: "Practice",
      dateOfBirth: "1990-02-02",
      primaryPracticeId: practice,
    });
    expect(ok.statusCode).toBe(201);
    await api.request({
      method: "PUT",
      url: "/api/v1/settings/organization/patients.primaryPracticeRequired",
      headers: { ...bearer(admin), "if-match": '"v1"' },
      payload: { value: false },
    });
  });

  it("limits search to 60 requests a minute per user", async () => {
    const member = await fx.staff(org, "FRONT_DESK");
    let status = 200;
    for (let i = 0; i < 61 && status === 200; i++)
      status = (await search(member, { dateOfBirth: "1900-01-01" })).statusCode;
    expect(status).toBe(429);
  });
});
