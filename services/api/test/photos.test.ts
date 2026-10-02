// The Layer 2 photo flow end to end (Bible §6, §29 "a standard photo session
// works end to end"; spec §6.1.9, §6.3, §5.4.10; ADR-0023 K2-02 to K2-06,
// K2-10 to K2-14): protocols, sessions, uploads to the emulated S3, verification,
// the malware scan, derivative jobs through the worker, signed viewing, tags and
// archive. image-processing is played by the test here (its own pytest suite
// covers it); every other hop is the real api and worker.
import { createHash } from "node:crypto";
import { uuidv7 } from "@aestara/database";
import { ReceiveMessageCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AwsClients } from "../src/aws/clients.ts";
import type { ImageJobMessage } from "../src/worker/derivatives.ts";
import type { Worker } from "../src/worker/module.ts";
import { EICAR } from "../src/worker/scans.ts";
import { databaseAvailable, startApi, startWorker, type TestApi } from "./support/app.ts";
import { bearer, Fixtures, type StaffMember } from "./support/fixtures.ts";

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
/** A tiny byte string that starts like a JPEG; the api checks the signature, never decodes. */
const jpeg = (fill: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(fill)]);
const png = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe.runIf(databaseAvailable())("photography (Layer 2)", () => {
  let api: TestApi;
  let worker: Worker;
  let fx: Fixtures;
  let org: string;
  let practice: string;
  let patient: string;
  let admin: StaffMember;
  let photographer: StaffMember;
  let surgeon: StaffMember;
  let frontDesk: StaffMember;
  let faceProtocol: string;

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
  const idem = () => ({ "idempotency-key": crypto.randomUUID() });

  /** Runs every worker hop once: scan, accept, relay, dispatch; returns the image job sent, if any. */
  async function settle(): Promise<ImageJobMessage[]> {
    await worker.consumer("scan-requests").pollOnce(1);
    await worker.consumer("scan-results").pollOnce(1);
    const relay = worker.context.get((await import("../src/worker/relay.ts")).OutboxRelay);
    await relay.relayOnce();
    await worker.consumer("worker-events").pollOnce(1);
    const sqs = worker.context.get(AwsClients).sqs;
    const out = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: api.aws.queues.imageJobs,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 1,
      }),
    );
    return (out.Messages ?? []).map((m) => JSON.parse(m.Body ?? "{}") as ImageJobMessage);
  }

  /** Plays image-processing: writes outputs through the presigned PUTs and reports them. */
  async function process(
    job: ImageJobMessage,
    options: { fail?: { errorCode: string; retryable: boolean } } = {},
  ) {
    const sqs = new SQSClient({
      endpoint: api.aws.endpoint,
      region: "us-east-1",
      credentials: { accessKeyId: "l", secretAccessKey: "l" },
    });
    const source = await fetch(job.source.url);
    expect(source.status).toBe(200);
    expect(sha256(Buffer.from(await source.arrayBuffer()))).toBe(job.source.sha256);
    const outputs = [];
    if (options.fail === undefined)
      for (const o of job.outputs) {
        const bytes = jpeg(`${o.kind}-${job.attempt}`);
        const put = await fetch(o.url, { method: "PUT", headers: o.headers, body: bytes });
        expect(put.status, await put.text()).toBe(200);
        outputs.push({
          kind: o.kind,
          sha256: sha256(bytes),
          byteSize: bytes.length,
          widthPx: o.maxEdgePx,
          heightPx: 300,
        });
      }
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: api.aws.queues.imageResults,
        MessageBody: JSON.stringify({
          jobId: job.jobId,
          attempt: job.attempt,
          status: options.fail ? "FAILED" : "SUCCEEDED",
          outputs,
          ...(options.fail ?? {}),
          generator: { name: "test-image-processing", version: "0" },
        }),
      }),
    );
    sqs.destroy();
    await worker.consumer("image-results").pollOnce(1);
  }

  async function startSession(who: StaffMember, protocolId = faceProtocol): Promise<string> {
    const res = await call(who, "POST", `/patients/${patient}/photo-sessions`, { protocolId }, idem());
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data.id;
  }

  async function upload(
    who: StaffMember,
    sessionId: string,
    viewKey: string,
    bytes: Buffer,
    declared: { sha256?: string; byteSize?: number; contentType?: string } = {},
  ) {
    const intent = await call(
      who,
      "POST",
      `/patients/${patient}/photos/uploads`,
      {
        photoSessionId: sessionId,
        viewKey,
        contentType: declared.contentType ?? "image/jpeg",
        byteSize: declared.byteSize ?? bytes.length,
        sha256: declared.sha256 ?? sha256(bytes),
        capturedAt: new Date().toISOString(),
        captureMetadata: { deviceModel: "iPad16,3", yawDeg: 1.5, positionMatchScore: 0.91 },
        qualityChecks: [{ code: "RETAKE_MOTION_BLUR", passed: true, value: 0.2 }],
      },
      idem(),
    );
    expect(intent.statusCode, intent.body).toBe(201);
    const { photoId, upload: signed } = intent.json().data;
    const put = await fetch(signed.url, { method: "PUT", headers: signed.headers, body: bytes });
    expect(put.status).toBe(200);
    const complete = await call(
      who,
      "POST",
      `/patients/${patient}/photos/${photoId}/complete-upload`,
      undefined,
      idem(),
    );
    return { photoId: photoId as string, intent, complete };
  }

  beforeAll(async () => {
    api = await startApi();
    worker = await startWorker(api);
    fx = new Fixtures(api);
    org = await fx.organization();
    practice = await fx.practice(org);
    patient = await fx.patient(org);
    admin = await fx.staff(org, "ORGANIZATION_ADMIN");
    photographer = await fx.staff(org, "PHOTOGRAPHER");
    surgeon = await fx.staff(org, "SURGEON_PHYSICIAN");
    frontDesk = await fx.staff(org, "FRONT_DESK");
    // The standard protocols, as the organization bootstrap seeds them.
    await api.db.query("SELECT app_seed_standard_protocols($1::uuid)", [org]);
    const protocols = await call(photographer, "GET", "/photography-protocols");
    faceProtocol = protocols.json().data.find((p: { name: string }) => p.name === "Face").id;
  });
  afterAll(async () => {
    await worker?.stop();
    await api?.close();
  });

  describe("standard protocols (Bible §6.2; K2-11)", () => {
    it("are the Bible's three, ACTIVE, organization-wide, every view required, in Bible order", async () => {
      const res = await call(photographer, "GET", "/photography-protocols?status=ACTIVE");
      const byName = new Map(res.json().data.map((p: { name: string }) => [p.name, p]));
      const keys = (name: string) =>
        (byName.get(name) as { views: { viewKey: string; isRequired: boolean }[] }).views.map(
          (v) => v.viewKey,
        );
      expect(keys("Face")).toEqual(["FRONT", "LEFT_45", "RIGHT_45", "LEFT_PROFILE", "RIGHT_PROFILE"]);
      expect(keys("Breast")).toEqual([
        "FRONT",
        "LEFT_OBLIQUE",
        "RIGHT_OBLIQUE",
        "LEFT_LATERAL",
        "RIGHT_LATERAL",
      ]);
      expect(keys("Abdomen/body contour")).toEqual([
        "FRONT",
        "LEFT_45",
        "RIGHT_45",
        "LEFT_PROFILE",
        "RIGHT_PROFILE",
        "BACK",
      ]);
      for (const p of byName.values() as Iterable<{
        standard: boolean;
        practiceId?: string;
        views: { isRequired: boolean; poseTarget: unknown }[];
      }>) {
        expect(p.standard).toBe(true);
        expect(p.practiceId).toBeUndefined();
        expect(p.views.every((v) => v.isRequired && v.poseTarget !== undefined)).toBe(true);
      }
    });

    it("are seeded for every new organization by the platform bootstrap", async () => {
      const operator = await fx.platformOperator();
      const slug = `seeded-${uuidv7().slice(-8)}`;
      const res = await call(
        operator,
        "POST",
        "/organizations",
        {
          name: "Seeded Org",
          slug,
          firstAdmin: { email: `first-${slug}@example.test`, displayName: "First" },
        },
        idem(),
      );
      expect(res.statusCode, res.body).toBe(201);
      const { rows } = await api.db.query(
        `SELECT count(DISTINCT p.id)::int AS protocols, count(v.id)::int AS views FROM "PhotographyProtocol" p
           JOIN "PhotographyProtocolView" v ON v."protocolId" = p.id
          WHERE p."organizationId" = $1 AND p.status = 'ACTIVE'`,
        [res.json().data.organization.id],
      );
      expect(rows[0]).toEqual({ protocols: 3, views: 16 });
    });
  });

  describe("protocol lifecycle (K2-10)", () => {
    const draft = {
      name: "Neck series",
      bodyRegion: "OTHER",
      views: [{ viewKey: "FRONT", name: "Front", isRequired: true }],
    };

    it("edits a draft, activates it, then refuses edits; a successor retires its predecessor", async () => {
      const created = await call(admin, "POST", "/photography-protocols", draft);
      expect(created.statusCode, created.body).toBe(201);
      expect(created.json().data).toMatchObject({ status: "DRAFT", standard: false, version: 1 });
      const id = created.json().data.id;
      const edited = await call(
        admin,
        "PATCH",
        `/photography-protocols/${id}`,
        {
          views: [
            { viewKey: "FRONT", name: "Front", isRequired: true },
            {
              viewKey: "LEFT_PROFILE",
              name: "Left profile",
              isRequired: false,
              captureInstructions: "Turn left.",
            },
          ],
        },
        { "if-match": '"v1"' },
      );
      expect(edited.statusCode, edited.body).toBe(200);
      expect(edited.json().data.views.map((v: { sortOrder: number }) => v.sortOrder)).toEqual([1, 2]);
      const active = await call(admin, "POST", `/photography-protocols/${id}/activate`, undefined, {
        "if-match": '"v2"',
      });
      expect(active.json().data.status).toBe("ACTIVE");
      const frozen = await call(
        admin,
        "PATCH",
        `/photography-protocols/${id}`,
        { name: "Renamed" },
        { "if-match": '"v3"' },
      );
      expect(frozen.statusCode).toBe(409);
      expect(frozen.json().error.code).toBe("INVALID_STATE_TRANSITION");

      const successor = await call(admin, "POST", "/photography-protocols", {
        ...draft,
        name: "Neck series v2",
        supersedesId: id,
      });
      expect(successor.statusCode).toBe(201);
      const second = await call(admin, "POST", "/photography-protocols", { ...draft, supersedesId: id });
      expect(second.statusCode).toBe(409);
      const sid = successor.json().data.id;
      await call(admin, "POST", `/photography-protocols/${sid}/activate`, undefined, { "if-match": '"v1"' });
      const predecessor = await call(admin, "GET", `/photography-protocols/${id}`);
      expect(predecessor.json().data).toMatchObject({ status: "RETIRED", supersededById: sid });
      const audit = await api.db.query(
        `SELECT metadata->>'change' AS change FROM "AuditEvent" WHERE "resourceId" = $1 AND action = 'CONFIGURATION_CHANGED' ORDER BY "occurredAt"`,
        [id],
      );
      expect(audit.rows.map((r) => r.change)).toEqual(["CREATED", "UPDATED", "ACTIVATED", "RETIRED"]);
    });

    it("discards a draft by retiring it, and never starts a session under a non-active protocol", async () => {
      const created = await call(admin, "POST", "/photography-protocols", draft);
      const id = created.json().data.id;
      const session = await call(
        photographer,
        "POST",
        `/patients/${patient}/photo-sessions`,
        { protocolId: id },
        idem(),
      );
      expect(session.statusCode).toBe(400);
      const retired = await call(admin, "POST", `/photography-protocols/${id}/retire`, undefined, {
        "if-match": '"v1"',
      });
      expect(retired.json().data.status).toBe("RETIRED");
    });

    it("limits a practice administrator to its own practice's protocols", async () => {
      const practiceAdmin = await fx.staff(org, "PRACTICE_ADMIN", { practiceId: practice });
      expect((await call(practiceAdmin, "POST", "/photography-protocols", draft)).statusCode).toBe(403);
      const own = await call(practiceAdmin, "POST", "/photography-protocols", {
        ...draft,
        practiceId: practice,
      });
      expect(own.statusCode, own.body).toBe(201);
      expect(own.json().data.practiceId).toBe(practice);
    });
  });

  describe("a standard photo session end to end (Bible §29)", () => {
    it("captures, verifies, scans, derives and serves every required view", async () => {
      const sessionId = await startSession(photographer);
      const views = ["FRONT", "LEFT_45", "RIGHT_45", "LEFT_PROFILE", "RIGHT_PROFILE"];
      const photos: string[] = [];
      for (const view of views) {
        const { photoId, complete } = await upload(photographer, sessionId, view, jpeg(`original-${view}`));
        expect(complete.statusCode, complete.body).toBe(200);
        expect(complete.json().data).toMatchObject({
          status: "QUARANTINED",
          scanStatus: "PENDING",
          viewKey: view,
        });
        photos.push(photoId);
      }
      // Nothing is served while the scan runs.
      const early = await call(photographer, "POST", `/patients/${patient}/photos/${photos[0]}/access-urls`, {
        variant: "THUMBNAIL",
      });
      expect(early.statusCode).toBe(409);

      const jobs = await settle();
      expect(jobs).toHaveLength(5);
      for (const job of jobs) {
        // The fixture patient's exact values: a bare "1988" also occurs by chance in the job's hex identifiers.
        expect(JSON.stringify(job)).not.toMatch(/Synthetic|"Ana"|1988-04-12/);
        await process(job);
      }

      const list = await call(photographer, "GET", `/patients/${patient}/photos?photoSessionId=${sessionId}`);
      expect(list.json().data).toHaveLength(5);
      for (const p of list.json().data) {
        expect(p).toMatchObject({ status: "ACCEPTED", scanStatus: "CLEAN", positionMatchScore: 0.91 });
        expect(p.derivatives.map((d: { status: string }) => d.status)).toEqual(["AVAILABLE", "AVAILABLE"]);
        expect(JSON.stringify(p)).not.toMatch(/objectKey|CLINICAL_ORIGINAL\//);
      }

      const session = await call(photographer, "GET", `/patients/${patient}/photo-sessions/${sessionId}`);
      expect(session.json().data.missingRequiredViews).toEqual([]);
      const done = await call(
        photographer,
        "POST",
        `/patients/${patient}/photo-sessions/${sessionId}/complete`,
        {},
      );
      expect(done.json().data.status).toBe("COMPLETED");

      const url = await call(photographer, "POST", `/patients/${patient}/photos/${photos[0]}/access-urls`, {
        variant: "DISPLAY_PREVIEW",
      });
      expect(url.statusCode, url.body).toBe(201);
      const preview = await fetch(url.json().data.url);
      expect(preview.status).toBe(200);
      expect(Buffer.from(await preview.arrayBuffer()).subarray(0, 3)).toEqual(
        Buffer.from([0xff, 0xd8, 0xff]),
      );
      expect(new Date(url.json().data.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(120_000);

      const batch = await call(photographer, "POST", `/patients/${patient}/photos/access-urls`, {
        photoIds: [...photos, uuidv7()],
        variant: "THUMBNAIL",
      });
      expect(batch.json().data.urls).toHaveLength(5);
      expect(batch.json().data.unavailable).toEqual([{ photoId: expect.any(String), reason: "NOT_FOUND" }]);

      const audit = await api.db.query(
        `SELECT action, count(*)::int AS n FROM "AuditEvent" WHERE "patientId" = $1 AND action IN ('PHOTO_CAPTURED', 'PHOTO_VIEWED')
          GROUP BY action ORDER BY action`,
        [patient],
      );
      expect(audit.rows).toEqual([
        { action: "PHOTO_CAPTURED", n: 5 },
        { action: "PHOTO_VIEWED", n: 6 },
      ]);
      const derivative = await api.db.query(
        `SELECT d."generationMetadata" AS meta, s.status, s."scanStatus" FROM "PhotoDerivative" d
           JOIN "StorageObject" s ON s.id = d."storageObjectId" WHERE d."sourcePhotoId" = $1 AND d.kind = 'THUMBNAIL'`,
        [photos[0]],
      );
      expect(derivative.rows[0]).toMatchObject({
        status: "AVAILABLE",
        scanStatus: "NOT_REQUIRED",
        meta: { maxEdgePx: 400, metadataStripped: true },
      });
    });

    it("refuses to complete a session with required views missing unless acknowledged (K2-13)", async () => {
      const sessionId = await startSession(photographer);
      const missing = await call(
        photographer,
        "POST",
        `/patients/${patient}/photo-sessions/${sessionId}/complete`,
        {},
      );
      expect(missing.statusCode).toBe(422);
      expect(missing.json().error.code).toBe("REQUIRED_VIEWS_MISSING");
      expect(missing.json().error.details.viewKeys).toHaveLength(5);
      const acknowledged = await call(
        photographer,
        "POST",
        `/patients/${patient}/photo-sessions/${sessionId}/complete`,
        {
          acknowledgeMissingRequiredViews: true,
        },
      );
      expect(acknowledged.json().data.status).toBe("COMPLETED");
      const late = await call(
        photographer,
        "POST",
        `/patients/${patient}/photos/uploads`,
        {
          photoSessionId: sessionId,
          viewKey: "FRONT",
          contentType: "image/jpeg",
          byteSize: 10,
          sha256: "c".repeat(64),
          capturedAt: new Date().toISOString(),
        },
        idem(),
      );
      expect(late.statusCode).toBe(409);
    });
  });

  describe("upload verification (spec §6.1.9; K2-02, K2-03)", () => {
    let sessionId: string;
    beforeAll(async () => {
      sessionId = await startSession(photographer);
    });

    it("rejects a checksum or size mismatch, a missing upload and a mislabelled file", async () => {
      const bytes = jpeg("tampered");
      const wrongSum = await upload(photographer, sessionId, "FRONT", bytes, {
        sha256: sha256(jpeg("other")),
      });
      expect(wrongSum.complete.statusCode).toBe(422);
      expect(wrongSum.complete.json().error).toMatchObject({
        code: "UPLOAD_VERIFICATION_FAILED",
        details: { reason: "CHECKSUM_MISMATCH" },
      });
      const wrongSize = await upload(photographer, sessionId, "FRONT", bytes, { byteSize: bytes.length + 1 });
      expect(wrongSize.complete.json().error.details.reason).toBe("SIZE_MISMATCH");
      const mislabelled = await upload(photographer, sessionId, "FRONT", png());
      expect(mislabelled.complete.statusCode).toBe(415);
      // The photo stays invisible: nothing unverified is ever listed or served.
      expect(
        (await call(photographer, "GET", `/patients/${patient}/photos/${mislabelled.photoId}`)).statusCode,
      ).toBe(404);

      const intent = await call(
        photographer,
        "POST",
        `/patients/${patient}/photos/uploads`,
        {
          photoSessionId: sessionId,
          viewKey: "FRONT",
          contentType: "image/jpeg",
          byteSize: 10,
          sha256: "d".repeat(64),
          capturedAt: new Date().toISOString(),
        },
        idem(),
      );
      const none = await call(
        photographer,
        "POST",
        `/patients/${patient}/photos/${intent.json().data.photoId}/complete-upload`,
        undefined,
        idem(),
      );
      expect(none.json().error.details.reason).toBe("NOT_UPLOADED");
    });

    it("refuses HEIC and oversized files at the intent", async () => {
      const base = {
        photoSessionId: sessionId,
        viewKey: "FRONT",
        byteSize: 10,
        sha256: "e".repeat(64),
        capturedAt: new Date().toISOString(),
      };
      expect(
        (
          await call(
            photographer,
            "POST",
            `/patients/${patient}/photos/uploads`,
            { ...base, contentType: "image/heic" },
            idem(),
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await call(
            photographer,
            "POST",
            `/patients/${patient}/photos/uploads`,
            { ...base, contentType: "image/jpeg", byteSize: 51 * 1024 * 1024 },
            idem(),
          )
        ).statusCode,
      ).toBe(400);
    });

    it("never overwrites an uploaded original (If-None-Match)", async () => {
      const bytes = jpeg("write-once");
      const intent = await call(
        photographer,
        "POST",
        `/patients/${patient}/photos/uploads`,
        {
          photoSessionId: sessionId,
          viewKey: "LEFT_45",
          contentType: "image/jpeg",
          byteSize: bytes.length,
          sha256: sha256(bytes),
          capturedAt: new Date().toISOString(),
        },
        idem(),
      );
      const signed = intent.json().data.upload;
      expect(signed.headers["If-None-Match"]).toBe("*");
      expect((await fetch(signed.url, { method: "PUT", headers: signed.headers, body: bytes })).status).toBe(
        200,
      );
      expect((await fetch(signed.url, { method: "PUT", headers: signed.headers, body: bytes })).status).toBe(
        412,
      );
    });

    it("replays an intent with a fresh URL, replays completion, and refuses a reused client ID", async () => {
      const bytes = jpeg("replay");
      const key = crypto.randomUUID();
      const id = uuidv7();
      const body = {
        id,
        photoSessionId: sessionId,
        viewKey: "RIGHT_45",
        contentType: "image/jpeg",
        byteSize: bytes.length,
        sha256: sha256(bytes),
        capturedAt: new Date().toISOString(),
      };
      const first = await call(photographer, "POST", `/patients/${patient}/photos/uploads`, body, {
        "idempotency-key": key,
      });
      expect(first.json().data.photoId).toBe(id);
      const again = await call(photographer, "POST", `/patients/${patient}/photos/uploads`, body, {
        "idempotency-key": key,
      });
      expect(again.statusCode).toBe(201);
      expect(again.json().data.upload.url).toBeDefined();
      const reused = await call(photographer, "POST", `/patients/${patient}/photos/uploads`, body, idem());
      expect(reused.statusCode).toBe(409);
      await fetch(again.json().data.upload.url, {
        method: "PUT",
        headers: again.json().data.upload.headers,
        body: bytes,
      });
      const completeKey = crypto.randomUUID();
      const done = await call(
        photographer,
        "POST",
        `/patients/${patient}/photos/${id}/complete-upload`,
        undefined,
        { "idempotency-key": completeKey },
      );
      const replay = await call(
        photographer,
        "POST",
        `/patients/${patient}/photos/${id}/complete-upload`,
        undefined,
        { "idempotency-key": completeKey },
      );
      expect(replay.json().data.id).toBe(done.json().data.id);
      const afterDone = await call(photographer, "POST", `/patients/${patient}/photos/uploads`, body, {
        "idempotency-key": key,
      });
      expect(afterDone.json().data.upload).toBeUndefined();
      const twice = await call(
        photographer,
        "POST",
        `/patients/${patient}/photos/${id}/complete-upload`,
        undefined,
        idem(),
      );
      expect(twice.statusCode).toBe(409);
    });
  });

  describe("malware scanning (K2-04, K2-05)", () => {
    it("rejects an infected upload, never serves it, and audits PHOTO_REJECTED", async () => {
      for (const job of await settle()) await process(job);
      const sessionId = await startSession(photographer);
      const { photoId } = await upload(
        photographer,
        sessionId,
        "FRONT",
        Buffer.concat([jpeg("x"), Buffer.from(EICAR)]),
      );
      expect(await settle()).toHaveLength(0);
      const photo = await call(photographer, "GET", `/patients/${patient}/photos/${photoId}`);
      expect(photo.json().data).toMatchObject({
        status: "REJECTED",
        scanStatus: "INFECTED",
        rejectionReason: "MALWARE_DETECTED",
        derivatives: [],
      });
      expect(
        (
          await call(surgeon, "POST", `/patients/${patient}/photos/${photoId}/access-urls`, {
            variant: "ORIGINAL",
          })
        ).statusCode,
      ).toBe(409);
      const listed = await call(
        photographer,
        "GET",
        `/patients/${patient}/photos?photoSessionId=${sessionId}`,
      );
      expect(listed.json().data).toHaveLength(0);
      const audit = await api.db.query(
        `SELECT "actorType", outcome, metadata FROM "AuditEvent" WHERE action = 'PHOTO_REJECTED' AND "resourceId" = $1`,
        [photoId],
      );
      expect(audit.rows).toEqual([
        { actorType: "SYSTEM", outcome: "FAILURE", metadata: { reason: "MALWARE_DETECTED" } },
      ]);
      const object = await api.db.query(
        `SELECT s.status FROM "StorageObject" s JOIN "PatientPhoto" p ON p."originalObjectId" = s.id WHERE p.id = $1`,
        [photoId],
      );
      expect(object.rows[0].status).toBe("REJECTED");
    });

    it("accepts at completion when the scan finished first", async () => {
      const sessionId = await startSession(photographer);
      const bytes = jpeg("scanned-first");
      const intent = await call(
        photographer,
        "POST",
        `/patients/${patient}/photos/uploads`,
        {
          photoSessionId: sessionId,
          viewKey: "FRONT",
          contentType: "image/jpeg",
          byteSize: bytes.length,
          sha256: sha256(bytes),
          capturedAt: new Date().toISOString(),
        },
        idem(),
      );
      const { photoId, upload: signed } = intent.json().data;
      await fetch(signed.url, { method: "PUT", headers: signed.headers, body: bytes });
      await worker.consumer("scan-requests").pollOnce(1);
      await worker.consumer("scan-results").pollOnce(1);
      const done = await call(
        photographer,
        "POST",
        `/patients/${patient}/photos/${photoId}/complete-upload`,
        undefined,
        idem(),
      );
      expect(done.json().data).toMatchObject({ status: "ACCEPTED", scanStatus: "CLEAN" });
      const jobs = await settle();
      expect(jobs.map((j) => j.outputs.length)).toEqual([2]);
      await process(jobs[0] as ImageJobMessage);
    });
  });

  describe("derivative retries (K2-06)", () => {
    it("retries a transient failure after a delay and fails for good after the last retry", async () => {
      const sessionId = await startSession(photographer);
      const { photoId } = await upload(photographer, sessionId, "FRONT", jpeg("retry"));
      let [job] = await settle();
      await process(job as ImageJobMessage, { fail: { errorCode: "STORAGE_TIMEOUT", retryable: true } });
      const queued = await api.db.query(
        `SELECT j.status, o."availableAt" > now() + interval '50 seconds' AS later FROM "AIJob" j
           JOIN "OutboxEvent" o ON o."aggregateId" = j.id AND o."publishedAt" IS NULL
          WHERE j."idempotencyKey" = $1`,
        [`derivatives:${photoId}`],
      );
      expect(queued.rows).toEqual([{ status: "QUEUED", later: true }]);
      for (let attempt = 2; attempt <= 4; attempt++) {
        await api.db.query(
          `UPDATE "OutboxEvent" SET "availableAt" = now() WHERE "publishedAt" IS NULL AND "eventType" = 'image.derivative.requested'`,
        );
        [job] = await settle();
        expect(job?.attempt).toBe(attempt);
        await process(job as ImageJobMessage, { fail: { errorCode: "STORAGE_TIMEOUT", retryable: true } });
      }
      const photo = await call(photographer, "GET", `/patients/${patient}/photos/${photoId}`);
      expect(photo.json().data.derivatives.map((d: { status: string }) => d.status)).toEqual([
        "FAILED",
        "FAILED",
      ]);
      expect(photo.json().data.status).toBe("ACCEPTED");
    });

    it("fails at once on an undecodable original and ignores a duplicate result", async () => {
      const sessionId = await startSession(photographer);
      const { photoId } = await upload(photographer, sessionId, "FRONT", jpeg("broken"));
      const [job] = await settle();
      await process(job as ImageJobMessage, { fail: { errorCode: "DECODE_FAILED", retryable: false } });
      await process(job as ImageJobMessage);
      const rows = await api.db.query(`SELECT status, "errorCode" FROM "AIJob" WHERE "idempotencyKey" = $1`, [
        `derivatives:${photoId}`,
      ]);
      expect(rows.rows).toEqual([{ status: "FAILED", errorCode: "DECODE_FAILED" }]);
    });

    it("retries an attempt whose result never arrives", async () => {
      const sessionId = await startSession(photographer);
      const { photoId } = await upload(photographer, sessionId, "FRONT", jpeg("lost"));
      await settle();
      await api.db.query(
        `UPDATE "AIJob" SET "startedAt" = now() - interval '20 minutes' WHERE "idempotencyKey" = $1`,
        [`derivatives:${photoId}`],
      );
      const { ScheduledJobs } = await import("../src/worker/jobs.ts");
      expect(await worker.context.get(ScheduledJobs).sweepDerivatives()).toBeGreaterThanOrEqual(1);
      const rows = await api.db.query(`SELECT status, "errorCode" FROM "AIJob" WHERE "idempotencyKey" = $1`, [
        `derivatives:${photoId}`,
      ]);
      expect(rows.rows).toEqual([{ status: "QUEUED", errorCode: "TIMEOUT" }]);
    });
  });

  describe("viewing, tags and archive (K2-14)", () => {
    let photoId: string;
    beforeAll(async () => {
      const sessionId = await startSession(photographer);
      ({ photoId } = await upload(photographer, sessionId, "FRONT", jpeg("view-tag-archive")));
      for (const job of await settle()) await process(job);
    });

    it("serves ORIGINAL only with photo.export, and audits it", async () => {
      const denied = await call(photographer, "POST", `/patients/${patient}/photos/${photoId}/access-urls`, {
        variant: "ORIGINAL",
      });
      expect(denied.statusCode).toBe(403);
      const ok = await call(surgeon, "POST", `/patients/${patient}/photos/${photoId}/access-urls`, {
        variant: "ORIGINAL",
      });
      expect(ok.statusCode).toBe(201);
      const got = await fetch(ok.json().data.url);
      expect(got.headers.get("cache-control")).toBe("private, no-store");
      expect(got.headers.get("content-disposition")).toBe('inline; filename="photo-original.jpg"');
      const audit = await api.db.query(
        `SELECT metadata->>'variant' AS variant FROM "AuditEvent" WHERE action = 'PHOTO_VIEWED' AND "resourceId" = $1 AND "actorUserId" = $2`,
        [photoId, surgeon.userId],
      );
      expect(audit.rows).toEqual([{ variant: "ORIGINAL" }]);
    });

    it("replaces tags as a set, normalised", async () => {
      const res = await call(photographer, "PUT", `/patients/${patient}/photos/${photoId}/tags`, undefined);
      expect(res.statusCode).toBe(400);
      const tagged = await call(surgeon, "PUT", `/patients/${patient}/photos/${photoId}/tags`, {
        tags: ["Baseline", "baseline", "Left side"],
      });
      expect(tagged.json().data.tags).toEqual(["baseline", "left side"]);
      const cleared = await call(surgeon, "PUT", `/patients/${patient}/photos/${photoId}/tags`, { tags: [] });
      expect(cleared.json().data.tags).toEqual([]);
    });

    it("archives: hidden by default, listed on request, still viewable, never archived twice", async () => {
      const archived = await call(photographer, "POST", `/patients/${patient}/photos/${photoId}/archive`);
      expect(archived.json().data.status).toBe("ARCHIVED");
      const listed = await call(photographer, "GET", `/patients/${patient}/photos`);
      expect(listed.json().data.map((p: { id: string }) => p.id)).not.toContain(photoId);
      const all = await call(photographer, "GET", `/patients/${patient}/photos?includeArchived=true`);
      expect(all.json().data.map((p: { id: string }) => p.id)).toContain(photoId);
      expect(
        (
          await call(photographer, "POST", `/patients/${patient}/photos/${photoId}/access-urls`, {
            variant: "THUMBNAIL",
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (await call(photographer, "POST", `/patients/${patient}/photos/${photoId}/archive`)).statusCode,
      ).toBe(409);
      const audit = await api.db.query(
        `SELECT count(*)::int AS n FROM "AuditEvent" WHERE action = 'PHOTO_ARCHIVED' AND "resourceId" = $1`,
        [photoId],
      );
      expect(audit.rows[0].n).toBe(1);
    });

    it("needs photo.view: front desk sees neither photos nor sessions", async () => {
      expect((await call(frontDesk, "GET", `/patients/${patient}/photos`)).statusCode).toBe(403);
      expect((await call(frontDesk, "GET", `/patients/${patient}/photos/${photoId}`)).statusCode).toBe(404);
    });
  });
});
