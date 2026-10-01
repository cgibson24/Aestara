// Every Bible §32 audit event, and the Layer 1 additions of spec §6.4, written
// by the action that causes it (Bible §32 #10; TESTING_STRATEGY.md §18.1).
// Each assertion names the action, the outcome, the actor and the resource,
// and patient events carry no demographics in their metadata (SR-PHI).
import { catalogId } from "@aestara/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseAvailable, startApi, type TestApi } from "./support/app.ts";
import { bearer, DEVICE, Fixtures, PASSWORD, type StaffMember, signIn } from "./support/fixtures.ts";

interface Row {
  action: string;
  outcome: string;
  actorUserId: string | null;
  organizationId: string | null;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
}

describe.runIf(databaseAvailable())("audit events (Bible §32 #10)", () => {
  let api: TestApi;
  let fx: Fixtures;
  let org: string;
  let admin: StaffMember;
  let provider: StaffMember;

  beforeAll(async () => {
    api = await startApi();
    fx = new Fixtures(api);
    org = await fx.organization();
    admin = await fx.staff(org, "ORGANIZATION_ADMIN");
    provider = await fx.staff(org, "SURGEON_PHYSICIAN");
  });
  afterAll(async () => api?.close());

  /** The audit rows for an action, optionally narrowed to a resource or an actor. */
  async function audited(action: string, by: { resourceId?: string; actorUserId?: string } = {}) {
    const res = await api.db.query<Row>(
      `SELECT action, outcome, "actorUserId", "organizationId", "resourceType", "resourceId", metadata
         FROM "AuditEvent"
        WHERE action = $1::"AuditAction"
          AND ($2::text IS NULL OR "resourceId"::text = $2)
          AND ($3::text IS NULL OR "actorUserId"::text = $3)`,
      [action, by.resourceId ?? null, by.actorUserId ?? null],
    );
    expect(res.rows.length, `${action} was not audited`).toBeGreaterThan(0);
    return res.rows;
  }

  it("LOGIN_SUCCESS and LOGIN_FAILURE", async () => {
    const [success] = await audited("LOGIN_SUCCESS", { actorUserId: provider.userId });
    expect(success).toMatchObject({ outcome: "SUCCESS", organizationId: org });
    const wrong = await api.request({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: provider.email,
        password: `${PASSWORD} nope`,
        clientApp: "IOS_PROVIDER",
        device: DEVICE,
      },
    });
    expect(wrong.statusCode).toBe(401);
    const [failure] = await audited("LOGIN_FAILURE", { actorUserId: provider.userId });
    expect(failure?.outcome).toBe("FAILURE");
  });

  it("PATIENT_CREATED, PATIENT_VIEWED, PATIENT_UPDATED and PATIENT_ARCHIVED, without demographics", async () => {
    const created = await api.request({
      method: "POST",
      url: "/api/v1/patients",
      headers: { ...bearer(provider), "idempotency-key": crypto.randomUUID() },
      payload: {
        firstName: "Imogen",
        lastName: "Vantablack",
        dateOfBirth: "1979-02-03",
        confirmNoDuplicate: true,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().data.id as string;
    const open = await api.request({
      method: "GET",
      url: `/api/v1/patients/${id}`,
      headers: bearer(provider),
    });
    expect(open.statusCode).toBe(200);
    const updated = await api.request({
      method: "PATCH",
      url: `/api/v1/patients/${id}`,
      headers: { ...bearer(provider), "if-match": '"v1"' },
      payload: { preferredName: "Immy" },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    const archived = await api.request({
      method: "POST",
      url: `/api/v1/patients/${id}/archive`,
      headers: { ...bearer(provider), "if-match": '"v2"' },
    });
    expect(archived.statusCode, archived.body).toBe(200);

    for (const action of ["PATIENT_CREATED", "PATIENT_VIEWED", "PATIENT_UPDATED", "PATIENT_ARCHIVED"]) {
      const [row] = await audited(action, { resourceId: id });
      expect(row).toMatchObject({
        outcome: "SUCCESS",
        actorUserId: provider.userId,
        organizationId: org,
        resourceType: "Patient",
      });
      const metadata = JSON.stringify(row?.metadata ?? {});
      for (const phi of ["Imogen", "Vantablack", "Immy", "1979-02-03"]) expect(metadata).not.toContain(phi);
    }
  });

  it("USER_CREATED, USER_UPDATED, ROLE_ASSIGNED, ROLE_REVOKED and USER_DISABLED", async () => {
    const invited = await api.request({
      method: "POST",
      url: "/api/v1/users",
      headers: { ...bearer(admin), "idempotency-key": crypto.randomUUID() },
      payload: { email: `audit.${crypto.randomUUID()}@example.test`, displayName: "Audit Target" },
    });
    expect(invited.statusCode, invited.body).toBe(201);
    const userId = invited.json().data.id as string;

    const current = await api.request({
      method: "GET",
      url: `/api/v1/users/${userId}`,
      headers: bearer(admin),
    });
    const renamed = await api.request({
      method: "PATCH",
      url: `/api/v1/users/${userId}`,
      headers: { ...bearer(admin), "if-match": current.headers.etag as string },
      payload: { displayName: "Audit Target Renamed" },
    });
    expect(renamed.statusCode, renamed.body).toBe(200);

    const assigned = await api.request({
      method: "POST",
      url: `/api/v1/users/${userId}/role-assignments`,
      headers: bearer(admin),
      payload: { roleId: catalogId("role", "FRONT_DESK"), scope: "ORGANIZATION" },
    });
    expect(assigned.statusCode, assigned.body).toBe(201);
    const revoked = await api.request({
      method: "DELETE",
      url: `/api/v1/users/${userId}/role-assignments/${assigned.json().data.id}`,
      headers: bearer(admin),
    });
    expect(revoked.statusCode, revoked.body).toBe(204);

    const disabled = await api.request({
      method: "POST",
      url: `/api/v1/users/${userId}/disable`,
      headers: bearer(admin),
    });
    expect(disabled.statusCode, disabled.body).toBe(200);

    for (const action of ["USER_CREATED", "USER_UPDATED", "USER_DISABLED"]) {
      const [row] = await audited(action, { resourceId: userId });
      expect(row).toMatchObject({ outcome: "SUCCESS", actorUserId: admin.userId, organizationId: org });
    }
    for (const action of ["ROLE_ASSIGNED", "ROLE_REVOKED"]) {
      const rows = await audited(action, { actorUserId: admin.userId });
      expect(rows.some((r) => r.metadata?.targetUserId === userId)).toBe(true);
    }
  });

  it("ORGANIZATION_SWITCHED", async () => {
    const other = await fx.organization();
    const user = await fx.user();
    await fx.membership(org, user.id);
    await fx.membership(other, user.id);
    await fx.grant(user.id, "FRONT_DESK", { organizationId: org });
    await fx.grant(user.id, "FRONT_DESK", { organizationId: other });
    const member = await signIn(api, { email: user.email, userId: user.id, organizationId: org });
    const switched = await api.request({
      method: "PUT",
      url: "/api/v1/auth/session/organization",
      headers: bearer(member),
      payload: { organizationId: other },
    });
    expect(switched.statusCode, switched.body).toBe(200);
    const [row] = await audited("ORGANIZATION_SWITCHED", { actorUserId: user.id });
    expect(row).toMatchObject({ outcome: "SUCCESS", organizationId: other });
  });

  it("SECURITY_SESSION_REVOKED and LOGOUT", async () => {
    const member = await fx.staff(org, "FRONT_DESK");
    const revoke = await api.request({
      method: "POST",
      url: `/api/v1/users/${member.userId}/sessions/revoke`,
      headers: bearer(admin),
    });
    expect(revoke.statusCode, revoke.body).toBe(200);
    const [revokedRow] = await audited("SECURITY_SESSION_REVOKED", { actorUserId: admin.userId });
    expect(revokedRow?.outcome).toBe("SUCCESS");

    const out = await api.request({ method: "POST", url: "/api/v1/auth/logout", headers: bearer(provider) });
    expect(out.statusCode).toBe(204);
    const [logout] = await audited("LOGOUT", { actorUserId: provider.userId });
    expect(logout).toMatchObject({ outcome: "SUCCESS", organizationId: org });
  });
});
