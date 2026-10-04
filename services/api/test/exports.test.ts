// Purpose-specific exports (Bible §7.1, §7.3, §8.3, §22.4, §34.1 #18, #19,
// #21; spec §6.3; ADR-0026 K3-14, K3-15; ADR-0027): the current grant is
// checked on every photo shown and pinned on the export's release; one
// PHOTO_EXPORTED per photo; the render runs through the worker with visible
// status; a failed render leaves nothing to download; an ended grant revokes
// the export. The image-processing side is played by the test.
import { createHash } from "node:crypto";
import { uuidv7 } from "@aestara/database";
import { ReceiveMessageCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExportJobMessage } from "../src/worker/exports.ts";
import type { Worker } from "../src/worker/module.ts";
import { OutboxRelay } from "../src/worker/relay.ts";
import { databaseAvailable, startApi, startWorker, type TestApi } from "./support/app.ts";
import { bearer, Fixtures, type StaffMember } from "./support/fixtures.ts";

/** Bytes that pass the worker's JPEG signature check; the render itself is image-processing's. */
const RENDERED = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xdb]), Buffer.alloc(60, 7)]);
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe.runIf(databaseAvailable())("exports (Layer 3)", () => {
  let api: TestApi;
  let fx: Fixtures;
  let worker: Worker;
  let sqs: SQSClient;
  let org: string;
  let surgeon: StaffMember;
  let photographer: StaffMember;
  let marketing: StaffMember;

  const call = (
    who: StaffMember,
    patientId: string,
    method: string,
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) =>
    api.request({
      method: method as "GET",
      url: `/api/v1/patients/${patientId}${url}`,
      headers: { ...bearer(who), ...headers },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
  const idem = () => ({ "idempotency-key": crypto.randomUUID() });

  /** A patient with one accepted photo, by the surgeon. */
  async function patientWithPhoto(): Promise<{ patient: string; photo: string; original: string }> {
    const patient = await fx.patient(org);
    const p = await fx.photography(org, patient, { capturedByUserId: surgeon.userId, release: false });
    return { patient, photo: p.photoId, original: p.objectKey };
  }

  async function record(patient: string, change: Record<string, unknown>): Promise<string> {
    const res = await call(surgeon, patient, "POST", "/photo-permissions", change, idem());
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data.id;
  }

  /** Requests, then grants, a category for the patient (or a narrower scope). */
  async function grant(
    patient: string,
    category: string,
    scope: Record<string, unknown> = {},
  ): Promise<string> {
    await record(patient, { category, state: "REQUESTED", ...scope });
    return record(patient, { category, state: "GRANTED", evidence: "STAFF_ATTESTATION", ...scope });
  }

  const exportPhoto = (who: StaffMember, patient: string, photo: string, body: Record<string, unknown>) =>
    call(who, patient, "POST", `/photos/${photo}/exports`, body, idem());

  /** Relays the outbox and dispatches: the export jobs image-processing would receive. */
  async function dispatched(): Promise<ExportJobMessage[]> {
    const relay = worker.context.get(OutboxRelay);
    let batch = await relay.relayOnce(1000);
    while (batch.published + batch.archived > 0) batch = await relay.relayOnce(1000);
    await worker.consumer("worker-events").pollOnce(1);
    const out = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: api.aws.queues.imageJobs,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
      }),
    );
    return (out.Messages ?? [])
      .map((m) => JSON.parse(m.Body ?? "{}") as ExportJobMessage)
      .filter((m) => m.task === "EXPORT");
  }

  async function onlyJob(): Promise<ExportJobMessage> {
    const jobs = await dispatched();
    expect(jobs).toHaveLength(1);
    return jobs[0] as ExportJobMessage;
  }

  async function report(job: ExportJobMessage, result: Record<string, unknown>): Promise<void> {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: api.aws.queues.imageResults,
        MessageBody: JSON.stringify({ task: "EXPORT", jobId: job.jobId, attempt: job.attempt, ...result }),
      }),
    );
    await worker.consumer("image-results").pollOnce(1);
  }

  /** Plays image-processing: writes the output through the job's PUT and reports it. */
  async function render(job: ExportJobMessage, bytes = RENDERED): Promise<void> {
    const put = await fetch(job.output.url, { method: "PUT", headers: job.output.headers, body: bytes });
    expect(put.status).toBe(200);
    await report(job, {
      status: "SUCCEEDED",
      output: { sha256: sha256(bytes), byteSize: bytes.length, widthPx: 3024, heightPx: 4032 },
      generator: { name: "aestara-image-processing", version: "0.2.0" },
    });
  }

  const rows = async (sql: string, values: unknown[]) => (await api.db.query(sql, values)).rows;

  beforeAll(async () => {
    api = await startApi();
    worker = await startWorker(api);
    fx = new Fixtures(api);
    sqs = new SQSClient({
      endpoint: api.aws.endpoint,
      region: "us-east-1",
      credentials: { accessKeyId: "l", secretAccessKey: "l" },
    });
    org = await fx.organization();
    surgeon = await fx.staff(org, "SURGEON_PHYSICIAN");
    photographer = await fx.staff(org, "PHOTOGRAPHER");
    marketing = await fx.staff(org, "MARKETING");
  });
  afterAll(async () => {
    sqs?.destroy();
    await worker?.stop();
    await api?.close();
  });

  it("exports under the current grant: pinned, audited, rendered, then downloadable [B §34.1 #18, #19]", async () => {
    const { patient, photo, original } = await patientWithPhoto();
    const grantId = await grant(patient, "CLINICAL_USE");
    const key = idem();
    const res = await call(
      surgeon,
      patient,
      "POST",
      `/photos/${photo}/exports`,
      { purpose: "CLINICAL_USE" },
      key,
    );
    expect(res.statusCode, res.body).toBe(202);
    const created = res.json().data;
    expect(created).toMatchObject({
      purpose: "CLINICAL_USE",
      kind: "EXPORT_DERIVATIVE",
      status: "PENDING",
      photoIds: [photo],
      requestedByUserId: surgeon.userId,
    });
    // A replay with the same key returns the same export and queues nothing more.
    const replay = await call(
      surgeon,
      patient,
      "POST",
      `/photos/${photo}/exports`,
      { purpose: "CLINICAL_USE" },
      key,
    );
    expect(replay.json().data.id).toBe(created.id);

    const [release] = await rows(
      `SELECT r.id, r.purpose, r."derivativeId", r."photoId", array_agg(p."permissionId") AS pins
         FROM "MediaRelease" r JOIN "MediaReleasePermission" p ON p."mediaReleaseId" = r.id
        WHERE r."derivativeId" = $1 GROUP BY r.id`,
      [created.id],
    );
    expect(release).toMatchObject({
      id: created.mediaReleaseId,
      purpose: "CLINICAL_USE",
      photoId: null,
      pins: [grantId],
    });
    const [job] = await rows(
      `SELECT status, "idempotencyKey", "jobType" FROM "AIJob" WHERE "idempotencyKey" = $1`,
      [`export:${created.id}`],
    );
    expect(job).toMatchObject({ status: "QUEUED", jobType: "IMAGE_DERIVATIVE" });
    const audit = await rows(
      `SELECT "resourceId", metadata FROM "AuditEvent" WHERE action = 'PHOTO_EXPORTED' AND "patientId" = $1`,
      [patient],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      resourceId: photo,
      metadata: {
        purpose: "CLINICAL_USE",
        kind: "EXPORT_DERIVATIVE",
        exportId: created.id,
        mediaReleaseId: release.id,
      },
    });
    // The release is listed with the patient's other releases.
    const listed = await call(surgeon, patient, "GET", "/media-releases");
    expect(listed.json().data).toEqual([
      expect.objectContaining({ id: release.id, derivativeId: created.id }),
    ]);

    const message = await onlyJob();
    expect(message).toMatchObject({
      task: "EXPORT",
      layout: "SINGLE",
      output: { maxEdgePx: 4096 },
      shapes: [],
      transform: null,
    });
    expect(message.sources).toHaveLength(1);
    expect(message.sources[0]?.url).toContain(original);
    expect(JSON.stringify(message)).not.toMatch(/Synthetic|MRN/);
    expect((await call(surgeon, patient, "GET", `/exports/${created.id}`)).json().data.status).toBe(
      "PENDING",
    );

    await render(message);
    const ready = (await call(surgeon, patient, "GET", `/exports/${created.id}`)).json().data;
    expect(ready).toMatchObject({ status: "READY", widthPx: 3024, heightPx: 4032 });
    const url = await call(surgeon, patient, "POST", `/exports/${created.id}/access-urls`);
    expect(url.statusCode, url.body).toBe(201);
    const { data } = url.json();
    expect(Date.parse(data.expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);
    expect(Buffer.from(await (await fetch(data.url)).arrayBuffer()).equals(RENDERED)).toBe(true);
    const viewed = await rows(
      `SELECT "resourceId", metadata FROM "AuditEvent" WHERE action = 'PHOTO_VIEWED' AND "patientId" = $1`,
      [patient],
    );
    expect(viewed).toEqual([
      { resourceId: photo, metadata: { variant: "EXPORT", exportId: created.id, purpose: "CLINICAL_USE" } },
    ]);
    // The original is untouched.
    const [o] = await rows(
      `SELECT o.status, o."objectKey" FROM "PatientPhoto" p JOIN "StorageObject" o ON o.id = p."originalObjectId" WHERE p.id = $1`,
      [photo],
    );
    expect(o).toEqual({ status: "AVAILABLE", objectKey: original });
  });

  it("refuses without the purpose's current grant and creates nothing [B §7.1, §34.1 #18]", async () => {
    const { patient, photo } = await patientWithPhoto();
    const refused = async (purpose: string) => {
      const res = await exportPhoto(surgeon, patient, photo, { purpose });
      expect(res.statusCode, res.body).toBe(403);
      expect(res.json().error).toMatchObject({
        code: "MEDIA_PERMISSION_NOT_GRANTED",
        details: { category: purpose },
      });
    };
    await refused("CLINICAL_USE");
    // Clinical use implies nothing else.
    await grant(patient, "CLINICAL_USE");
    await refused("WEBSITE");
    // A revoked grant.
    await grant(patient, "EDUCATION");
    await record(patient, { category: "EDUCATION", state: "REVOKED" });
    await refused("EDUCATION");
    // A grant past its expiry counts as expired at once, before the hourly job.
    await api.db.query(
      `INSERT INTO "PhotoPermission" (id, "organizationId", "patientId", category, scope, state, "versionNumber", "effectiveAt", "expiresAt", evidence)
       VALUES ($1, $2, $3, 'RESEARCH', 'PATIENT_WIDE', 'GRANTED', 1, now() - interval '2 days', now() - interval '1 minute', 'STAFF_ATTESTATION')`,
      [uuidv7(), org, patient],
    );
    await refused("RESEARCH");
    // A decline for this photo outweighs a patient-wide grant.
    await grant(patient, "SOCIAL_MEDIA");
    await record(patient, { category: "SOCIAL_MEDIA", scope: "PHOTO", photoId: photo, state: "REQUESTED" });
    await record(patient, { category: "SOCIAL_MEDIA", scope: "PHOTO", photoId: photo, state: "DECLINED" });
    await refused("SOCIAL_MEDIA");
    const counts = await rows(
      `SELECT (SELECT count(*)::int FROM "PhotoDerivative" WHERE "patientId" = $1) AS derivatives,
              (SELECT count(*)::int FROM "MediaRelease" WHERE "patientId" = $1) AS releases,
              (SELECT count(*)::int FROM "AIJob" WHERE "patientId" = $1) AS jobs,
              (SELECT count(*)::int FROM "AuditEvent" WHERE "patientId" = $1 AND action = 'PHOTO_EXPORTED') AS exported`,
      [patient],
    );
    expect(counts[0]).toEqual({ derivatives: 0, releases: 0, jobs: 0, exported: 0 });
  });

  it("names the image by what it shows and draws a layer in token colours, sized to the photo", async () => {
    const { patient, photo } = await patientWithPhoto();
    await grant(patient, "WEBSITE");
    await grant(patient, "CLINICAL_USE");
    const marketingExport = await exportPhoto(surgeon, patient, photo, { purpose: "WEBSITE" });
    expect(marketingExport.json().data.kind).toBe("MARKETING_DERIVATIVE");
    await dispatched();
    const layer = {
      schemaVersion: 1,
      shapes: [
        { type: "LINE", from: [0.1, 0.1], to: [0.5, 0.5], color: "RED", stroke: "THICK" },
        { type: "TEXT", position: [0.2, 0.7], text: "Brow", color: "YELLOW", size: "LARGE" },
      ],
    };
    const annotation = await call(
      surgeon,
      patient,
      "POST",
      `/photos/${photo}/annotations`,
      { layer },
      idem(),
    );
    expect(annotation.statusCode, annotation.body).toBe(201);
    const annotationId = annotation.json().data.id;
    const annotated = await exportPhoto(surgeon, patient, photo, { purpose: "CLINICAL_USE", annotationId });
    expect(annotated.json().data).toMatchObject({ kind: "ANNOTATED_DERIVATIVE", annotationId });
    const job = await onlyJob();
    expect(job.shapes).toEqual([
      { type: "LINE", from: [0.1, 0.1], to: [0.5, 0.5], color: "#E5484D", stroke: 0.008 },
      { type: "TEXT", position: [0.2, 0.7], text: "Brow", color: "#F5C518", size: 0.045 },
    ]);
    // PHOTO_EXPORTED never carries the layer's text.
    const audit = await rows(
      `SELECT metadata::text AS m FROM "AuditEvent" WHERE action = 'PHOTO_EXPORTED' AND "patientId" = $1`,
      [patient],
    );
    expect(audit.map((a) => a.m).join()).not.toContain("Brow");
    const unknown = await exportPhoto(surgeon, patient, photo, {
      purpose: "CLINICAL_USE",
      annotationId: uuidv7(),
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().error.details.fieldErrors[0]).toMatchObject({
      path: "annotationId",
      code: "UNKNOWN_ANNOTATION",
    });
  });

  it("fails visibly and serves nothing when the layer changed or the render failed [B §22.4, §34.1 #21]", async () => {
    const { patient, photo } = await patientWithPhoto();
    await grant(patient, "CLINICAL_USE");
    const layer = {
      schemaVersion: 1,
      shapes: [{ type: "LINE", from: [0, 0], to: [1, 1], color: "RED", stroke: "THIN" }],
    };
    const a = (await call(surgeon, patient, "POST", `/photos/${photo}/annotations`, { layer }, idem())).json()
      .data;
    const changed = (
      await exportPhoto(surgeon, patient, photo, { purpose: "CLINICAL_USE", annotationId: a.id })
    ).json().data;
    const edit = await call(
      surgeon,
      patient,
      "PATCH",
      `/photos/${photo}/annotations/${a.id}`,
      { label: "Edited" },
      {
        "if-match": `"v${a.version}"`,
      },
    );
    expect(edit.statusCode, edit.body).toBe(200);
    expect(await dispatched()).toHaveLength(0);
    const sourceChanged = (await call(surgeon, patient, "GET", `/exports/${changed.id}`)).json().data;
    expect(sourceChanged).toMatchObject({ status: "FAILED", failure: "SOURCE_CHANGED" });

    const objectOf = async (exportId: string) =>
      (
        await rows(
          `SELECT o.status FROM "PhotoDerivative" d JOIN "StorageObject" o ON o.id = d."storageObjectId" WHERE d.id = $1`,
          [exportId],
        )
      )[0]?.status;
    expect(await objectOf(changed.id)).toBe("REJECTED");
    const notReady = await call(surgeon, patient, "POST", `/exports/${changed.id}/access-urls`);
    expect(notReady.statusCode).toBe(409);

    // A transient failure retries later, with the same output object.
    const retried = (await exportPhoto(surgeon, patient, photo, { purpose: "CLINICAL_USE" })).json().data;
    const first = await onlyJob();
    await report(first, { status: "FAILED", errorCode: "RENDER_TIMEOUT", retryable: true });
    const [queued] = await rows(`SELECT status, attempt FROM "AIJob" WHERE "idempotencyKey" = $1`, [
      `export:${retried.id}`,
    ]);
    expect(queued).toEqual({ status: "QUEUED", attempt: 1 });
    const [next] = await rows(
      `SELECT payload, "availableAt" > now() AS later FROM "OutboxEvent" WHERE "eventType" = 'image.export.requested' AND "aggregateId" = $1 ORDER BY id DESC LIMIT 1`,
      [first.jobId],
    );
    expect(next).toEqual({ payload: { jobId: first.jobId, attempt: 2 }, later: true });
    expect((await call(surgeon, patient, "GET", `/exports/${retried.id}`)).json().data.status).toBe(
      "PENDING",
    );

    // A render that cannot succeed fails at once and leaves nothing to download.
    const broken = (await exportPhoto(surgeon, patient, photo, { purpose: "CLINICAL_USE" })).json().data;
    await report(await onlyJob(), { status: "FAILED", errorCode: "DECODE_FAILED", retryable: false });
    expect((await call(surgeon, patient, "GET", `/exports/${broken.id}`)).json().data).toMatchObject({
      status: "FAILED",
      failure: "RENDER_FAILED",
    });
    expect(await objectOf(broken.id)).toBe("REJECTED");

    // Bytes that do not match the report are never made available.
    const forged = (await exportPhoto(surgeon, patient, photo, { purpose: "CLINICAL_USE" })).json().data;
    const job = await onlyJob();
    await fetch(job.output.url, { method: "PUT", headers: job.output.headers, body: RENDERED });
    await report(job, {
      status: "SUCCEEDED",
      output: { sha256: "0".repeat(64), byteSize: RENDERED.length, widthPx: 10, heightPx: 10 },
    });
    expect((await call(surgeon, patient, "GET", `/exports/${forged.id}`)).json().data.status).toBe("FAILED");
    expect(await objectOf(forged.id)).toBe("REJECTED");
  });

  it("revokes the export when its grant ends: no more downloads [B §7.3]", async () => {
    const { patient, photo } = await patientWithPhoto();
    await grant(patient, "EDUCATION");
    const created = (await exportPhoto(surgeon, patient, photo, { purpose: "EDUCATION" })).json().data;
    await render(await onlyJob());
    expect((await call(surgeon, patient, "POST", `/exports/${created.id}/access-urls`)).statusCode).toBe(201);
    await record(patient, { category: "EDUCATION", state: "REVOKED" });
    const revoked = (await call(surgeon, patient, "GET", `/exports/${created.id}`)).json().data;
    expect(revoked.status).toBe("REVOKED");
    expect(revoked.revokedAt).toBeDefined();
    const refused = await call(surgeon, patient, "POST", `/exports/${created.id}/access-urls`);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe("MEDIA_PERMISSION_NOT_GRANTED");
    const [event] = await rows(
      `SELECT metadata FROM "AuditEvent" WHERE action = 'MEDIA_RELEASE_REVOKED' AND "resourceId" = $1`,
      [created.mediaReleaseId],
    );
    expect(event?.metadata).toMatchObject({ purpose: "EDUCATION", reason: "PERMISSION_WITHDRAWN" });
  });

  describe("before/after sets", () => {
    const transform = { scale: 1.04, rotationDeg: -2, translateX: 0.01, translateY: -0.02 };

    async function alignedSet(): Promise<{ patient: string; before: string; after: string; set: string }> {
      const { patient, photo } = await patientWithPhoto();
      const set = await fx.beforeAfter(org, patient, photo, surgeon.userId);
      const aligned = await call(
        surgeon,
        patient,
        "PATCH",
        `/before-after/${set}`,
        {
          registration: { mode: "MANUAL", transform },
        },
        { "if-match": '"v1"' },
      );
      expect(aligned.statusCode, aligned.body).toBe(200);
      const after = aligned.json().data.afterPhotoId;
      return { patient, before: photo, after, set };
    }

    it("needs the grant on both photos and renders side by side with the alignment it had when asked", async () => {
      const { patient, before, after, set } = await alignedSet();
      await grant(patient, "WEBSITE", { scope: "PHOTO", photoId: before });
      const one = await call(
        surgeon,
        patient,
        "POST",
        `/before-after/${set}/exports`,
        { purpose: "WEBSITE" },
        idem(),
      );
      expect(one.statusCode).toBe(403);
      expect(one.json().error.code).toBe("MEDIA_PERMISSION_NOT_GRANTED");
      await grant(patient, "CLINICAL_USE");
      const res = await call(
        surgeon,
        patient,
        "POST",
        `/before-after/${set}/exports`,
        { purpose: "CLINICAL_USE" },
        idem(),
      );
      expect(res.statusCode, res.body).toBe(202);
      expect(res.json().data).toMatchObject({
        kind: "BEFORE_AFTER_DERIVATIVE",
        photoIds: [before, after],
        beforeAfterSetId: set,
      });
      const audited = await rows(
        `SELECT "resourceId" FROM "AuditEvent" WHERE action = 'PHOTO_EXPORTED' AND "patientId" = $1 ORDER BY "resourceId"`,
        [patient],
      );
      expect(audited.map((r) => r.resourceId)).toEqual([before, after].sort());
      // Re-aligned after the request: the export keeps the alignment it was asked with.
      await call(
        surgeon,
        patient,
        "PATCH",
        `/before-after/${set}`,
        { registration: { mode: "NONE" } },
        {
          "if-match": '"v2"',
        },
      );
      const job = await onlyJob();
      expect(job).toMatchObject({ layout: "SIDE_BY_SIDE", shapes: [], transform });
      expect(job.sources).toHaveLength(2);
    });

    it("is revoked when either photo loses the grant", async () => {
      const { patient, after, set } = await alignedSet();
      await grant(patient, "EDUCATION");
      const created = (
        await call(surgeon, patient, "POST", `/before-after/${set}/exports`, { purpose: "EDUCATION" }, idem())
      ).json().data;
      await dispatched();
      await record(patient, { category: "EDUCATION", scope: "PHOTO", photoId: after, state: "REQUESTED" });
      await record(patient, { category: "EDUCATION", scope: "PHOTO", photoId: after, state: "DECLINED" });
      expect((await call(surgeon, patient, "GET", `/exports/${created.id}`)).json().data.status).toBe(
        "REVOKED",
      );
    });
  });

  it("needs photo.export, photo.view and a recent MFA; only accepted photos", async () => {
    const { patient, photo } = await patientWithPhoto();
    await grant(patient, "CLINICAL_USE");
    const viewer = await exportPhoto(photographer, patient, photo, { purpose: "CLINICAL_USE" });
    expect(viewer.statusCode).toBe(403);
    expect(viewer.json().error.code).toBe("PERMISSION_DENIED");
    // MARKETING holds photo.export for released assets only and sees no patient (F-71).
    const marketer = await exportPhoto(marketing, patient, photo, { purpose: "CLINICAL_USE" });
    expect(marketer.statusCode).toBe(404);
    expect(marketer.json().error.code).toBe("PHOTO_NOT_FOUND");
    const denied = await rows(
      `SELECT metadata FROM "AuditEvent" WHERE action = 'ACCESS_DENIED' AND "actorUserId" = $1`,
      [marketing.userId],
    );
    expect(denied[0]?.metadata).toMatchObject({
      operationId: "createPhotoExport",
      permission: "photo.export",
    });

    const stale = await fx.staff(org, "SURGEON_PHYSICIAN");
    await api.db.query(
      `UPDATE "Session" SET "mfaVerifiedAt" = now() - interval '20 minutes', "createdAt" = now() - interval '20 minutes' WHERE id = $1`,
      [stale.sessionId],
    );
    const old = await exportPhoto(stale, patient, photo, { purpose: "CLINICAL_USE" });
    expect(old.statusCode).toBe(403);
    expect(old.json().error.code).toBe("REAUTHENTICATION_REQUIRED");

    await api.db.query(`UPDATE "PatientPhoto" SET status = 'ARCHIVED', "archivedAt" = now() WHERE id = $1`, [
      photo,
    ]);
    const archived = await exportPhoto(surgeon, patient, photo, { purpose: "CLINICAL_USE" });
    expect(archived.statusCode).toBe(409);
  });

  it("limits each user to 30 export requests in 10 minutes", async () => {
    const { patient, photo } = await patientWithPhoto();
    await grant(patient, "RESEARCH");
    const busy = await fx.staff(org, "SURGEON_PHYSICIAN");
    for (let i = 0; i < 30; i++)
      expect((await exportPhoto(busy, patient, photo, { purpose: "RESEARCH" })).statusCode).toBe(202);
    const limited = await exportPhoto(busy, patient, photo, { purpose: "RESEARCH" });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    // Another user is not affected.
    expect((await exportPhoto(surgeon, patient, photo, { purpose: "RESEARCH" })).statusCode).toBe(202);
    await dispatched();
  });
});
