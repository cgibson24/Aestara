// The consultation summary (Bible §5.1 "Generate summary"; spec §6.3 `POST
// …/{cid}/summary`; ADR-0026 K3-17; ADR-0027): generated in READY_FOR_REVIEW
// or after an addendum, a new version of the consultation's one summary
// document each time, with final notes and their addenda, no drafts and no
// images; it satisfies the CURRENT_SUMMARY completion precondition.
import { uuidv7 } from "@aestara/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as summaryModule from "../src/documents/summary.ts";
import { databaseAvailable, startApi, type TestApi } from "./support/app.ts";
import { bearer, Fixtures, type StaffMember } from "./support/fixtures.ts";

// The PDF's text is glyph IDs of a subset font: the test reads what was handed to the renderer.
vi.mock("../src/documents/summary.ts", async (original) => {
  const actual = await original<typeof import("../src/documents/summary.ts")>();
  return { ...actual, renderSummary: vi.fn(actual.renderSummary) };
});

describe.runIf(databaseAvailable())("consultation summary (Layer 3)", () => {
  let api: TestApi;
  let fx: Fixtures;
  let org: string;
  let practice: string;
  let otherPractice: string;
  let patient: string;
  let surgeon: StaffMember;
  let nurse: StaffMember;
  let elsewhere: StaffMember;

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

  async function get(id: string) {
    return (await call(surgeon, "GET", `/consultations/${id}`)).json().data as {
      version: number;
      status: string;
      unmetCompletionPreconditions: string[];
    };
  }

  async function move(id: string, action: string, body?: unknown) {
    const res = await call(
      surgeon,
      "POST",
      `/consultations/${id}/${action}`,
      body,
      at((await get(id)).version),
    );
    expect(res.statusCode, res.body).toBe(200);
  }

  async function note(id: string, who: StaffMember, body: string, correctsNoteId?: string, finalize = true) {
    const created = await call(
      who,
      "POST",
      `/consultations/${id}/notes`,
      { body, ...(correctsNoteId ? { correctsNoteId } : {}) },
      idem(),
    );
    expect(created.statusCode, created.body).toBe(201);
    const n = created.json().data;
    if (finalize) {
      const done = await call(
        who,
        "POST",
        `/consultations/${id}/notes/${n.id}/finalize`,
        undefined,
        at(n.version),
      );
      expect(done.statusCode, done.body).toBe(200);
    }
    return n.id as string;
  }

  const generate = (id: string, who = surgeon, headers = idem()) =>
    call(who, "POST", `/consultations/${id}/summary`, undefined, headers);

  /** A consultation in progress with a concern, two final notes and a photo session. */
  async function consultation(): Promise<{ id: string; first: string }> {
    const created = await call(
      surgeon,
      "POST",
      "/consultations",
      { practiceId: practice, reason: "Cheek volume loss", primaryProviderUserId: surgeon.userId },
      idem(),
    );
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().data.id as string;
    await move(id, "start");
    const concern = await call(
      surgeon,
      "POST",
      "/concerns",
      { area: "CHEEKS", description: "Volume loss at rest" },
      idem(),
    );
    expect(concern.statusCode, concern.body).toBe(201);
    const put = await call(
      surgeon,
      "PUT",
      `/consultations/${id}/concerns`,
      { concernIds: [concern.json().data.id] },
      at((await get(id)).version),
    );
    expect(put.statusCode, put.body).toBe(200);
    const first = await note(id, surgeon, "Examined both cheeks.");
    await note(id, nurse, "Discussed aftercare.");
    const photos = await fx.photography(org, patient, { capturedByUserId: surgeon.userId, release: false });
    await api.db.query(`UPDATE "PhotoSession" SET "consultationId" = $1, "practiceId" = $2 WHERE id = $3`, [
      id,
      practice,
      photos.photoSessionId,
    ]);
    return { id, first };
  }

  beforeAll(async () => {
    api = await startApi();
    fx = new Fixtures(api);
    org = await fx.organization();
    practice = await fx.practice(org);
    otherPractice = await fx.practice(org);
    patient = await fx.patient(org, { mrn: `MRN-${uuidv7().slice(-6)}` });
    surgeon = await fx.staff(org, "SURGEON_PHYSICIAN");
    nurse = await fx.staff(org, "NURSE_INJECTOR_AESTHETICIAN");
    elsewhere = await fx.staff(org, "NURSE_INJECTOR_AESTHETICIAN", { practiceId: otherPractice });
    await api.db.query(
      `INSERT INTO "ProviderProfile" (id, "organizationId", "userId", "displayName", credentials, "updatedAt")
      VALUES ($1, $2, $3, 'Dr Synthetic', 'MD', now())`,
      [uuidv7(), org, surgeon.userId],
    );
  });
  afterAll(async () => api?.close());

  it("is generated once submitted for review, holds final notes only, and meets CURRENT_SUMMARY", async () => {
    const { id } = await consultation();
    const early = await generate(id);
    expect(early.statusCode).toBe(409);
    await move(id, "submit-for-review");
    expect((await get(id)).unmetCompletionPreconditions).toEqual(["CURRENT_SUMMARY"]);
    const render = vi.mocked(summaryModule.renderSummary);
    render.mockClear();
    const key = idem();
    const res = await generate(id, surgeon, key);
    expect(res.statusCode, res.body).toBe(201);
    const doc = res.json().data;
    expect(doc).toMatchObject({
      type: "CONSULTATION_SUMMARY",
      title: "Consultation summary",
      consultationId: id,
      versions: [{ versionNumber: 1, status: "AVAILABLE" }],
    });
    const content = render.mock.calls[0]?.[0];
    expect(content).toMatchObject({
      patient: { name: expect.stringContaining("Synthetic"), mrn: expect.stringMatching(/^MRN-/) },
      consultation: { provider: "Dr Synthetic, MD", reason: "Cheek volume loss" },
      concerns: [{ area: "CHEEKS", description: "Volume loss at rest" }],
      photography: [{ protocol: "Fixture face", views: ["Front"] }],
      versionNumber: 1,
    });
    expect(content?.notes.map((n) => n.body)).toEqual(["Examined both cheeks.", "Discussed aftercare."]);
    // The stored file is the PDF the renderer produced, with no image in it.
    const url = await call(surgeon, "POST", `/documents/${doc.id}/access-urls`, {});
    const file = Buffer.from(await (await fetch(url.json().data.url)).arrayBuffer());
    expect(file.subarray(0, 5).toString()).toBe("%PDF-");
    expect(file.includes(Buffer.from("/Subtype /Image"))).toBe(false);
    expect(file.includes(Buffer.from("Inter-Regular"))).toBe(true);
    expect(doc.versions[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    // A replay returns the same document and adds no version.
    const replay = await generate(id, surgeon, key);
    expect(replay.json().data.versions).toHaveLength(1);
    expect((await get(id)).unmetCompletionPreconditions).toEqual([]);
    const audit = await api.db.query(
      `SELECT metadata FROM "AuditEvent" WHERE action = 'DOCUMENT_ADDED' AND "resourceId" = $1`,
      [doc.id],
    );
    expect(audit.rows).toEqual([
      { metadata: { type: "CONSULTATION_SUMMARY", versionNumber: 1, generated: true, consultationId: id } },
    ]);
    // Generating again under review adds a version to the same document.
    const second = await generate(id);
    expect(second.json().data.id).toBe(doc.id);
    expect(second.json().data.versions.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([
      2, 1,
    ]);
  });

  it("after completion, is generated again only after an addendum, which it shows under its note", async () => {
    const { id, first } = await consultation();
    await move(id, "submit-for-review");
    expect((await generate(id)).statusCode).toBe(201);
    await move(id, "complete", { releaseDecision: "NOTHING_TO_RELEASE" });
    const without = await generate(id);
    expect(without.statusCode).toBe(409);
    await note(id, surgeon, "Addendum: the left cheek, not the right.", first);
    // A draft addendum, which the summary leaves out.
    await note(id, nurse, "Draft: not yet reviewed.", first, false);
    const render = vi.mocked(summaryModule.renderSummary);
    render.mockClear();
    const after = await generate(id);
    expect(after.statusCode, after.body).toBe(201);
    const content = render.mock.calls[0]?.[0];
    expect(content?.notes[0]).toMatchObject({
      body: "Examined both cheeks.",
      addenda: [{ body: "Addendum: the left cheek, not the right." }],
    });
    expect(content?.versionNumber).toBe(2);
    expect(JSON.stringify(content)).not.toContain("Draft");
    expect((await generate(id)).statusCode).toBe(409);
  });

  it("needs consultation.edit within the consultation's practice", async () => {
    const { id } = await consultation();
    await move(id, "submit-for-review");
    const outside = await generate(id, elsewhere);
    expect(outside.statusCode).toBe(403);
    const draft = await call(surgeon, "POST", "/consultations", { practiceId: practice }, idem());
    expect((await generate(draft.json().data.id)).statusCode).toBe(409);
  });
});
