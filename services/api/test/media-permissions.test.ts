// Media permissions and releases (Bible §7; spec §5.4.5, §6.3; ADR-0023 K2-15,
// K2-16): versioned and independent per category, the most specific row wins,
// every use re-checks, and ending a grant revokes the releases relying on it.
import { uuidv7 } from "@aestara/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScheduledJobs } from "../src/worker/jobs.ts";
import type { Worker } from "../src/worker/module.ts";
import { databaseAvailable, startApi, startWorker, type TestApi } from "./support/app.ts";
import { bearer, Fixtures, type StaffMember } from "./support/fixtures.ts";

describe.runIf(databaseAvailable())("media permissions and releases (Layer 2)", () => {
  let api: TestApi;
  let worker: Worker;
  let fx: Fixtures;
  let org: string;
  let patient: string;
  let surgeon: StaffMember;
  let photographer: StaffMember;
  let marketing: StaffMember;
  let photo: { photoId: string; photoSessionId: string };
  let second: { photoId: string };

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
  const record = (who: StaffMember, change: Record<string, unknown>) =>
    call(who, "POST", "/photo-permissions", change, { "idempotency-key": crypto.randomUUID() });
  const release = (who: StaffMember, purpose: string, photoId: string) =>
    call(who, "POST", "/media-releases", { purpose, photoId }, { "idempotency-key": crypto.randomUUID() });
  const grant = async (category: string, onGrant: Record<string, unknown> = {}) => {
    expect((await record(surgeon, { category, state: "REQUESTED" })).statusCode).toBe(201);
    const granted = await record(surgeon, {
      category,
      state: "GRANTED",
      evidence: "STAFF_ATTESTATION",
      ...onGrant,
    });
    expect(granted.statusCode, granted.body).toBe(201);
    return granted.json().data;
  };

  beforeAll(async () => {
    api = await startApi();
    worker = await startWorker(api);
    fx = new Fixtures(api);
    org = await fx.organization();
    patient = await fx.patient(org);
    surgeon = await fx.staff(org, "SURGEON_PHYSICIAN");
    photographer = await fx.staff(org, "PHOTOGRAPHER");
    marketing = await fx.staff(org, "MARKETING");
    photo = await fx.photography(org, patient, { capturedByUserId: surgeon.userId });
    // The fixture granted PATIENT_APP patient-wide and released the photo for it; start clean.
    await api.db.query(
      `UPDATE "MediaRelease" SET "revokedAt" = now(), "revocationReason" = 'fixture reset' WHERE "patientId" = $1`,
      [patient],
    );
    second = await fx.photography(org, patient, { capturedByUserId: surgeon.userId, release: false });
  });
  afterAll(async () => {
    await worker?.stop();
    await api?.close();
  });

  it("starts every category at NOT_REQUESTED and keeps categories independent (Bible §7.2)", async () => {
    const summary = await call(photographer, "GET", "/photo-permissions");
    expect(summary.statusCode).toBe(200);
    const states = Object.fromEntries(
      summary
        .json()
        .data.categories.map((c: { category: string; patientWideState: string }) => [
          c.category,
          c.patientWideState,
        ]),
    );
    expect(Object.keys(states)).toHaveLength(9);
    expect(states.WEBSITE).toBe("NOT_REQUESTED");
    await grant("CLINICAL_USE");
    const after = await call(photographer, "GET", "/photo-permissions");
    const next = Object.fromEntries(
      after
        .json()
        .data.categories.map((c: { category: string; patientWideState: string }) => [
          c.category,
          c.patientWideState,
        ]),
    );
    expect(next.CLINICAL_USE).toBe("GRANTED");
    for (const category of [
      "WEBSITE",
      "SOCIAL_MEDIA",
      "PAID_ADVERTISING",
      "RESEARCH",
      "AI_TRAINING",
      "EDUCATION",
    ])
      expect(next[category], category).toBe("NOT_REQUESTED");
  });

  it("follows the spec §5.4.5 machine and records each version", async () => {
    const direct = await record(surgeon, {
      category: "RESEARCH",
      state: "GRANTED",
      evidence: "STAFF_ATTESTATION",
    });
    expect(direct.statusCode).toBe(409);
    expect(direct.json().error.details).toEqual({ from: "NOT_REQUESTED", to: "GRANTED" });
    expect((await record(surgeon, { category: "RESEARCH", state: "REQUESTED" })).statusCode).toBe(201);
    const noEvidence = await record(surgeon, { category: "RESEARCH", state: "GRANTED" });
    expect(noEvidence.statusCode).toBe(400);
    const consent = await record(surgeon, {
      category: "RESEARCH",
      state: "GRANTED",
      evidence: "SIGNED_CONSENT",
    });
    expect(consent.json().error.details.fieldErrors[0].code).toBe("NOT_AVAILABLE");
    expect((await record(surgeon, { category: "RESEARCH", state: "DECLINED" })).statusCode).toBe(201);
    expect(
      (await record(surgeon, { category: "RESEARCH", state: "REQUESTED", reason: "Asked again" })).statusCode,
    ).toBe(201);
    const history = await call(photographer, "GET", "/photo-permissions/history?category=RESEARCH");
    expect(
      history.json().data.map((v: { state: string; versionNumber: number }) => [v.versionNumber, v.state]),
    ).toEqual([
      [3, "REQUESTED"],
      [2, "DECLINED"],
      [1, "REQUESTED"],
    ]);
    const audit = await api.db.query(
      `SELECT metadata->>'from' AS "from", metadata->>'to' AS "to" FROM "AuditEvent"
        WHERE action = 'PHOTO_PERMISSION_CHANGED' AND "patientId" = $1 AND metadata->>'category' = 'RESEARCH' ORDER BY "occurredAt"`,
      [patient],
    );
    expect(audit.rows).toEqual([
      { from: "NOT_REQUESTED", to: "REQUESTED" },
      { from: "REQUESTED", to: "DECLINED" },
      { from: "DECLINED", to: "REQUESTED" },
    ]);
    expect((await record(photographer, { category: "RESEARCH", state: "DECLINED" })).statusCode).toBe(403);
  });

  it("lets the most specific row win: a per-photo exception overrides the patient-wide grant (UD-21)", async () => {
    await grant("WEBSITE");
    const exception = await record(surgeon, {
      category: "WEBSITE",
      scope: "PHOTO",
      photoId: second.photoId,
      state: "REQUESTED",
    });
    expect(exception.statusCode, exception.body).toBe(201);
    expect(
      (
        await record(surgeon, {
          category: "WEBSITE",
          scope: "PHOTO",
          photoId: second.photoId,
          state: "DECLINED",
        })
      ).statusCode,
    ).toBe(201);
    expect((await release(surgeon, "WEBSITE", photo.photoId)).statusCode).toBe(201);
    const refused = await release(surgeon, "WEBSITE", second.photoId);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe("MEDIA_PERMISSION_NOT_GRANTED");
    const summary = await call(photographer, "GET", "/photo-permissions");
    const website = summary
      .json()
      .data.categories.find((c: { category: string }) => c.category === "WEBSITE");
    expect(website.patientWideState).toBe("GRANTED");
    expect(website.exceptions.map((e: { photoId: string; state: string }) => [e.photoId, e.state])).toEqual([
      [second.photoId, "DECLINED"],
    ]);
  });

  it("pins the permission version a release relied on, and refuses a second active release", async () => {
    const releases = await call(photographer, "GET", "/media-releases?purpose=WEBSITE&activeOnly=true");
    const active = releases.json().data[0];
    expect(active).toMatchObject({ purpose: "WEBSITE", photoId: photo.photoId, active: true });
    const governing = await api.db.query(
      `SELECT id FROM "PhotoPermission" WHERE "patientId" = $1 AND category = 'WEBSITE' AND scope = 'PATIENT_WIDE' AND "supersededAt" IS NULL`,
      [patient],
    );
    expect(active.pinnedPermissionIds).toEqual([governing.rows[0].id]);
    expect((await release(surgeon, "WEBSITE", photo.photoId)).statusCode).toBe(409);
  });

  it("revokes the releases a revocation leaves without a grant, and a re-grant never revives them (F-36)", async () => {
    const revoked = await record(surgeon, {
      category: "WEBSITE",
      state: "REVOKED",
      reason: "Patient request",
    });
    expect(revoked.statusCode).toBe(201);
    const releases = await call(photographer, "GET", "/media-releases?purpose=WEBSITE");
    const r = releases.json().data[0];
    expect(r).toMatchObject({ active: false, revocationReason: "Permission revoked" });
    const events = await api.db.query(
      `SELECT metadata->>'reason' AS reason FROM "AuditEvent" WHERE action = 'MEDIA_RELEASE_REVOKED' AND "resourceId" = $1`,
      [r.id],
    );
    expect(events.rows).toEqual([{ reason: "PERMISSION_WITHDRAWN" }]);
    const outbox = await api.db.query(
      `SELECT payload FROM "OutboxEvent" WHERE "eventType" = 'photo_permission.revoked' AND "aggregateId" = $1`,
      [revoked.json().data.id],
    );
    expect(outbox.rows[0].payload).toMatchObject({
      category: "WEBSITE",
      state: "REVOKED",
      releaseIds: [r.id],
    });
    await grant("WEBSITE");
    const again = await call(photographer, "GET", "/media-releases?purpose=WEBSITE&activeOnly=true");
    expect(again.json().data).toHaveLength(0);
  });

  it("needs consultation.complete for PATIENT_APP and photo.export otherwise", async () => {
    const marketer = await release(marketing, "PATIENT_APP", photo.photoId);
    expect(marketer.statusCode).toBe(403);
    expect(marketer.json().error.code).toBe("PERMISSION_DENIED");
    const ok = await release(surgeon, "PATIENT_APP", photo.photoId);
    expect(ok.statusCode, ok.body).toBe(201);
    const revoke = await call(surgeon, "POST", `/media-releases/${ok.json().data.id}/revoke`, {
      reason: "Released by mistake",
    });
    expect(revoke.json().data).toMatchObject({ active: false, revocationReason: "Released by mistake" });
    expect(
      (await call(surgeon, "POST", `/media-releases/${ok.json().data.id}/revoke`, { reason: "Again" }))
        .statusCode,
    ).toBe(409);
  });

  it("expires a grant at expiresAt: reads honour it at once, the job records it and withdraws releases", async () => {
    const expiry = new Date(Date.now() + 2_000).toISOString();
    await grant("SOCIAL_MEDIA", { expiresAt: expiry });
    const released = await release(surgeon, "SOCIAL_MEDIA", photo.photoId);
    expect(released.statusCode).toBe(201);
    await new Promise((r) => setTimeout(r, 2_100));
    const summary = await call(photographer, "GET", "/photo-permissions");
    expect(
      summary.json().data.categories.find((c: { category: string }) => c.category === "SOCIAL_MEDIA")
        .patientWideState,
    ).toBe("EXPIRED");
    expect((await release(surgeon, "SOCIAL_MEDIA", second.photoId)).statusCode).toBe(403);
    expect(await worker.context.get(ScheduledJobs).expirePermissions()).toBeGreaterThanOrEqual(1);
    const history = await call(photographer, "GET", "/photo-permissions/history?category=SOCIAL_MEDIA");
    expect(history.json().data[0]).toMatchObject({ state: "EXPIRED" });
    expect(history.json().data[0].recordedByUserId).toBeUndefined();
    const releases = await call(photographer, "GET", `/media-releases?purpose=SOCIAL_MEDIA`);
    expect(releases.json().data[0].active).toBe(false);
    const audit = await api.db.query(
      `SELECT "actorType" FROM "AuditEvent" WHERE action = 'PHOTO_PERMISSION_CHANGED' AND metadata->>'to' = 'EXPIRED' AND "patientId" = $1`,
      [patient],
    );
    expect(audit.rows).toEqual([{ actorType: "SYSTEM" }]);
  });

  it("refuses to release an archived or unknown photo", async () => {
    await grant("EDUCATION");
    await api.db.query(`UPDATE "PatientPhoto" SET status = 'ARCHIVED', "archivedAt" = now() WHERE id = $1`, [
      second.photoId,
    ]);
    expect((await release(surgeon, "EDUCATION", second.photoId)).statusCode).toBe(409);
    expect((await release(surgeon, "EDUCATION", uuidv7())).statusCode).toBe(400);
  });
});
