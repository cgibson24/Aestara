// The consultation lifecycle (Bible §5.1–5.2; spec §5.4.1, §6.3 "Consultations";
// ADR-0026 K3-01 to K3-05, K3-20): creation in a practice within the caller's
// scope, every transition of the machine, what each state allows, the
// completion preconditions, cancellation with a reason, archiving, optimistic
// concurrency and the audit trail.
import { uuidv7 } from "@aestara/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseAvailable, startApi, type TestApi } from "./support/app.ts";
import { bearer, Fixtures, type StaffMember } from "./support/fixtures.ts";

describe.runIf(databaseAvailable())("consultations (Layer 3)", () => {
  let api: TestApi;
  let fx: Fixtures;
  let org: string;
  let practice: string;
  let otherPractice: string;
  let location: string;
  let patient: string;
  let surgeon: StaffMember;
  let consultant: StaffMember;
  let practiceNurse: StaffMember;
  let locationNurse: StaffMember;
  let photographer: StaffMember;

  const call = (
    who: StaffMember,
    method: string,
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) =>
    api.request({
      method: method as "GET",
      url: `/api/v1/patients/${patient}${url}`,
      headers: { ...bearer(who), ...headers },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
  const idem = () => ({ "idempotency-key": crypto.randomUUID() });
  const at = (version: number) => ({ "if-match": `"v${version}"` });

  async function create(who: StaffMember, body: Record<string, unknown> = {}) {
    const res = await call(who, "POST", "/consultations", { practiceId: practice, ...body }, idem());
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data as { id: string; version: number; status: string };
  }

  async function move(who: StaffMember, id: string, action: string, version: number, body?: unknown) {
    return call(who, "POST", `/consultations/${id}/${action}`, body, at(version));
  }

  async function auditOf(id: string) {
    return (
      await api.db.query<{ action: string; metadata: Record<string, unknown>; patientId: string }>(
        `SELECT action, metadata, "patientId" FROM "AuditEvent" WHERE "resourceId" = $1 ORDER BY "occurredAt", id`,
        [id],
      )
    ).rows;
  }

  /** A summary document version made now, as M3.8's generator will. */
  async function summary(consultationId: string) {
    const objectId = uuidv7();
    const documentId = uuidv7();
    await api.db.query(
      `INSERT INTO "StorageObject" (id, "organizationId", "objectClass", bucket, "objectKey", "contentType", "byteSize", sha256, status, "scanStatus", "verifiedAt")
       VALUES ($1, $2, 'DOCUMENT', 'aestara-test-media', $3, 'application/pdf', 10, $4, 'AVAILABLE', 'NOT_REQUIRED', now())`,
      [objectId, org, `DOCUMENT/${uuidv7()}`, "c".repeat(64)],
    );
    await api.db.query(
      `INSERT INTO "Document" (id, "organizationId", "patientId", type, title, "consultationId", "updatedAt")
       VALUES ($1, $2, $3, 'CONSULTATION_SUMMARY', 'Consultation summary', $4, now())`,
      [documentId, org, patient, consultationId],
    );
    await api.db.query(
      `INSERT INTO "DocumentVersion" (id, "organizationId", "patientId", "documentId", "versionNumber", "storageObjectId", sha256)
       VALUES ($1, $2, $3, $4, 1, $5, $6)`,
      [uuidv7(), org, patient, documentId, objectId, "c".repeat(64)],
    );
  }

  beforeAll(async () => {
    api = await startApi();
    fx = new Fixtures(api);
    org = await fx.organization();
    practice = await fx.practice(org);
    otherPractice = await fx.practice(org);
    location = await fx.location(org, practice);
    patient = await fx.patient(org);
    surgeon = await fx.staff(org, "SURGEON_PHYSICIAN");
    consultant = await fx.staff(org, "CONSULTANT");
    practiceNurse = await fx.staff(org, "NURSE_INJECTOR_AESTHETICIAN", { practiceId: otherPractice });
    locationNurse = await fx.staff(org, "NURSE_INJECTOR_AESTHETICIAN", {
      practiceId: practice,
      locationId: location,
    });
    photographer = await fx.staff(org, "PHOTOGRAPHER");
    await api.db.query(
      `INSERT INTO "ProviderProfile" (id, "organizationId", "userId", "displayName", "updatedAt") VALUES ($1, $2, $3, 'Dr Synthetic', now())`,
      [uuidv7(), org, surgeon.userId],
    );
  });
  afterAll(async () => api?.close());

  describe("creating", () => {
    it("creates a DRAFT consultation in a practice, audited without its reason", async () => {
      const res = await call(
        surgeon,
        "POST",
        "/consultations",
        { practiceId: practice, primaryProviderUserId: surgeon.userId, reason: "Lip volume" },
        idem(),
      );
      expect(res.statusCode, res.body).toBe(201);
      expect(res.headers.etag).toBe('"v1"');
      const c = res.json().data;
      expect(c).toMatchObject({
        status: "DRAFT",
        practiceId: practice,
        primaryProviderUserId: surgeon.userId,
        reason: "Lip volume",
        concernIds: [],
        unmetCompletionPreconditions: ["CURRENT_SUMMARY"],
      });
      const events = await auditOf(c.id);
      expect(events.map((e) => e.action)).toEqual(["CONSULTATION_CREATED"]);
      expect(events[0]?.patientId).toBe(patient);
      expect(JSON.stringify(events)).not.toContain("Lip volume");
    });

    it("replays an idempotent create", async () => {
      const key = idem();
      const first = await call(surgeon, "POST", "/consultations", { practiceId: practice }, key);
      const again = await call(surgeon, "POST", "/consultations", { practiceId: practice }, key);
      expect(again.statusCode).toBe(201);
      expect(again.json().data.id).toBe(first.json().data.id);
    });

    it("needs a grant covering the practice, and a location of that practice", async () => {
      const outside = await call(practiceNurse, "POST", "/consultations", { practiceId: practice }, idem());
      expect(outside.statusCode).toBe(403);
      const own = await call(practiceNurse, "POST", "/consultations", { practiceId: otherPractice }, idem());
      expect(own.statusCode, own.body).toBe(201);
      const atLocation = await call(
        locationNurse,
        "POST",
        "/consultations",
        { practiceId: practice, locationId: location },
        idem(),
      );
      expect(atLocation.statusCode, atLocation.body).toBe(201);
      const noLocation = await call(
        locationNurse,
        "POST",
        "/consultations",
        { practiceId: practice },
        idem(),
      );
      expect(noLocation.statusCode).toBe(403);
      const wrongLocation = await call(
        surgeon,
        "POST",
        "/consultations",
        { practiceId: otherPractice, locationId: location },
        idem(),
      );
      expect(wrongLocation.statusCode).toBe(400);
      expect(wrongLocation.json().error.details.fieldErrors[0].code).toBe("UNKNOWN_LOCATION");
    });

    it("refuses an unknown practice or provider, and an archived patient", async () => {
      const practiceMissing = await call(surgeon, "POST", "/consultations", { practiceId: uuidv7() }, idem());
      expect(practiceMissing.json().error.details.fieldErrors[0].code).toBe("UNKNOWN_PRACTICE");
      const provider = await call(
        surgeon,
        "POST",
        "/consultations",
        { practiceId: practice, primaryProviderUserId: consultant.userId },
        idem(),
      );
      expect(provider.json().error.details.fieldErrors[0].code).toBe("UNKNOWN_PROVIDER");
      const archived = await fx.patient(org);
      await api.db.query(`UPDATE "Patient" SET status = 'ARCHIVED', "archivedAt" = now() WHERE id = $1`, [
        archived,
      ]);
      const res = await api.request({
        method: "POST",
        url: `/api/v1/patients/${archived}/consultations`,
        headers: { ...bearer(surgeon), ...idem() },
        payload: { practiceId: practice },
      });
      expect(res.statusCode).toBe(409);
    });

    it("is readable with consultation.create, not with photo permissions alone", async () => {
      const c = await create(surgeon);
      expect((await call(consultant, "GET", `/consultations/${c.id}`)).statusCode).toBe(200);
      const denied = await call(photographer, "GET", `/consultations/${c.id}`);
      expect(denied.statusCode).toBe(404);
      expect(denied.json().error.code).toBe("CONSULTATION_NOT_FOUND");
      expect((await call(photographer, "GET", "/consultations")).statusCode).toBe(403);
    });
  });

  describe("the machine (spec §5.4.1; UD-28)", () => {
    it("runs DRAFT → IN_PROGRESS → AWAITING_INFORMATION → IN_PROGRESS → READY_FOR_REVIEW → COMPLETED → ARCHIVED", async () => {
      const c = await create(surgeon, { reason: "Profile balance" });
      const started = await move(surgeon, c.id, "start", 1);
      expect(started.json().data).toMatchObject({ status: "IN_PROGRESS" });
      expect(started.json().data.startedAt).toBeDefined();
      expect((await move(surgeon, c.id, "request-information", 2)).json().data.status).toBe(
        "AWAITING_INFORMATION",
      );
      expect((await move(surgeon, c.id, "resume", 3)).json().data.status).toBe("IN_PROGRESS");
      const review = await move(surgeon, c.id, "submit-for-review", 4);
      expect(review.json().data).toMatchObject({
        status: "READY_FOR_REVIEW",
        unmetCompletionPreconditions: ["CURRENT_SUMMARY"],
      });
      const early = await move(surgeon, c.id, "complete", 5, { releaseDecision: "NOTHING_TO_RELEASE" });
      expect(early.statusCode).toBe(422);
      expect(early.json().error).toMatchObject({
        code: "COMPLETION_PRECONDITIONS_NOT_MET",
        details: { unmet: ["CURRENT_SUMMARY"] },
      });
      await summary(c.id);
      const done = await move(surgeon, c.id, "complete", 5, { releaseDecision: "NOTHING_TO_RELEASE" });
      expect(done.statusCode, done.body).toBe(200);
      expect(done.json().data).toMatchObject({
        status: "COMPLETED",
        completedById: surgeon.userId,
        releaseDecision: "NOTHING_TO_RELEASE",
        unmetCompletionPreconditions: [],
      });
      const archived = await move(surgeon, c.id, "archive", 6);
      expect(archived.json().data.status).toBe("ARCHIVED");
      const events = await auditOf(c.id);
      expect(events.map((e) => e.action)).toEqual([
        "CONSULTATION_CREATED",
        "CONSULTATION_STATUS_CHANGED",
        "CONSULTATION_STATUS_CHANGED",
        "CONSULTATION_STATUS_CHANGED",
        "CONSULTATION_STATUS_CHANGED",
        "CONSULTATION_COMPLETED",
        "CONSULTATION_STATUS_CHANGED",
      ]);
      expect(events[5]?.metadata).toMatchObject({
        statusFrom: "READY_FOR_REVIEW",
        statusTo: "COMPLETED",
        releaseDecision: "NOTHING_TO_RELEASE",
      });
    });

    it("lets IN_PROGRESS go straight to review and back again", async () => {
      const c = await create(surgeon, { reason: "Brow" });
      await move(surgeon, c.id, "start", 1);
      expect((await move(surgeon, c.id, "submit-for-review", 2)).json().data.status).toBe("READY_FOR_REVIEW");
      expect((await move(surgeon, c.id, "return-to-progress", 3)).json().data.status).toBe("IN_PROGRESS");
    });

    it("refuses a transition the machine does not have", async () => {
      const c = await create(surgeon, { reason: "Chin" });
      const res = await move(surgeon, c.id, "complete", 1, { releaseDecision: "NOTHING_TO_RELEASE" });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe("INVALID_STATE_TRANSITION");
      expect((await move(surgeon, c.id, "resume", 1)).statusCode).toBe(409);
      expect((await move(surgeon, c.id, "archive", 1)).statusCode).toBe(409);
    });

    it("refuses review while a note is a draft", async () => {
      const c = await create(surgeon, { reason: "Jawline" });
      await move(surgeon, c.id, "start", 1);
      await api.db.query(
        `INSERT INTO "ConsultationNote" (id, "organizationId", "patientId", "consultationId", "authorUserId", body, "updatedAt")
         VALUES ($1, $2, $3, $4, $5, 'Draft', now())`,
        [uuidv7(), org, patient, c.id, surgeon.userId],
      );
      const res = await move(surgeon, c.id, "submit-for-review", 2);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.details).toEqual({ unmet: ["NO_DRAFT_NOTES"] });
      const current = await call(surgeon, "GET", `/consultations/${c.id}`);
      expect(current.json().data.unmetCompletionPreconditions).toEqual(["NO_DRAFT_NOTES", "CURRENT_SUMMARY"]);
    });

    it("needs a reason or a concern to complete", async () => {
      const c = await create(surgeon);
      await move(surgeon, c.id, "start", 1);
      await move(surgeon, c.id, "submit-for-review", 2);
      await summary(c.id);
      const res = await move(surgeon, c.id, "complete", 3, { releaseDecision: "NOTHING_TO_RELEASE" });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.details.unmet).toEqual(["REASON_OR_CONCERN"]);
    });

    it("needs a summary made after the latest review", async () => {
      const c = await create(surgeon, { reason: "Neck" });
      await move(surgeon, c.id, "start", 1);
      await move(surgeon, c.id, "submit-for-review", 2);
      await summary(c.id);
      await move(surgeon, c.id, "return-to-progress", 3);
      await move(surgeon, c.id, "submit-for-review", 4);
      const res = await move(surgeon, c.id, "complete", 5, { releaseDecision: "NOTHING_TO_RELEASE" });
      expect(res.json().error.details.unmet).toEqual(["CURRENT_SUMMARY"]);
    });

    it("accepts only NOTHING_TO_RELEASE in Layer 3, and completion needs consultation.complete", async () => {
      const c = await create(surgeon, { reason: "Lips" });
      await move(surgeon, c.id, "start", 1);
      await move(surgeon, c.id, "submit-for-review", 2);
      await summary(c.id);
      const released = await move(surgeon, c.id, "complete", 3, { releaseDecision: "MATERIALS_RELEASED" });
      expect(released.statusCode).toBe(400);
      const missing = await move(surgeon, c.id, "complete", 3, {});
      expect(missing.statusCode).toBe(400);
      const byConsultant = await move(consultant, c.id, "complete", 3, {
        releaseDecision: "NOTHING_TO_RELEASE",
      });
      expect(byConsultant.statusCode).toBe(403);
    });
  });

  describe("what each state allows (ADR-0026 K3-02)", () => {
    it("changes the reason, provider and location while open, never the practice", async () => {
      const c = await create(surgeon, { reason: "First" });
      const res = await call(
        surgeon,
        "PATCH",
        `/consultations/${c.id}`,
        { reason: "Second", locationId: location, primaryProviderUserId: surgeon.userId },
        at(1),
      );
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data).toMatchObject({ reason: "Second", locationId: location, version: 2 });
      const cleared = await call(surgeon, "PATCH", `/consultations/${c.id}`, { locationId: null }, at(2));
      expect(cleared.json().data.locationId).toBeUndefined();
      const practiceChange = await call(
        surgeon,
        "PATCH",
        `/consultations/${c.id}`,
        { practiceId: otherPractice },
        at(3),
      );
      expect(practiceChange.statusCode).toBe(400);
    });

    it("freezes the content under review and after completion", async () => {
      const c = await create(surgeon, { reason: "Cheeks" });
      await move(surgeon, c.id, "start", 1);
      await move(surgeon, c.id, "submit-for-review", 2);
      const review = await call(surgeon, "PATCH", `/consultations/${c.id}`, { reason: "Changed" }, at(3));
      expect(review.statusCode).toBe(409);
      expect(review.json().error.message).toContain("Return it to progress");
      await summary(c.id);
      await move(surgeon, c.id, "complete", 3, { releaseDecision: "NOTHING_TO_RELEASE" });
      const closed = await call(surgeon, "PATCH", `/consultations/${c.id}`, { reason: "Late" }, at(4));
      expect(closed.statusCode).toBe(409);
    });

    it("rejects a stale If-Match with the current version", async () => {
      const c = await create(surgeon, { reason: "Nose" });
      await move(surgeon, c.id, "start", 1);
      const stale = await move(surgeon, c.id, "request-information", 1);
      expect(stale.statusCode).toBe(412);
      expect(stale.json().error.details.currentVersion).toBe(2);
    });

    it("lets only a grant covering the consultation's practice change it", async () => {
      const c = await create(surgeon, { reason: "Forehead" });
      const res = await move(practiceNurse, c.id, "start", 1);
      expect(res.statusCode).toBe(403);
      const there = await create(surgeon, { reason: "Eyes", locationId: location });
      expect((await move(locationNurse, there.id, "start", 1)).statusCode).toBe(200);
    });
  });

  describe("cancelling and listing (ADR-0026 K3-02, K3-05)", () => {
    it("cancels any non-final state with a reason that is stored but never audited", async () => {
      const c = await create(surgeon, { reason: "Tear trough" });
      await move(surgeon, c.id, "start", 1);
      await move(surgeon, c.id, "submit-for-review", 2);
      const noReason = await move(surgeon, c.id, "cancel", 3, {});
      expect(noReason.statusCode).toBe(400);
      const res = await move(surgeon, c.id, "cancel", 3, { reason: "Patient travelling" });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data).toMatchObject({
        status: "CANCELLED",
        cancelledById: surgeon.userId,
        cancellationReason: "Patient travelling",
      });
      expect(JSON.stringify(await auditOf(c.id))).not.toContain("travelling");
      expect((await move(surgeon, c.id, "start", 4)).statusCode).toBe(409);
      expect((await move(surgeon, c.id, "archive", 4)).json().data.status).toBe("ARCHIVED");
    });

    it("lists newest first and hides archived consultations unless asked", async () => {
      const own = await fx.patient(org);
      const list = (query = "") =>
        api.request({
          method: "GET",
          url: `/api/v1/patients/${own}/consultations${query}`,
          headers: bearer(surgeon),
        });
      const make = async () =>
        (
          await api.request({
            method: "POST",
            url: `/api/v1/patients/${own}/consultations`,
            headers: { ...bearer(surgeon), ...idem() },
            payload: { practiceId: practice, reason: "Listed" },
          })
        ).json().data;
      const first = await make();
      const second = await make();
      await api.request({
        method: "POST",
        url: `/api/v1/patients/${own}/consultations/${first.id}/cancel`,
        headers: { ...bearer(surgeon), ...at(1) },
        payload: { reason: "Duplicate" },
      });
      await api.request({
        method: "POST",
        url: `/api/v1/patients/${own}/consultations/${first.id}/archive`,
        headers: { ...bearer(surgeon), ...at(2) },
      });
      expect((await list()).json().data.map((c: { id: string }) => c.id)).toEqual([second.id]);
      expect((await list("?includeArchived=true")).json().data.map((c: { id: string }) => c.id)).toEqual([
        second.id,
        first.id,
      ]);
      const paged = await list("?limit=1&includeArchived=true");
      expect(paged.json().page.hasMore).toBe(true);
      const next = await list(`?limit=1&includeArchived=true&cursor=${paged.json().page.nextCursor}`);
      expect(next.json().data[0].id).toBe(first.id);
      expect((await list("?status=ARCHIVED")).json().data.map((c: { id: string }) => c.id)).toEqual([
        first.id,
      ]);
    });

    it("never shows a consultation of another patient", async () => {
      const c = await create(surgeon, { reason: "Elsewhere" });
      const other = await fx.patient(org);
      const res = await api.request({
        method: "GET",
        url: `/api/v1/patients/${other}/consultations/${c.id}`,
        headers: bearer(surgeon),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("CONSULTATION_NOT_FOUND");
    });
  });
});
