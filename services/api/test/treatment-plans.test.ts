// Treatment plans A/B/C and the in-clinic response (Bible §11; spec §5.4.3,
// §6.3; UD-14, UD-31; ADR-0028 K4-04 to K4-07, K4-13, K4-22; ADR-0029):
// server-computed totals, the Layer 4 machine, practice-scoped changes, and the
// hand-off in which the patient accepts or declines, declining the siblings.
import { NOT_CONSENT_NOTICE, PLAN_RESPONSE_ATTESTATIONS } from "@aestara/api-contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseAvailable, startApi, type TestApi } from "./support/app.ts";
import { bearer, Fixtures, type StaffMember } from "./support/fixtures.ts";

describe.runIf(databaseAvailable())("treatment plans (Layer 4)", () => {
  let api: TestApi;
  let fx: Fixtures;
  let org: string;
  let practice: string;
  let otherPractice: string;
  let location: string;
  let patient: string;
  let consultation: string;
  let filler: string;
  let unpriced: string;
  let retired: string;
  let surgeon: StaffMember;
  let consultant: StaffMember;
  let elsewhere: StaffMember;
  let atLocation: StaffMember;
  let nurse: StaffMember;

  const call = (
    who: StaffMember | { accessToken: string },
    method: string,
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) =>
    api.request({
      method: method as "GET",
      url: url.startsWith("/handoff") ? `/api/v1${url}` : `/api/v1/patients/${patient}${url}`,
      headers: { ...bearer(who), ...headers },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
  const v = (version: number) => ({ "if-match": `"v${version}"` });
  const idem = () => ({ "idempotency-key": crypto.randomUUID() });

  type Plan = {
    id: string;
    version: number;
    status: string;
    optionLabel?: string;
    estimatedTotal: { amount: string };
  };

  async function option(body: Record<string, unknown> = {}, who = surgeon): Promise<Plan> {
    const res = await call(
      who,
      "POST",
      "/treatment-plans",
      { consultationId: consultation, title: "Lips", ...body },
      idem(),
    );
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data;
  }

  async function items(plan: Plan, list: unknown[], who = surgeon): Promise<Plan> {
    const res = await call(who, "PUT", `/treatment-plans/${plan.id}/items`, { items: list }, v(plan.version));
    expect(res.statusCode, res.body).toBe(200);
    return res.json().data;
  }

  async function act(plan: Plan, action: string, body?: unknown, who = surgeon): Promise<Plan> {
    const res = await call(who, "POST", `/treatment-plans/${plan.id}/${action}`, body, v(plan.version));
    expect(res.statusCode, res.body).toBe(200);
    return res.json().data;
  }

  async function proposed(body: Record<string, unknown> = {}): Promise<Plan> {
    const draft = await option(body);
    return act(await items(draft, [{ treatmentId: filler }]), "propose");
  }

  async function openHandoff(plan: Plan, who = consultant) {
    const res = await call(
      who,
      "POST",
      `/treatment-plans/${plan.id}/record-response`,
      { identityConfirmed: true },
      v(plan.version),
    );
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data as { handoffId: string; token: string; idleTimeoutSeconds: number };
  }

  const audits = async (resourceId: string) =>
    (
      await api.db.query<{ actorType: string; actorUserId: string | null; metadata: Record<string, string> }>(
        `SELECT "actorType", "actorUserId", metadata FROM "AuditEvent"
         WHERE "resourceId" = $1 AND action = 'TREATMENT_PLAN_STATUS_CHANGED' ORDER BY "occurredAt", id`,
        [resourceId],
      )
    ).rows;

  beforeAll(async () => {
    api = await startApi();
    fx = new Fixtures(api);
    org = await fx.organization();
    practice = await fx.practice(org);
    otherPractice = await fx.practice(org);
    location = await fx.location(org, practice);
    patient = await fx.patient(org, { mrn: "PLAN-1" });
    surgeon = await fx.staff(org, "SURGEON_PHYSICIAN");
    consultant = await fx.staff(org, "CONSULTANT");
    nurse = await fx.staff(org, "NURSE_INJECTOR_AESTHETICIAN", { practiceId: practice });
    elsewhere = await fx.staff(org, "SURGEON_PHYSICIAN", { practiceId: otherPractice });
    atLocation = await fx.staff(org, "SURGEON_PHYSICIAN", { practiceId: practice, locationId: location });
    consultation = await fx.consultation(org, patient, practice, surgeon.userId, "IN_PROGRESS");
    const catalog = await fx.treatmentCatalog(org);
    filler = catalog.treatmentId;
    unpriced = (
      await api.db.query<{ id: string }>(
        `INSERT INTO "Treatment" (id, "organizationId", "categoryId", name, "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, 'Consultation-priced', now()) RETURNING id`,
        [org, catalog.treatmentCategoryId],
      )
    ).rows[0]?.id as string;
    retired = (
      await api.db.query<{ id: string }>(
        `INSERT INTO "Treatment" (id, "organizationId", "categoryId", name, status, "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, 'Old', 'INACTIVE', now()) RETURNING id`,
        [org, catalog.treatmentCategoryId],
      )
    ).rows[0]?.id as string;
  });
  afterAll(async () => api?.close());

  it("lettering the options of a consultation, and naming the practice of a standalone one", async () => {
    const a = await option();
    const b = await option({ title: "Lips, staged" });
    expect([a.optionLabel, b.optionLabel]).toEqual(["Plan A", "Plan B"]);
    expect(a).toMatchObject({ status: "DRAFT", notConsentNotice: NOT_CONSENT_NOTICE, items: [] });

    const missing = await call(surgeon, "POST", "/treatment-plans", { title: "Alone" }, idem());
    expect(missing.statusCode).toBe(400);
    const alone = await call(
      surgeon,
      "POST",
      "/treatment-plans",
      { title: "Alone", practiceId: practice },
      idem(),
    );
    expect(alone.statusCode, alone.body).toBe(201);
    expect(alone.json().data).not.toHaveProperty("optionLabel");
    expect(alone.json().data).not.toHaveProperty("consultationId");
  });

  it("computes every line and total on the server, in cents, rounding half up", async () => {
    const plan = await items(await option(), [
      { treatmentId: filler, quantity: "1.5", unitPrice: { amount: "333.33", currency: "USD" } },
      { treatmentId: filler, area: "Upper lip", discountAmount: { amount: "50.00", currency: "USD" } },
    ]);
    expect(plan).toMatchObject({
      subtotal: { amount: "950.00", currency: "USD" },
      discountTotal: { amount: "50.00" },
      estimatedTotal: { amount: "900.00" },
      items: [
        {
          quantity: "1.50",
          unitPrice: { amount: "333.33" },
          lineTotal: { amount: "500.00" },
          treatmentName: "Lip filler",
        },
        {
          quantity: "1.00",
          unitPrice: { amount: "450.00" },
          lineTotal: { amount: "400.00" },
          area: "Upper lip",
        },
      ],
    });

    const bad = async (item: Record<string, unknown>, code: string) => {
      const res = await call(
        surgeon,
        "PUT",
        `/treatment-plans/${plan.id}/items`,
        { items: [item] },
        v(plan.version),
      );
      expect(res.statusCode, res.body).toBe(400);
      expect(res.json().error.details.fieldErrors[0].code).toBe(code);
    };
    await bad({ treatmentId: retired }, "UNKNOWN_TREATMENT");
    await bad({ treatmentId: unpriced }, "REQUIRED");
    await bad(
      { treatmentId: filler, discountAmount: { amount: "450.01", currency: "USD" } },
      "DISCOUNT_TOO_LARGE",
    );
    const float = await call(
      surgeon,
      "PUT",
      `/treatment-plans/${plan.id}/items`,
      { items: [{ treatmentId: filler, unitPrice: { amount: 12.5, currency: "USD" } }] },
      v(plan.version),
    );
    expect(float.statusCode).toBe(400);
  });

  it("changes only a draft, proposes with items, and revises a proposal", async () => {
    const draft = await option();
    const empty = await call(
      surgeon,
      "POST",
      `/treatment-plans/${draft.id}/propose`,
      undefined,
      v(draft.version),
    );
    expect(empty.statusCode).toBe(409);

    const plan = await act(await items(draft, [{ treatmentId: filler }]), "propose");
    expect(plan.status).toBe("PROPOSED");
    const frozen = await call(
      surgeon,
      "PATCH",
      `/treatment-plans/${plan.id}`,
      { title: "Other" },
      v(plan.version),
    );
    expect(frozen.statusCode).toBe(409);
    expect(frozen.json().error.message).toMatch(/Revise/);

    const revised = await act(plan, "revise");
    expect(revised.status).toBe("DRAFT");
    const renamed = await call(
      surgeon,
      "PATCH",
      `/treatment-plans/${plan.id}`,
      { title: "Lips and chin" },
      v(revised.version),
    );
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect((await audits(plan.id)).map((r) => `${r.metadata.statusFrom}>${r.metadata.statusTo}`)).toEqual([
      "DRAFT>PROPOSED",
      "PROPOSED>DRAFT",
    ]);
  });

  it("discards a draft with a reason it never audits", async () => {
    const draft = await option();
    const cancelled = await act(draft, "cancel", { reason: "Patient prefers another option" });
    expect(cancelled).toMatchObject({
      status: "CANCELLED",
      cancellationReason: "Patient prefers another option",
    });
    const rows = await audits(draft.id);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("prefers");
  });

  it("is changed only through a grant covering its practice; a location grant reads but never changes", async () => {
    const plan = await option();
    expect((await call(elsewhere, "GET", `/treatment-plans/${plan.id}`)).statusCode).toBe(200);
    expect((await call(atLocation, "GET", "/treatment-plans")).statusCode).toBe(200);
    for (const who of [elsewhere, atLocation]) {
      const res = await call(who, "PATCH", `/treatment-plans/${plan.id}`, { title: "No" }, v(plan.version));
      expect(res.statusCode).toBe(403);
    }
    const created = await call(
      elsewhere,
      "POST",
      "/treatment-plans",
      { consultationId: consultation, title: "No" },
      idem(),
    );
    expect(created.statusCode).toBe(403);
    // The nurse holds treatmentplan.edit but not treatmentplan.send (spec §4.5).
    const proposal = await proposed();
    const open = await call(
      nurse,
      "POST",
      `/treatment-plans/${proposal.id}/record-response`,
      { identityConfirmed: true },
      v(proposal.version),
    );
    expect(open.statusCode).toBe(403);
  });

  describe("the in-clinic response (UD-14, UD-31)", () => {
    it("lets the patient accept in a hand-off, declining the other shown options but not the drafts", async () => {
      const c = await fx.consultation(org, patient, practice, surgeon.userId, "IN_PROGRESS");
      const a = await proposed({ consultationId: c });
      const b = await proposed({ consultationId: c, title: "Staged" });
      const draft = await option({ consultationId: c, title: "Draft" });
      const h = await openHandoff(a);
      expect(h.idleTimeoutSeconds).toBe(900);
      const patientSide = { accessToken: h.token };

      const view = await call(patientSide, "GET", "/handoff");
      expect(view.statusCode, view.body).toBe(200);
      expect(view.json().data).toMatchObject({
        purpose: "PLAN_RESPONSE",
        patient: { dateOfBirth: expect.any(String) },
        plan: {
          optionLabel: "Plan A",
          estimatedTotal: { amount: "450.00" },
          notConsentNotice: NOT_CONSENT_NOTICE,
          attestations: PLAN_RESPONSE_ATTESTATIONS,
        },
      });

      // The token reaches only hand-off routes, and staff tokens never reach them.
      expect((await call(patientSide, "GET", "/treatment-plans")).statusCode).toBe(401);
      expect((await call(consultant, "GET", "/handoff")).statusCode).toBe(401);

      const changed = await call(
        patientSide,
        "POST",
        "/handoff/plan-response",
        { decision: "ACCEPTED", signerName: "Ann Lee", attestation: "I accept." },
        idem(),
      );
      expect(changed.statusCode).toBe(400);
      expect(changed.json().error.details.fieldErrors[0].code).toBe("ATTESTATION_CHANGED");

      const key = idem();
      const body = {
        decision: "ACCEPTED",
        signerName: "Ann Lee",
        attestation: PLAN_RESPONSE_ATTESTATIONS.ACCEPTED,
      };
      const res = await call(patientSide, "POST", "/handoff/plan-response", body, key);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data).toMatchObject({ decision: "ACCEPTED", declinedSiblingIds: [b.id] });

      const accepted = (await call(surgeon, "GET", `/treatment-plans/${a.id}`)).json().data;
      expect(accepted).toMatchObject({
        status: "ACCEPTED",
        response: {
          source: "IN_CLINIC",
          signerName: "Ann Lee",
          attestation: body.attestation,
          handoffId: h.handoffId,
        },
      });
      expect((await call(surgeon, "GET", `/treatment-plans/${b.id}`)).json().data).toMatchObject({
        status: "DECLINED",
        response: { source: "SIBLING_ACCEPTED", acceptedSiblingId: a.id },
      });
      expect((await call(surgeon, "GET", `/treatment-plans/${draft.id}`)).json().data.status).toBe("DRAFT");

      // The patient acted in a hand-off the consultant opened; the sibling's decline is the system's.
      const own = (await audits(a.id))[1];
      expect(own).toMatchObject({
        actorType: "USER",
        actorUserId: consultant.userId,
        metadata: {
          statusFrom: "PROPOSED",
          statusTo: "ACCEPTED",
          channel: "IN_CLINIC",
          handoffId: h.handoffId,
        },
      });
      expect(JSON.stringify(own)).not.toContain("Ann Lee");
      expect((await audits(b.id))[1]).toMatchObject({
        actorType: "SYSTEM",
        actorUserId: null,
        metadata: { statusTo: "DECLINED", reason: "SIBLING_ACCEPTED", acceptedPlanId: a.id },
      });

      // Responding ended the hand-off.
      expect((await call(patientSide, "GET", "/handoff")).statusCode).toBe(401);
    });

    it("records a decline without touching other options; an option without a consultation has no siblings", async () => {
      const lone = await proposed({ consultationId: undefined, practiceId: practice });
      const h = await openHandoff(lone);
      const res = await call(
        { accessToken: h.token },
        "POST",
        "/handoff/plan-response",
        { decision: "DECLINED", signerName: "Ann Lee", attestation: PLAN_RESPONSE_ATTESTATIONS.DECLINED },
        idem(),
      );
      expect(res.json().data).toMatchObject({ decision: "DECLINED", declinedSiblingIds: [] });
    });

    it("ends after 15 idle minutes, when reopened, when its opener ends it, and only for its opener", async () => {
      const plan = await proposed();
      const first = await openHandoff(plan);
      const second = await openHandoff(plan);
      expect((await call({ accessToken: first.token }, "GET", "/handoff")).statusCode).toBe(401);
      expect((await call({ accessToken: second.token }, "GET", "/handoff")).statusCode).toBe(200);

      const notMine = await api.request({
        method: "POST",
        url: `/api/v1/handoffs/${second.handoffId}/end`,
        headers: bearer(surgeon),
      });
      expect(notMine.statusCode).toBe(404);
      const ended = await api.request({
        method: "POST",
        url: `/api/v1/handoffs/${second.handoffId}/end`,
        headers: bearer(consultant),
      });
      expect(ended.statusCode).toBe(204);
      expect((await call({ accessToken: second.token }, "GET", "/handoff")).statusCode).toBe(401);

      const third = await openHandoff(plan);
      // Age the hand-off by 16 minutes; its triggers rightly refuse rewriting when it opened.
      await api.db.query(
        `SET session_replication_role = replica;
         UPDATE "PatientHandoff" SET "lastActivityAt" = "lastActivityAt" - interval '16 minutes',
                "openedAt" = "openedAt" - interval '16 minutes',
                "identityConfirmedAt" = "identityConfirmedAt" - interval '16 minutes',
                "absoluteExpiresAt" = "absoluteExpiresAt" - interval '16 minutes'
          WHERE id = '${third.handoffId}';
         SET session_replication_role = DEFAULT;`,
      );
      expect((await call({ accessToken: third.token }, "GET", "/handoff")).statusCode).toBe(401);

      const rows = await api.db.query<{ endReason: string | null }>(
        `SELECT "endReason" FROM "PatientHandoff" WHERE "treatmentPlanId" = $1 ORDER BY "openedAt"`,
        [plan.id],
      );
      expect(rows.rows.map((r) => r.endReason).sort()).toEqual(["EXITED", "REVOKED", null].sort());
      const forged = `${third.token.slice(0, -4)}AAAA`;
      expect((await call({ accessToken: forged }, "GET", "/handoff")).statusCode).toBe(401);
    });

    it("opens only for a proposed option, from a registered device", async () => {
      const draft = await option();
      const res = await call(
        consultant,
        "POST",
        `/treatment-plans/${draft.id}/record-response`,
        { identityConfirmed: true },
        v(draft.version),
      );
      expect(res.statusCode).toBe(409);
      const plan = await proposed();
      const confirm = await call(
        consultant,
        "POST",
        `/treatment-plans/${plan.id}/record-response`,
        { identityConfirmed: false },
        v(plan.version),
      );
      expect(confirm.statusCode).toBe(400);
    });
  });
});
