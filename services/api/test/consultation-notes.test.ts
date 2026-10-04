// Concerns, medical history and notes (Bible §5.1, §23.1; spec §6.3; UD-15;
// ADR-0026 K3-02, K3-06 to K3-08): clinical data never readable with
// patient.read alone, concerns selected while the content is open, notes
// drafted (also with a client ID) and finalized only by their author, final
// notes immutable and corrected by addenda, and audit events without text.
import { uuidv7 } from "@aestara/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseAvailable, startApi, type TestApi } from "./support/app.ts";
import { bearer, Fixtures, type StaffMember } from "./support/fixtures.ts";

describe.runIf(databaseAvailable())("concerns, history and notes (Layer 3)", () => {
  let api: TestApi;
  let fx: Fixtures;
  let org: string;
  let practice: string;
  let otherPractice: string;
  let patient: string;
  let surgeon: StaffMember;
  let nurse: StaffMember;
  let elsewhereNurse: StaffMember;
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
      url: `/api/v1/patients/${patient}${url}`,
      headers: { ...bearer(who), ...headers },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
  const idem = () => ({ "idempotency-key": crypto.randomUUID() });
  const at = (version: number) => ({ "if-match": `"v${version}"` });

  async function consultation(status: "DRAFT" | "IN_PROGRESS" = "IN_PROGRESS") {
    return fx.consultation(org, patient, practice, surgeon.userId, status);
  }

  async function note(who: StaffMember, consultationId: string, body: Record<string, unknown>) {
    return call(who, "POST", `/consultations/${consultationId}/notes`, body, idem());
  }

  async function textInAudit(text: string): Promise<boolean> {
    const rows = await api.db.query(`SELECT 1 FROM "AuditEvent" WHERE metadata::text ILIKE $1`, [
      `%${text}%`,
    ]);
    return (rows.rowCount ?? 0) > 0;
  }

  beforeAll(async () => {
    api = await startApi();
    fx = new Fixtures(api);
    org = await fx.organization();
    practice = await fx.practice(org);
    otherPractice = await fx.practice(org);
    patient = await fx.patient(org);
    surgeon = await fx.staff(org, "SURGEON_PHYSICIAN");
    nurse = await fx.staff(org, "NURSE_INJECTOR_AESTHETICIAN");
    elsewhereNurse = await fx.staff(org, "NURSE_INJECTOR_AESTHETICIAN", { practiceId: otherPractice });
    frontDesk = await fx.staff(org, "FRONT_DESK");
  });
  afterAll(async () => api?.close());

  describe("concerns (ADR-0026 K3-08)", () => {
    it("records a concern by area, resolves it, and audits without its description", async () => {
      const created = await call(
        nurse,
        "POST",
        "/concerns",
        { area: "LIPS", description: "Asymmetry of the upper lip" },
        idem(),
      );
      expect(created.statusCode, created.body).toBe(201);
      const c = created.json().data;
      expect(c).toMatchObject({ area: "LIPS", recordedById: nurse.userId, version: 1 });
      const resolved = await call(nurse, "PATCH", `/concerns/${c.id}`, { resolved: true }, at(1));
      expect(resolved.json().data.resolvedAt).toBeDefined();
      const open = await call(nurse, "GET", "/concerns?includeResolved=false");
      expect(open.json().data.map((x: { id: string }) => x.id)).not.toContain(c.id);
      expect(await textInAudit("Asymmetry")).toBe(false);
    });

    it("accepts only the registered areas", async () => {
      const res = await call(nurse, "POST", "/concerns", { area: "KNEES", description: "x" }, idem());
      expect(res.statusCode).toBe(400);
    });

    it("is clinical: patient.read alone neither lists nor finds it", async () => {
      expect((await call(frontDesk, "GET", "/concerns")).statusCode).toBe(403);
      expect((await call(frontDesk, "GET", "/medical-history")).statusCode).toBe(403);
    });

    it("is selected by a consultation while its content is open, then frozen", async () => {
      const lips = (
        await call(nurse, "POST", "/concerns", { area: "LIPS", description: "Volume" }, idem())
      ).json().data.id;
      const chin = (
        await call(nurse, "POST", "/concerns", { area: "CHIN", description: "Projection" }, idem())
      ).json().data.id;
      const cid = await consultation();
      const set = await call(surgeon, "PUT", `/consultations/${cid}/concerns`, { concernIds: [lips, chin] });
      expect(set.statusCode, set.body).toBe(200);
      expect(set.json().data.concernIds).toEqual([lips, chin]);
      expect(set.json().data.version).toBe(2);
      const narrowed = await call(surgeon, "PUT", `/consultations/${cid}/concerns`, { concernIds: [chin] });
      expect(narrowed.json().data.concernIds).toEqual([chin]);
      const unknown = await call(surgeon, "PUT", `/consultations/${cid}/concerns`, {
        concernIds: [uuidv7()],
      });
      expect(unknown.json().error.details.fieldErrors[0].code).toBe("UNKNOWN_CONCERN");
      const elsewhere = await call(elsewhereNurse, "PUT", `/consultations/${cid}/concerns`, {
        concernIds: [],
      });
      expect(elsewhere.statusCode).toBe(403);
      await call(surgeon, "POST", `/consultations/${cid}/submit-for-review`, undefined, at(3));
      const frozen = await call(surgeon, "PUT", `/consultations/${cid}/concerns`, { concernIds: [lips] });
      expect(frozen.statusCode).toBe(409);
    });
  });

  describe("medical history (ADR-0026 K3-08)", () => {
    it("records staff entries, corrects them with If-Match, never deletes them", async () => {
      const created = await call(
        nurse,
        "POST",
        "/medical-history",
        { category: "MEDICATION", description: "Isotretinoin", onsetDate: "2025-01-10" },
        idem(),
      );
      expect(created.statusCode, created.body).toBe(201);
      const h = created.json().data;
      expect(h).toMatchObject({
        category: "MEDICATION",
        source: "STAFF",
        onsetDate: "2025-01-10",
        version: 1,
      });
      const stale = await call(
        nurse,
        "PATCH",
        `/medical-history/${h.id}`,
        { resolvedOn: "2025-06-01" },
        at(9),
      );
      expect(stale.statusCode).toBe(412);
      const corrected = await call(
        nurse,
        "PATCH",
        `/medical-history/${h.id}`,
        { resolvedOn: "2025-06-01" },
        at(1),
      );
      expect(corrected.json().data).toMatchObject({ resolvedOn: "2025-06-01", version: 2 });
      const backwards = await call(
        nurse,
        "PATCH",
        `/medical-history/${h.id}`,
        { resolvedOn: "2024-01-01" },
        at(2),
      );
      expect(backwards.json().error.details.fieldErrors[0].code).toBe("BEFORE_ONSET");
      const listed = await call(nurse, "GET", "/medical-history?category=MEDICATION");
      expect(listed.json().data.map((x: { id: string }) => x.id)).toContain(h.id);
      expect(await textInAudit("Isotretinoin")).toBe(false);
      const del = await api.request({
        method: "DELETE",
        url: `/api/v1/patients/${patient}/medical-history/${h.id}`,
        headers: bearer(nurse),
      });
      expect(del.statusCode).toBe(404);
    });
  });

  describe("notes (UD-15; ADR-0026 K3-07)", () => {
    it("drafts, edits and finalizes a note by its author only, then never changes it", async () => {
      const cid = await consultation();
      const drafted = await note(surgeon, cid, { body: "Discussed lip volume options." });
      expect(drafted.statusCode, drafted.body).toBe(201);
      const n = drafted.json().data;
      expect(n).toMatchObject({ status: "DRAFT", authorUserId: surgeon.userId, version: 1 });
      const byOther = await call(
        nurse,
        "PATCH",
        `/consultations/${cid}/notes/${n.id}`,
        { body: "Mine" },
        at(1),
      );
      expect(byOther.statusCode).toBe(403);
      const edited = await call(
        surgeon,
        "PATCH",
        `/consultations/${cid}/notes/${n.id}`,
        { body: "Discussed lip volume and border options." },
        at(1),
      );
      expect(edited.json().data.version).toBe(2);
      const final = await call(
        surgeon,
        "POST",
        `/consultations/${cid}/notes/${n.id}/finalize`,
        undefined,
        at(2),
      );
      expect(final.statusCode, final.body).toBe(200);
      expect(final.json().data).toMatchObject({ status: "FINAL" });
      const change = await call(
        surgeon,
        "PATCH",
        `/consultations/${cid}/notes/${n.id}`,
        { body: "Later" },
        at(3),
      );
      expect(change.statusCode).toBe(409);
      expect(change.json().error.code).toBe("IMMUTABLE_RECORD");
      const discard = await call(surgeon, "DELETE", `/consultations/${cid}/notes/${n.id}`, undefined, at(3));
      expect(discard.statusCode).toBe(409);
      const events = await api.db.query<{ action: string; metadata: Record<string, unknown> }>(
        `SELECT action, metadata FROM "AuditEvent" WHERE "resourceId" = $1`,
        [n.id],
      );
      expect(events.rows).toEqual([
        { action: "CONSULTATION_NOTE_FINALIZED", metadata: { consultationId: cid, addendum: false } },
      ]);
      expect(await textInAudit("lip volume")).toBe(false);
    });

    it("discards one's own draft", async () => {
      const cid = await consultation();
      const n = (await note(surgeon, cid, { body: "Scratch" })).json().data;
      const res = await call(surgeon, "DELETE", `/consultations/${cid}/notes/${n.id}`, undefined, at(1));
      expect(res.statusCode).toBe(204);
      expect((await call(surgeon, "GET", `/consultations/${cid}/notes`)).json().data).toEqual([]);
    });

    it("accepts a client ID for a draft written offline, and replays its creation", async () => {
      const cid = await consultation();
      const id = uuidv7();
      const key = idem();
      const first = await call(surgeon, "POST", `/consultations/${cid}/notes`, { id, body: "Offline" }, key);
      const again = await call(surgeon, "POST", `/consultations/${cid}/notes`, { id, body: "Offline" }, key);
      expect(first.json().data.id).toBe(id);
      expect(again.statusCode).toBe(201);
      expect(again.json().data.id).toBe(id);
      const reused = await note(surgeon, cid, { id, body: "Another" });
      expect(reused.statusCode).toBe(409);
    });

    it("writes notes only once the consultation has started, and none under review", async () => {
      const draft = await consultation("DRAFT");
      expect((await note(surgeon, draft, { body: "Early" })).statusCode).toBe(409);
      const cid = await consultation();
      await call(surgeon, "POST", `/consultations/${cid}/submit-for-review`, undefined, at(1));
      const review = await note(surgeon, cid, { body: "Under review" });
      expect(review.statusCode).toBe(409);
      expect(review.json().error.message).toContain("under review");
    });

    it("needs a grant covering the consultation's practice", async () => {
      const cid = await consultation();
      expect((await note(elsewhereNurse, cid, { body: "Elsewhere" })).statusCode).toBe(403);
    });

    it("corrects a final note with an addendum, even after completion (UD-15)", async () => {
      const cid = await consultation();
      const n = (await note(surgeon, cid, { body: "Right side treated." })).json().data;
      await call(surgeon, "POST", `/consultations/${cid}/notes/${n.id}/finalize`, undefined, at(1));
      const draftTarget = (await note(surgeon, cid, { body: "Draft" })).json().data;
      const onDraft = await note(surgeon, cid, { body: "Fix", correctsNoteId: draftTarget.id });
      expect(onDraft.json().error.details.fieldErrors[0].code).toBe("NOT_A_FINAL_NOTE");
      await call(surgeon, "DELETE", `/consultations/${cid}/notes/${draftTarget.id}`, undefined, at(1));
      await api.db.query(`UPDATE "Consultation" SET reason = 'Lips' WHERE id = $1`, [cid]);
      await call(surgeon, "POST", `/consultations/${cid}/submit-for-review`, undefined, at(1));
      await api.db.query(
        `UPDATE "Consultation" SET status = 'COMPLETED', "completedAt" = now(), "completedById" = $2,
                "releaseDecision" = 'NOTHING_TO_RELEASE', "releaseDecidedAt" = now(), "releaseDecidedById" = $2
          WHERE id = $1`,
        [cid, surgeon.userId],
      );
      const plain = await note(surgeon, cid, { body: "New thought" });
      expect(plain.statusCode).toBe(409);
      expect(plain.json().error.message).toContain("addendum");
      const addendum = await note(surgeon, cid, {
        body: "Correction: left side treated.",
        correctsNoteId: n.id,
      });
      expect(addendum.statusCode, addendum.body).toBe(201);
      const a = addendum.json().data;
      expect(a).toMatchObject({ correctsNoteId: n.id, status: "DRAFT" });
      const final = await call(
        surgeon,
        "POST",
        `/consultations/${cid}/notes/${a.id}/finalize`,
        undefined,
        at(1),
      );
      expect(final.json().data.status).toBe("FINAL");
      const listed = (await call(surgeon, "GET", `/consultations/${cid}/notes`)).json().data;
      expect(listed.map((x: { id: string }) => x.id)).toEqual([n.id, a.id]);
    });

    it("never shows a note through another consultation", async () => {
      const cid = await consultation();
      const other = await consultation();
      const n = (await note(surgeon, cid, { body: "Here" })).json().data;
      const res = await call(
        surgeon,
        "PATCH",
        `/consultations/${other}/notes/${n.id}`,
        { body: "There" },
        at(1),
      );
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("CONSULTATION_NOTE_NOT_FOUND");
    });
  });
});
