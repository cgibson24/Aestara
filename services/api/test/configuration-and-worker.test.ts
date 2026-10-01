// Feature flags, practice settings, the offline cache policy, retention policies
// (ADR-0023 K2-17 to K2-19), offline view replay (spec §8 rule 8), and the
// worker's relay and audit WORM copy with its reconciliation (spec §7.3;
// K2-07; TESTING_STRATEGY.md §9 item 8).

import { uuidv7 } from "@aestara/database";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { ReceiveMessageCommand } from "@aws-sdk/client-sqs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AwsClients } from "../src/aws/clients.ts";
import { ScheduledJobs } from "../src/worker/jobs.ts";
import type { Worker } from "../src/worker/module.ts";
import { OutboxRelay } from "../src/worker/relay.ts";
import { databaseAvailable, startApi, startWorker, type TestApi } from "./support/app.ts";
import { bearer, Fixtures, type StaffMember } from "./support/fixtures.ts";

describe.runIf(databaseAvailable())("configuration, offline replay and the worker (Layer 2)", () => {
  let api: TestApi;
  let worker: Worker;
  let fx: Fixtures;
  let org: string;
  let practiceA: string;
  let practiceB: string;
  let patient: string;
  let admin: StaffMember;
  let practiceAdmin: StaffMember;
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
      url: `/api/v1${url}`,
      headers: { ...bearer(who), ...headers },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });

  beforeAll(async () => {
    api = await startApi();
    worker = await startWorker(api);
    fx = new Fixtures(api);
    org = await fx.organization();
    practiceA = await fx.practice(org);
    practiceB = await fx.practice(org);
    patient = await fx.patient(org);
    admin = await fx.staff(org, "ORGANIZATION_ADMIN");
    practiceAdmin = await fx.staff(org, "PRACTICE_ADMIN", { practiceId: practiceA });
    photographer = await fx.staff(org, "PHOTOGRAPHER", { practiceId: practiceA });
  });
  afterAll(async () => {
    await worker?.stop();
    await api?.close();
  });

  describe("feature flags (K2-18)", () => {
    const flag = (who: StaffMember, practiceId?: string) =>
      call(who, "GET", `/feature-flags${practiceId ? `?practiceId=${practiceId}` : ""}`).then((r) =>
        r.json().data.find((f: { key: string }) => f.key === "photography.ghostOverlay"),
      );

    it("resolves practice over organization over the code default, for any member", async () => {
      expect(await flag(photographer)).toMatchObject({ enabled: true, source: "DEFAULT" });
      expect(
        (await call(admin, "PUT", "/feature-flags/photography.ghostOverlay", { enabled: false })).statusCode,
      ).toBe(200);
      expect(await flag(photographer)).toMatchObject({ enabled: false, source: "ORGANIZATION" });
      const own = await call(practiceAdmin, "PUT", "/feature-flags/photography.ghostOverlay", {
        enabled: true,
        practiceId: practiceA,
      });
      expect(own.statusCode, own.body).toBe(200);
      expect(await flag(photographer, practiceA)).toMatchObject({ enabled: true, source: "PRACTICE" });
      expect(await flag(photographer, practiceB)).toMatchObject({ enabled: false, source: "ORGANIZATION" });
    });

    it("keeps a practice administrator to its practice and refuses unknown flags", async () => {
      expect(
        (await call(practiceAdmin, "PUT", "/feature-flags/photography.ghostOverlay", { enabled: true }))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await call(practiceAdmin, "PUT", "/feature-flags/photography.ghostOverlay", {
            enabled: true,
            practiceId: practiceB,
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await call(admin, "PUT", "/feature-flags/photography.unknown", { enabled: true })).statusCode,
      ).toBe(404);
      const audit = await api.db.query(
        `SELECT count(*)::int AS n FROM "AuditEvent" WHERE action = 'CONFIGURATION_CHANGED' AND "resourceType" = 'FeatureFlag'`,
      );
      expect(audit.rows[0].n).toBe(2);
    });
  });

  describe("practice settings and the offline cache policy (K2-17)", () => {
    it("defaults to 25 patients and 7 days, caps the age at 7 days and needs If-Match", async () => {
      const read = await call(admin, "GET", `/settings/practices/${practiceA}/offline.cachePolicy`);
      expect(read.json().data).toMatchObject({
        isDefault: true,
        version: 0,
        value: { maxPatients: 25, maxAgeDays: 7 },
      });
      expect(read.headers.etag).toBe('"v0"');
      const tooLong = await call(
        admin,
        "PUT",
        `/settings/practices/${practiceA}/offline.cachePolicy`,
        { value: { maxPatients: 25, maxAgeDays: 9 } },
        { "if-match": '"v0"' },
      );
      expect(tooLong.statusCode).toBe(400);
      const set = await call(
        admin,
        "PUT",
        `/settings/practices/${practiceA}/offline.cachePolicy`,
        { value: { maxPatients: 10, maxAgeDays: 3 } },
        { "if-match": '"v0"' },
      );
      expect(set.statusCode, set.body).toBe(200);
      const stale = await call(
        admin,
        "PUT",
        `/settings/practices/${practiceA}/offline.cachePolicy`,
        { value: { maxPatients: 5, maxAgeDays: 1 } },
        { "if-match": '"v0"' },
      );
      expect(stale.statusCode).toBe(412);
    });

    it("applies the strictest policy among the caller's practices", async () => {
      const scoped = await call(photographer, "GET", "/settings/offline-cache-policy");
      expect(scoped.json().data).toEqual({ maxPatients: 10, maxAgeDays: 3, practiceIds: [practiceA] });
      await call(
        admin,
        "PUT",
        `/settings/practices/${practiceB}/offline.cachePolicy`,
        { value: { maxPatients: 40, maxAgeDays: 2 } },
        { "if-match": '"v0"' },
      );
      const orgWide = await fx.staff(org, "PHOTOGRAPHER");
      const policy = await call(orgWide, "GET", "/settings/offline-cache-policy");
      expect(policy.json().data).toMatchObject({ maxPatients: 10, maxAgeDays: 2 });
      expect(policy.json().data.practiceIds.sort()).toEqual([practiceA, practiceB].sort());
    });
  });

  describe("retention policies (K2-19)", () => {
    it("records ARCHIVE and REVIEW policies and refuses DELETE until legal hold exists", async () => {
      const body = {
        recordCategory: "CLINICAL_PHOTO",
        retentionDays: 3650,
        basis: "Customer schedule 4.2",
        effectiveFrom: "2027-01-01T00:00:00.000Z",
      };
      const review = await call(admin, "POST", "/retention-policies", { ...body, action: "REVIEW" });
      expect(review.statusCode, review.body).toBe(201);
      const remove = await call(admin, "POST", "/retention-policies", {
        ...body,
        action: "DELETE",
        effectiveFrom: "2027-02-01T00:00:00.000Z",
      });
      expect(remove.statusCode).toBe(400);
      expect(remove.json().error.details.fieldErrors[0].code).toBe("LEGAL_HOLD_REQUIRED");
      expect(
        (await call(admin, "POST", "/retention-policies", { ...body, action: "ARCHIVE" })).statusCode,
      ).toBe(409);
      expect(
        (
          await call(practiceAdmin, "POST", "/retention-policies", {
            ...body,
            action: "ARCHIVE",
            effectiveFrom: "2027-03-01T00:00:00.000Z",
          })
        ).statusCode,
      ).toBe(403);
      const list = await call(admin, "GET", "/retention-policies");
      expect(list.json().data.map((p: { action: string }) => p.action)).toEqual(["REVIEW"]);
    });
  });

  describe("offline view replay (spec §8 rule 8)", () => {
    it("records each offline view once, at its original time, marked offline", async () => {
      const event = {
        id: uuidv7(),
        action: "PATIENT_VIEWED",
        patientId: patient,
        occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
      };
      const first = await call(
        photographer,
        "POST",
        "/audit/offline-events",
        { events: [event] },
        { "idempotency-key": crypto.randomUUID() },
      );
      expect(first.statusCode, first.body).toBe(201);
      expect(first.json().data).toEqual({ recorded: 1, alreadyRecorded: 0 });
      const again = await call(
        photographer,
        "POST",
        "/audit/offline-events",
        { events: [event] },
        { "idempotency-key": crypto.randomUUID() },
      );
      expect(again.json().data).toEqual({ recorded: 0, alreadyRecorded: 1 });
      const row = await api.db.query(
        `SELECT "occurredAt", metadata, "actorUserId" FROM "AuditEvent" WHERE id = $1`,
        [event.id],
      );
      expect(row.rows[0].occurredAt.toISOString()).toBe(event.occurredAt);
      expect(row.rows[0]).toMatchObject({ metadata: { offline: true }, actorUserId: photographer.userId });
    });

    it("refuses views older than 7 days, of unknown patients, or without the read permission", async () => {
      const send = (who: StaffMember, e: Record<string, unknown>) =>
        call(
          who,
          "POST",
          "/audit/offline-events",
          { events: [e] },
          { "idempotency-key": crypto.randomUUID() },
        );
      const old = {
        id: uuidv7(),
        action: "PATIENT_VIEWED",
        patientId: patient,
        occurredAt: new Date(Date.now() - 9 * 86_400_000).toISOString(),
      };
      expect((await send(photographer, old)).statusCode).toBe(400);
      const other = await fx.patient(await fx.organization());
      const foreign = {
        id: uuidv7(),
        action: "PATIENT_VIEWED",
        patientId: other,
        occurredAt: new Date().toISOString(),
      };
      expect((await send(photographer, foreign)).statusCode).toBe(400);
      const marketing = await fx.staff(org, "MARKETING");
      const view = {
        id: uuidv7(),
        action: "PATIENT_VIEWED",
        patientId: patient,
        occurredAt: new Date().toISOString(),
      };
      expect((await send(marketing, view)).statusCode).toBe(403);
    });
  });

  describe("the outbox relay and the audit WORM copy (K2-07)", () => {
    it("archives every committed audit row, publishes events to the bus, and reconciles", async () => {
      const relay = worker.context.get(OutboxRelay);
      let batch = await relay.relayOnce(1000);
      while (batch.published + batch.archived > 0) batch = await relay.relayOnce(1000);
      const pending = await api.db.query(
        `SELECT count(*)::int AS n FROM "OutboxEvent" WHERE "publishedAt" IS NULL AND "availableAt" <= now()`,
      );
      expect(pending.rows[0].n).toBe(0);
      const s3 = worker.context.get(AwsClients).s3;
      const listed = await s3.send(
        new ListObjectsV2Command({ Bucket: api.aws.auditArchiveBucket, Prefix: "audit/" }),
      );
      expect(listed.Contents?.length).toBeGreaterThan(0);
      const object = await s3.send(
        new GetObjectCommand({ Bucket: api.aws.auditArchiveBucket, Key: listed.Contents?.[0]?.Key }),
      );
      expect(object.ObjectLockMode).toBe("GOVERNANCE");
      const first = JSON.parse(((await object.Body?.transformToString()) ?? "").split("\n")[0] ?? "{}");
      expect(first).toHaveProperty("action");
      expect(first).toHaveProperty("requestId");

      const jobs = worker.context.get(ScheduledJobs);
      const clean = await jobs.reconcileAudit(8);
      expect(clean.every((d) => d.missingFromArchive === 0 && d.unknownInArchive === 0)).toBe(true);
      expect(clean.reduce((n, d) => n + d.relayed, 0)).toBeGreaterThan(0);

      // A planted divergence: an archived row the database does not have.
      const today = new Date().toISOString().slice(0, 10);
      await s3.send(
        new PutObjectCommand({
          Bucket: api.aws.auditArchiveBucket,
          Key: `audit/${today.replaceAll("-", "/")}/planted.jsonl`,
          Body: `${JSON.stringify({ id: uuidv7(), action: "PATIENT_VIEWED" })}\n`,
        }),
      );
      const planted = await jobs.reconcileAudit(1);
      expect(planted[0]).toMatchObject({ day: today, unknownInArchive: 1 });
    });

    it("publishes domain events to the bus without PHI", async () => {
      const fresh = await fx.photography(org, patient, { capturedByUserId: admin.userId, release: false });
      await api.db.query(
        `INSERT INTO "OutboxEvent" (id, "organizationId", "eventType", "aggregateType", "aggregateId", payload)
         VALUES ($1, $2, 'photo.captured', 'PatientPhoto', $3, $4)`,
        [uuidv7(), org, fresh.photoId, JSON.stringify({ photoId: fresh.photoId, patientId: patient })],
      );
      const relay = worker.context.get(OutboxRelay);
      expect((await relay.relayOnce()).published).toBeGreaterThanOrEqual(1);
      // photo.captured has no Layer 2 consumer: the worker queue receives only derivative requests.
      const sqs = worker.context.get(AwsClients).sqs;
      const out = await sqs.send(
        new ReceiveMessageCommand({ QueueUrl: api.aws.queues.workerEvents, WaitTimeSeconds: 1 }),
      );
      expect(out.Messages ?? []).toHaveLength(0);
    });
  });
});
