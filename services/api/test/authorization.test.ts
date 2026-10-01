// Contract, authorization and cross-tenant tests generated from the endpoint
// registry (spec §6.8, §7.5; roadmap M1.4; Bible §27.1). For every operation:
//   - without a token: 401 and the error envelope
//   - by a member without the permission: 403, or 404 when the resource is
//     not visible, never success
//   - with another organization's identifiers: the generic 404, never data
//   - required Idempotency-Key and If-Match headers are enforced
import { ENDPOINTS, type EndpointDefinition, errorStatuses, RequestId } from "@aestara/api-contracts";
import { catalogId, uuidv7 } from "@aestara/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { databaseAvailable, startApi, type TestApi } from "./support/app.ts";
import { bearer, Fixtures, type StaffMember } from "./support/fixtures.ts";
import { bodyFor, headersFor, pathFor, type ResourceRefs } from "./support/requests.ts";

const all: readonly EndpointDefinition[] = ENDPOINTS;
const authenticated = all.filter((e) => e.auth.kind === "session" || e.auth.kind === "permission");
const organizationScoped = all.filter(
  (e) => e.auth.kind === "permission" && e.auth.scopes.includes("organization"),
);
const platformOnly = all.filter(
  (e) => e.auth.kind === "permission" && e.auth.scopes.length === 1 && e.auth.scopes[0] === "platform",
);

async function world(
  api: TestApi,
  fx: Fixtures,
): Promise<{ refs: ResourceRefs; admin: StaffMember; member: StaffMember }> {
  const organizationId = await fx.organization();
  const practiceId = await fx.practice(organizationId);
  const locationId = await fx.location(organizationId, practiceId);
  const patientId = await fx.patient(organizationId, { mrn: `MRN-${uuidv7().slice(-6)}` });
  const contactId = uuidv7();
  await api.db.query(
    `INSERT INTO "PatientContact" (id, "organizationId", "patientId", kind, "fullName", "updatedAt") VALUES ($1, $2, $3, 'OTHER', 'Contact', now())`,
    [contactId, organizationId, patientId],
  );
  const member = await fx.staff(organizationId, "FRONT_DESK");
  const assignment = await api.db.query<{ id: string }>(`SELECT id FROM "UserRole" WHERE "userId" = $1`, [
    member.userId,
  ]);
  for (const table of ["ProviderProfile", "StaffProfile"])
    await api.db.query(
      `INSERT INTO "${table}" (id, "organizationId", "userId", "displayName", "updatedAt") VALUES ($1, $2, $3, 'Profile', now())`,
      [uuidv7(), organizationId, member.userId],
    );
  const factorId = uuidv7();
  await api.db.query(
    `INSERT INTO "UserCredential" (id, "userId", type, "totpSecretCiphertext", "confirmedAt") VALUES ($1, $2, 'TOTP', '\\x00', now())`,
    [factorId, member.userId],
  );
  const auditEventId = uuidv7();
  await api.db.query(
    `INSERT INTO "AuditEvent" (id, "organizationId", "actorType", action, "resourceType", "requestId") VALUES ($1, $2, 'SYSTEM', 'CONFIGURATION_CHANGED', 'Organization', 'seed')`,
    [auditEventId, organizationId],
  );
  const admin = await fx.staff(organizationId, "ORGANIZATION_ADMIN");
  await fx.grant(admin.userId, "SURGEON_PHYSICIAN", { organizationId });
  await fx.grant(admin.userId, "PRACTICE_ADMIN", { organizationId });
  return {
    admin,
    member,
    refs: {
      organizationId,
      practiceId,
      locationId,
      patientId,
      contactId,
      userId: member.userId,
      assignmentId: assignment.rows[0]?.id ?? "",
      auditEventId,
      sessionId: member.sessionId,
      factorId,
    },
  };
}

describe.runIf(databaseAvailable())("authorization generated from the endpoint registry", () => {
  let api: TestApi;
  let fx: Fixtures;
  let a: Awaited<ReturnType<typeof world>>;
  let b: Awaited<ReturnType<typeof world>>;
  let marketing: StaffMember;
  let operator: StaffMember;

  beforeAll(async () => {
    api = await startApi();
    fx = new Fixtures(api);
    a = await world(api, fx);
    b = await world(api, fx);
    marketing = await fx.staff(a.refs.organizationId, "MARKETING");
    operator = await fx.platformOperator();
  });
  afterAll(async () => api?.close());

  const call = (
    e: EndpointDefinition,
    refs: ResourceRefs,
    who?: { accessToken: string },
    extra: Record<string, string> = {},
  ) => {
    const body = bodyFor(e, refs);
    return api.request({
      method: e.method,
      url: pathFor(e, refs),
      headers: { ...(who ? bearer(who) : {}), ...headersFor(e), ...extra },
      ...(body !== undefined ? { payload: body } : {}),
    });
  };

  describe("without a token", () => {
    for (const e of authenticated)
      it(`${e.operationId} → 401`, async () => {
        const res = await call(e, a.refs);
        expect(res.statusCode).toBe(401);
        expect(res.json().error.code).toBe("UNAUTHENTICATED");
        expect(RequestId.safeParse(res.json().error.requestId).success).toBe(true);
        expect(res.headers["x-request-id"]).toBe(res.json().error.requestId);
      });
  });

  describe("by a member without the permission", () => {
    for (const e of organizationScoped)
      it(`${e.operationId} → 403 or 404, never success`, async () => {
        const res = await call(e, a.refs, marketing);
        expect([403, 404], res.body).toContain(res.statusCode);
        if (res.statusCode === 404) expect(res.json().error.code).toBe(e.notFound);
        else expect(res.json().error.code).toBe("PERMISSION_DENIED");
        expect(errorStatuses(e)).toContain(res.statusCode);
      });

    for (const e of platformOnly)
      it(`${e.operationId} (platform only) → refused for an organization administrator`, async () => {
        const res = await call(e, a.refs, a.admin);
        expect([403, 404], res.body).toContain(res.statusCode);
      });
  });

  describe("with another organization's identifiers", () => {
    const crossTenant = organizationScoped.filter(
      (e) => e.params !== undefined && !e.path.startsWith("/roles") && !e.path.startsWith("/settings"),
    );
    for (const e of crossTenant)
      it(`${e.operationId} → ${e.notFound}`, async () => {
        const res = await call(e, b.refs, a.admin);
        expect(res.statusCode, res.body).toBe(404);
        expect(res.json().error.code).toMatch(/_NOT_FOUND$/);
        expect(res.body).not.toContain("Synthetic");
      });

    it("revokeOwnSession with another user's session → 404", async () => {
      const res = await api.request({
        method: "DELETE",
        url: `/api/v1/auth/sessions/${b.refs.sessionId}`,
        headers: bearer(a.admin),
      });
      expect(res.statusCode).toBe(404);
    });

    it("cannot reference another organization's practice in a body", async () => {
      const location = await api.request({
        method: "POST",
        url: "/api/v1/locations",
        headers: bearer(a.admin),
        payload: { practiceId: b.refs.practiceId, name: "Elsewhere", timezone: "UTC" },
      });
      expect(location.statusCode).toBe(404);
      const patient = await api.request({
        method: "POST",
        url: "/api/v1/patients",
        headers: { ...bearer(a.admin), "idempotency-key": crypto.randomUUID() },
        payload: {
          firstName: "Cy",
          lastName: "Tenant",
          dateOfBirth: "1970-01-01",
          primaryPracticeId: b.refs.practiceId,
          confirmNoDuplicate: true,
        },
      });
      expect(patient.statusCode).toBe(400);
      const grant = await api.request({
        method: "POST",
        url: `/api/v1/users/${a.refs.userId}/role-assignments`,
        headers: bearer(a.admin),
        payload: {
          roleId: catalogId("role", "CONSULTANT"),
          scope: "PRACTICE",
          practiceId: b.refs.practiceId,
        },
      });
      expect(grant.statusCode).toBe(400);
    });

    it("never lists or finds another organization's patients", async () => {
      const search = await api.request({
        method: "POST",
        url: "/api/v1/patients/search",
        headers: bearer(a.admin),
        payload: { name: "Synthetic" },
      });
      const ids = search.json().data.map((p: { id: string }) => p.id);
      expect(ids).toContain(a.refs.patientId);
      expect(ids).not.toContain(b.refs.patientId);
      const audit = await api.request({
        method: "GET",
        url: "/api/v1/audit/events?limit=100",
        headers: bearer(a.admin),
      });
      expect(audit.json().data.map((e: { id: string }) => e.id)).not.toContain(b.refs.auditEventId);
    });
  });

  describe("headers", () => {
    for (const e of all.filter((x) => x.idempotency === "required" && x.auth.kind === "permission"))
      it(`${e.operationId} without Idempotency-Key → 400`, async () => {
        const body = bodyFor(e, a.refs);
        const res = await api.request({
          method: e.method,
          url: pathFor(e, a.refs),
          headers: bearer(
            e.auth.kind === "permission" && e.auth.scopes[0] === "platform" ? operator : a.admin,
          ),
          ...(body ? { payload: body } : {}),
        });
        expect(res.statusCode, res.body).toBe(400);
        expect(res.json().error.details.fieldErrors[0].path).toBe("Idempotency-Key");
      });

    for (const e of all.filter((x) => x.ifMatch === "required" && x.auth.kind === "permission"))
      it(`${e.operationId} without If-Match → 428`, async () => {
        const body = bodyFor(e, a.refs);
        const res = await api.request({
          method: e.method,
          url: pathFor(e, a.refs),
          headers: bearer(a.admin),
          ...(body ? { payload: body } : {}),
        });
        expect(res.statusCode, res.body).toBe(428);
        expect(res.json().error.code).toBe("PRECONDITION_REQUIRED");
      });
  });

  describe("ACCESS_DENIED (ADR-0018 K-10)", () => {
    it("audits refused patient access once per minute, then counts repeats", async () => {
      const e = all.find((x) => x.operationId === "getPatient") as EndpointDefinition;
      const denials = async () =>
        (
          await api.db.query(
            `SELECT outcome, "patientId", metadata FROM "AuditEvent"
              WHERE action = 'ACCESS_DENIED' AND "actorUserId" = $1 AND metadata->>'operationId' = 'getPatient'
              ORDER BY "occurredAt"`,
            [marketing.userId],
          )
        ).rows;
      for (let i = 0; i < 3; i++) expect((await call(e, a.refs, marketing)).statusCode).toBe(404);
      const first = await denials();
      expect(first).toHaveLength(1);
      expect(first[0]).toMatchObject({ outcome: "DENIED", patientId: a.refs.patientId });
      expect(first[0].metadata).toMatchObject({ operationId: "getPatient", permission: "patient.read" });
      const realNow = Date.now;
      const later = realNow() + 61_000;
      vi.spyOn(Date, "now").mockImplementation(() => later);
      try {
        await call(e, a.refs, marketing);
      } finally {
        vi.restoreAllMocks();
      }
      const after = await denials();
      expect(after).toHaveLength(2);
      expect(after[1].metadata.suppressedRepeats).toBeGreaterThanOrEqual(3);
    });
  });

  describe("platform reach (ADR-0018 K-06)", () => {
    it("an operator reaches organization metadata but no patient route", async () => {
      expect(
        (await api.request({ method: "GET", url: "/api/v1/organizations", headers: bearer(operator) }))
          .statusCode,
      ).toBe(200);
      expect(
        (
          await api.request({
            method: "GET",
            url: `/api/v1/organizations/${a.refs.organizationId}`,
            headers: bearer(operator),
          })
        ).statusCode,
      ).toBe(200);
      for (const e of all.filter((x) => x.path.startsWith("/patients"))) {
        const res = await call(e, a.refs, operator);
        expect([403], `${e.operationId}: ${res.body}`).toContain(res.statusCode);
      }
    });
  });
});
