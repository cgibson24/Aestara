// Clinical documents (Bible §12, §14.4; spec §6.3 "Documents"; ADR-0026 K3-16,
// K3-20; ADR-0027): PDF uploads verified and scanned like photos, versions
// that never change, attachment downloads with DOCUMENT_VIEWED, and audit
// metadata without titles. The local scanner stands in for GuardDuty.
import { createHash } from "node:crypto";
import { uuidv7 } from "@aestara/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Worker } from "../src/worker/module.ts";
import { EICAR } from "../src/worker/scans.ts";
import { databaseAvailable, startApi, startWorker, type TestApi } from "./support/app.ts";
import { bearer, Fixtures, type StaffMember } from "./support/fixtures.ts";

const pdf = (text: string) => Buffer.from(`%PDF-1.7\n% synthetic test document\n${text}\n%%EOF\n`);
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe.runIf(databaseAvailable())("documents (Layer 3)", () => {
  let api: TestApi;
  let worker: Worker;
  let fx: Fixtures;
  let org: string;
  let practice: string;
  let otherPractice: string;
  let patient: string;
  let otherPatient: string;
  let surgeon: StaffMember;
  let consultant: StaffMember;
  let frontDesk: StaffMember;
  let elsewhere: StaffMember;

  const call = (
    who: StaffMember,
    method: string,
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
    patientId = patient,
  ) =>
    api.request({
      method: method as "GET",
      url: `/api/v1/patients/${patientId}${url}`,
      headers: { ...bearer(who), ...headers },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
  const idem = () => ({ "idempotency-key": crypto.randomUUID() });

  const scan = async () => {
    await worker.consumer("scan-requests").pollOnce(1);
    await worker.consumer("scan-results").pollOnce(1);
  };

  async function intent(who: StaffMember, bytes: Buffer, body: Record<string, unknown>, headers = idem()) {
    const res = await call(
      who,
      "POST",
      "/documents/uploads",
      { contentType: "application/pdf", byteSize: bytes.length, sha256: sha256(bytes), ...body },
      headers,
    );
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data as {
      documentId: string;
      uploadId: string;
      upload?: { url: string; headers: Record<string, string> };
    };
  }

  const put = (i: { upload?: { url: string; headers: Record<string, string> } }, bytes: Buffer) =>
    fetch(i.upload?.url ?? "", { method: "PUT", headers: i.upload?.headers ?? {}, body: bytes });

  const complete = (who: StaffMember, i: { documentId: string; uploadId: string }, changeNote?: string) =>
    call(
      who,
      "POST",
      `/documents/${i.documentId}/complete-upload`,
      { uploadId: i.uploadId, ...(changeNote ? { changeNote } : {}) },
      idem(),
    );

  /** Uploads and completes a PDF, then lets the scan run. */
  async function upload(who: StaffMember, bytes: Buffer, body: Record<string, unknown>, changeNote?: string) {
    const i = await intent(who, bytes, body);
    expect((await put(i, bytes)).status).toBe(200);
    const done = await complete(who, i, changeNote);
    expect(done.statusCode, done.body).toBe(200);
    await scan();
    return i;
  }

  const rows = async (sql: string, values: unknown[]) => (await api.db.query(sql, values)).rows;

  beforeAll(async () => {
    api = await startApi();
    worker = await startWorker(api);
    fx = new Fixtures(api);
    org = await fx.organization();
    practice = await fx.practice(org);
    otherPractice = await fx.practice(org);
    patient = await fx.patient(org);
    otherPatient = await fx.patient(org);
    surgeon = await fx.staff(org, "SURGEON_PHYSICIAN");
    consultant = await fx.staff(org, "CONSULTANT");
    frontDesk = await fx.staff(org, "FRONT_DESK");
    elsewhere = await fx.staff(org, "NURSE_INJECTOR_AESTHETICIAN", { practiceId: otherPractice });
  });
  afterAll(async () => {
    await worker?.stop();
    await api?.close();
  });

  it("uploads, verifies, scans and serves a PDF as an attachment; titles are never audited", async () => {
    const bytes = pdf("referral");
    const i = await intent(surgeon, bytes, { title: "Referral letter from Dr Example" });
    expect(i.documentId).toBe(i.uploadId);
    // Not a document until its first version is completed.
    expect((await call(surgeon, "GET", `/documents/${i.documentId}`)).statusCode).toBe(404);
    expect((await call(surgeon, "GET", "/documents")).json().data).toEqual([]);
    expect((await put(i, bytes)).status).toBe(200);
    const done = await complete(surgeon, i);
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().data).toMatchObject({
      type: "UPLOADED_CLINICAL",
      title: "Referral letter from Dr Example",
      versions: [{ versionNumber: 1, status: "SCANNING", byteSize: bytes.length, sha256: sha256(bytes) }],
    });
    // Not served before its scan is clean.
    expect((await call(surgeon, "POST", `/documents/${i.documentId}/access-urls`, {})).statusCode).toBe(409);
    await scan();
    const listed = (await call(consultant, "GET", "/documents")).json().data;
    expect(listed).toEqual([
      expect.objectContaining({
        id: i.documentId,
        versions: [expect.objectContaining({ status: "AVAILABLE" })],
      }),
    ]);
    const url = await call(consultant, "POST", `/documents/${i.documentId}/access-urls`, {});
    expect(url.statusCode, url.body).toBe(201);
    expect(url.json().data).toMatchObject({ documentId: i.documentId, versionNumber: 1 });
    expect(Date.parse(url.json().data.expiresAt) - Date.now()).toBeGreaterThan(9 * 60_000);
    const download = await fetch(url.json().data.url);
    expect(download.headers.get("content-disposition")).toBe('attachment; filename="document-v1.pdf"');
    expect(download.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await download.arrayBuffer()).equals(bytes)).toBe(true);
    const audit = await rows(
      `SELECT action, metadata, "actorUserId" FROM "AuditEvent" WHERE "resourceId" = $1 ORDER BY "occurredAt"`,
      [i.documentId],
    );
    expect(audit).toEqual([
      {
        action: "DOCUMENT_ADDED",
        metadata: { type: "UPLOADED_CLINICAL", versionNumber: 1, generated: false },
        actorUserId: surgeon.userId,
      },
      {
        action: "DOCUMENT_VIEWED",
        metadata: { type: "UPLOADED_CLINICAL", versionNumber: 1 },
        actorUserId: consultant.userId,
      },
    ]);
    expect(JSON.stringify(audit)).not.toContain("Referral");
  });

  it("adds versions to an uploaded document and never changes one", async () => {
    const first = await upload(surgeon, pdf("v1"), { title: "Outside records" });
    const second = await upload(surgeon, pdf("v2"), { documentId: first.documentId }, "Page 2 added");
    expect(second.documentId).toBe(first.documentId);
    expect(second.uploadId).not.toBe(first.uploadId);
    const doc = (await call(surgeon, "GET", `/documents/${first.documentId}`)).json().data;
    expect(
      doc.versions.map((v: { versionNumber: number; status: string }) => [v.versionNumber, v.status]),
    ).toEqual([
      [2, "AVAILABLE"],
      [1, "AVAILABLE"],
    ]);
    expect(doc.versions[0].changeNote).toBe("Page 2 added");
    // The first version stays downloadable.
    const old = await call(surgeon, "POST", `/documents/${first.documentId}/access-urls`, {
      versionId: doc.versions[1].id,
    });
    expect(old.json().data.versionNumber).toBe(1);
    await expect(
      api.db.query(`UPDATE "DocumentVersion" SET sha256 = $1 WHERE id = $2`, [
        "0".repeat(64),
        doc.versions[1].id,
      ]),
    ).rejects.toThrow();
  });

  it("refuses a file that is not what was declared, and completes once", async () => {
    // Not a PDF.
    const text = Buffer.from("plain text, not a PDF");
    const notPdf = await intent(surgeon, text, { title: "Note" });
    await put(notPdf, text);
    const refused = await complete(surgeon, notPdf);
    expect(refused.statusCode).toBe(415);
    // Nothing uploaded.
    const missing = await intent(surgeon, pdf("never sent"), { title: "Missing" });
    const none = await complete(surgeon, missing);
    expect(none.statusCode).toBe(422);
    expect(none.json().error.details.reason).toBe("NOT_UPLOADED");
    // Bytes that do not match the declared checksum: S3 refuses the signed PUT; were they
    // stored anyway (the emulator does not check), completion refuses them.
    const declared = pdf("declared");
    const swapped = await intent(surgeon, declared, { title: "Swapped" });
    if ((await put(swapped, pdf("other bytes!"))).status === 200) {
      const mismatch = await complete(surgeon, swapped);
      expect(mismatch.statusCode).toBe(422);
      expect(mismatch.json().error.details.reason).toBe("SIZE_MISMATCH");
    }
    // Another user's upload, and a second completion.
    const ok = await intent(surgeon, pdf("once"), { title: "Once" });
    await put(ok, pdf("once"));
    const foreign = await complete(elsewhere, ok);
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json().error.details.fieldErrors[0].code).toBe("UNKNOWN_UPLOAD");
    expect((await complete(surgeon, ok)).statusCode).toBe(200);
    expect((await complete(surgeon, ok)).statusCode).toBe(409);
  });

  it("never serves a version the malware scan rejects", async () => {
    const infected = Buffer.concat([pdf("x"), Buffer.from(EICAR)]);
    const i = await upload(surgeon, infected, { title: "Scanned fax" });
    const doc = (await call(surgeon, "GET", `/documents/${i.documentId}`)).json().data;
    expect(doc.versions[0].status).toBe("REJECTED");
    const refused = await call(surgeon, "POST", `/documents/${i.documentId}/access-urls`, {});
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toContain("malware");
  });

  it("applies a scan that finished before the upload was completed", async () => {
    const bytes = pdf("early");
    const i = await intent(surgeon, bytes, { title: "Early scan" });
    await put(i, bytes);
    await scan();
    const done = await complete(surgeon, i);
    expect(done.json().data.versions[0].status).toBe("AVAILABLE");
  });

  it("replays an intent with a fresh upload until the file is completed", async () => {
    const bytes = pdf("replay");
    const key = idem();
    const first = await intent(surgeon, bytes, { title: "Replayed" }, key);
    const again = await intent(surgeon, bytes, { title: "Replayed" }, key);
    expect(again.uploadId).toBe(first.uploadId);
    expect(again.upload).toBeDefined();
    await put(first, bytes);
    await complete(surgeon, first);
    const after = await intent(surgeon, bytes, { title: "Replayed" }, key);
    expect(after.upload).toBeUndefined();
  });

  it("links a document only to the patient's consultation, within the caller's practice", async () => {
    const consultation = await fx.consultation(org, patient, practice, surgeon.userId, "IN_PROGRESS");
    const foreign = await fx.consultation(org, otherPatient, practice, surgeon.userId, "IN_PROGRESS");
    const bytes = pdf("linked");
    const linked = await upload(surgeon, bytes, { title: "Lab results", consultationId: consultation });
    const doc = (await call(surgeon, "GET", `/documents/${linked.documentId}`)).json().data;
    expect(doc.consultationId).toBe(consultation);
    const filtered = (await call(surgeon, "GET", `/documents?consultationId=${consultation}`)).json().data;
    expect(filtered.map((d: { id: string }) => d.id)).toEqual([linked.documentId]);
    const other = await call(
      surgeon,
      "POST",
      "/documents/uploads",
      {
        title: "x",
        consultationId: foreign,
        contentType: "application/pdf",
        byteSize: 5,
        sha256: "a".repeat(64),
      },
      idem(),
    );
    expect(other.statusCode).toBe(400);
    expect(other.json().error.details.fieldErrors[0].code).toBe("UNKNOWN_CONSULTATION");
    const outOfScope = await call(
      elsewhere,
      "POST",
      "/documents/uploads",
      {
        title: "x",
        consultationId: consultation,
        contentType: "application/pdf",
        byteSize: 5,
        sha256: "a".repeat(64),
      },
      idem(),
    );
    expect(outOfScope.statusCode).toBe(403);
    // Unlinked documents are organization-owned: any document.manage holder uploads them.
    const unlinked = await call(
      elsewhere,
      "POST",
      "/documents/uploads",
      { title: "x", contentType: "application/pdf", byteSize: 5, sha256: "a".repeat(64) },
      idem(),
    );
    expect(unlinked.statusCode).toBe(201);
  });

  it("needs document.read to read and document.manage to upload; summaries take no uploads", async () => {
    const i = await upload(surgeon, pdf("perm"), { title: "Permissions" });
    expect((await call(consultant, "GET", `/documents/${i.documentId}`)).statusCode).toBe(200);
    const upload403 = await call(
      consultant,
      "POST",
      "/documents/uploads",
      { documentId: i.documentId, contentType: "application/pdf", byteSize: 5, sha256: "a".repeat(64) },
      idem(),
    );
    expect(upload403.statusCode).toBe(403);
    const desk = await call(frontDesk, "GET", `/documents/${i.documentId}`);
    expect(desk.statusCode).toBe(404);
    expect(desk.json().error.code).toBe("DOCUMENT_NOT_FOUND");
    const consultation = await fx.consultation(org, patient, practice, surgeon.userId, "IN_PROGRESS");
    const summaryId = uuidv7();
    await api.db.query(
      `INSERT INTO "Document" (id, "organizationId", "patientId", type, title, "consultationId", "updatedAt")
       VALUES ($1, $2, $3, 'CONSULTATION_SUMMARY', 'Consultation summary', $4, now())`,
      [summaryId, org, patient, consultation],
    );
    const toSummary = await call(
      surgeon,
      "POST",
      "/documents/uploads",
      { documentId: summaryId, contentType: "application/pdf", byteSize: 5, sha256: "a".repeat(64) },
      idem(),
    );
    expect(toSummary.statusCode).toBe(409);
  });
});
