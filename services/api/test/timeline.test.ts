// The patient timeline (Bible §4.3; spec §6.3 `/timeline`; ADR-0026 K3-18;
// ADR-0027): items from the domain tables, newest first, an exact cursor even
// when items share a time, filtering by domain, each domain only for a caller
// who can read it, and metadata only.
import { uuidv7 } from "@aestara/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseAvailable, startApi, type TestApi } from "./support/app.ts";
import { bearer, Fixtures, type StaffMember } from "./support/fixtures.ts";

type Item = {
  id: string;
  kind: string;
  domain: string;
  occurredAt: string;
  actorUserId?: string;
  resource: { type: string; id: string };
};

describe.runIf(databaseAvailable())("patient timeline (Layer 3)", () => {
  let api: TestApi;
  let fx: Fixtures;
  let org: string;
  let patient: string;
  let surgeon: StaffMember;
  let photographer: StaffMember;
  let frontDesk: StaffMember;
  const tie = new Date("2026-09-01T12:00:00.000Z");

  const page = (who: StaffMember, query: string) =>
    api.request({
      method: "GET",
      url: `/api/v1/patients/${patient}/timeline?${query}`,
      headers: bearer(who),
    });

  /** Every item, following the cursor with the given page size. */
  async function all(who: StaffMember, limit: number, filter = ""): Promise<Item[]> {
    const items: Item[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 100; i++) {
      const res = await page(
        who,
        `limit=${limit}${filter}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json();
      items.push(...body.data);
      if (!body.page.hasMore) return items;
      cursor = body.page.nextCursor;
    }
    throw new Error("the cursor did not end");
  }

  beforeAll(async () => {
    api = await startApi();
    fx = new Fixtures(api);
    org = await fx.organization();
    const practice = await fx.practice(org);
    patient = await fx.patient(org);
    surgeon = await fx.staff(org, "SURGEON_PHYSICIAN");
    photographer = await fx.staff(org, "PHOTOGRAPHER");
    frontDesk = await fx.staff(org, "FRONT_DESK");
    await fx.consultation(org, patient, practice, surgeon.userId, "IN_PROGRESS");
    const photos = await fx.photography(org, patient, { capturedByUserId: surgeon.userId });
    await api.db.query(
      `UPDATE "PhotoSession" SET status = 'COMPLETED', "completedAt" = now() WHERE id = $1`,
      [photos.photoSessionId],
    );
    await fx.beforeAfter(org, patient, photos.photoId, surgeon.userId);
    await fx.document(org, patient, surgeon.userId);
    const revoke = await api.request({
      method: "POST",
      url: `/api/v1/patients/${patient}/media-releases/${photos.releaseId}/revoke`,
      headers: bearer(surgeon),
      payload: { reason: "Released by mistake" },
    });
    expect(revoke.statusCode, revoke.body).toBe(200);
    // Three items at one instant, to test the cursor's tie-break (kind, then ID).
    for (let i = 0; i < 2; i++) {
      const objectId = uuidv7();
      const documentId = uuidv7();
      await api.db.query(
        `INSERT INTO "StorageObject" (id, "organizationId", "objectClass", bucket, "objectKey", "contentType", "byteSize", sha256, status, "scanStatus", "verifiedAt")
         VALUES ($1, $2, 'DOCUMENT', 'aestara-test-media', $3, 'application/pdf', 10, $4, 'AVAILABLE', 'CLEAN', now())`,
        [objectId, org, `DOCUMENT/${uuidv7()}`, "e".repeat(64)],
      );
      await api.db.query(
        `INSERT INTO "Document" (id, "organizationId", "patientId", type, title, "updatedAt")
         VALUES ($1, $2, $3, 'UPLOADED_CLINICAL', 'Tied letter', now())`,
        [documentId, org, patient],
      );
      await api.db.query(
        `INSERT INTO "DocumentVersion" (id, "organizationId", "patientId", "documentId", "versionNumber", "storageObjectId", sha256, "createdAt")
         VALUES ($1, $2, $3, $4, 1, $5, $6, $7)`,
        [uuidv7(), org, patient, documentId, objectId, "e".repeat(64), tie],
      );
    }
    await api.db.query(
      `INSERT INTO "PhotoPermission" (id, "organizationId", "patientId", category, scope, state, "versionNumber", "effectiveAt", "createdAt")
       VALUES ($1, $2, $3, 'RESEARCH', 'PATIENT_WIDE', 'REQUESTED', 1, $4, $4)`,
      [uuidv7(), org, patient, tie],
    );
  });
  afterAll(async () => api?.close());

  it("lists every domain's items newest first, with an exact cursor across ties", async () => {
    const items = await all(surgeon, 100);
    expect(new Set(items.map((i) => i.kind))).toEqual(
      new Set([
        "PATIENT_CREATED",
        "CONSULTATION_CREATED",
        "CONSULTATION_STARTED",
        "PHOTO_SESSION_COMPLETED",
        "BEFORE_AFTER_CREATED",
        "DOCUMENT_ADDED",
        "MEDIA_PERMISSION_CHANGED",
        "MEDIA_RELEASED",
        "MEDIA_RELEASE_REVOKED",
      ]),
    );
    for (let i = 1; i < items.length; i++)
      expect(Date.parse(items[i - 1]?.occurredAt ?? "")).toBeGreaterThanOrEqual(
        Date.parse(items[i]?.occurredAt ?? ""),
      );
    const tied = items.filter((i) => i.occurredAt === tie.toISOString()).map((i) => i.kind);
    expect(tied).toEqual(["MEDIA_PERMISSION_CHANGED", "DOCUMENT_ADDED", "DOCUMENT_ADDED"]);
    // Page by page, one at a time and two at a time: the same items in the same order.
    expect((await all(surgeon, 1)).map((i) => i.id)).toEqual(items.map((i) => i.id));
    expect((await all(surgeon, 2)).map((i) => i.id)).toEqual(items.map((i) => i.id));
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    // Links and actors, never the record's text.
    const revoked = items.find((i) => i.kind === "MEDIA_RELEASE_REVOKED");
    expect(revoked).toMatchObject({ actorUserId: surgeon.userId, resource: { type: "MediaRelease" } });
    const text = JSON.stringify(items);
    for (const secret of ["Fixture reason", "Referral", "Released by mistake", "Tied letter"])
      expect(text).not.toContain(secret);
  });

  it("filters by domain", async () => {
    const documents = await all(surgeon, 10, "&domain=DOCUMENT");
    expect(documents.length).toBe(3);
    expect(documents.every((i) => i.kind === "DOCUMENT_ADDED" && i.resource.type === "Document")).toBe(true);
  });

  it("shows each domain only to a caller who can read it", async () => {
    const desk = await all(frontDesk, 50);
    expect([...new Set(desk.map((i) => i.domain))]).toEqual(["PATIENT"]);
    expect(await all(frontDesk, 50, "&domain=DOCUMENT")).toEqual([]);
    const photos = new Set((await all(photographer, 50)).map((i) => i.domain));
    expect(photos).toEqual(new Set(["PATIENT", "PHOTOGRAPHY", "MEDIA_PERMISSION"]));
  });
});
