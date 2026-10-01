// Organizations, users, roles, audit and settings over HTTP (roadmap M1.5 to
// M1.7; spec §4.5 rules 1–4, §6.3; ADR-0018 K-05, K-06, K-07, K-12; ADR-0021).
import { catalogId } from "@aestara/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_ORIGIN, databaseAvailable, startApi, type TestApi } from "./support/app.ts";
import {
  base32Decode,
  bearer,
  DEVICE,
  Fixtures,
  nextCode,
  PASSWORD,
  type StaffMember,
  signIn,
} from "./support/fixtures.ts";

describe.runIf(databaseAvailable())("administration", () => {
  let api: TestApi;
  let fx: Fixtures;
  let operator: StaffMember;

  beforeAll(async () => {
    api = await startApi();
    fx = new Fixtures(api);
    operator = await fx.platformOperator();
  });
  afterAll(async () => api?.close());

  const tokenFrom = (text: string) =>
    new URL(text.match(/https:\/\/\S+/)?.[0] ?? "").hash.replace("#token=", "");

  describe("organizations (M1.5)", () => {
    it("bootstraps an organization whose first admin accepts, enrolls MFA and signs in", async () => {
      const created = await api.request({
        method: "POST",
        url: "/api/v1/organizations",
        headers: { ...bearer(operator), "idempotency-key": crypto.randomUUID() },
        payload: {
          name: "Lumen Aesthetics",
          slug: "lumen-aesthetics",
          firstAdmin: { email: "owner@lumen.test", displayName: "Owner" },
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const { organization, firstAdmin } = created.json().data;
      expect(firstAdmin.membershipStatus).toBe("INVITED");
      const mail = api.email.outbox.find((m) => m.to === "owner@lumen.test" && m.kind === "INVITATION");
      expect(mail?.text).toContain("/accept-invitation#token=");
      const token = tokenFrom(mail?.text ?? "");
      const weak = await api.request({
        method: "POST",
        url: "/api/v1/auth/invitations/accept",
        payload: { token, password: "short" },
      });
      expect(weak.statusCode).toBe(400);
      const accepted = await api.request({
        method: "POST",
        url: "/api/v1/auth/invitations/accept",
        payload: { token, password: "violet harbor passphrase 1" },
      });
      expect(accepted.statusCode, accepted.body).toBe(204);
      const user = await api.db.query(`SELECT status, "emailVerifiedAt" FROM "User" WHERE id = $1`, [
        firstAdmin.userId,
      ]);
      expect(user.rows[0].status).toBe("ACTIVE");
      expect(user.rows[0].emailVerifiedAt).not.toBeNull();

      // The admin web always needs MFA: enroll with the sign-in challenge, then verify.
      const login = await api.request({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { origin: ADMIN_ORIGIN },
        payload: {
          email: "owner@lumen.test",
          password: "violet harbor passphrase 1",
          clientApp: "ADMIN_WEB",
        },
      });
      const challenge = login.json().error.details;
      expect(challenge.enrollmentRequired).toBe(true);
      const enroll = await api.request({
        method: "POST",
        url: "/api/v1/auth/mfa/enrollments",
        headers: { "idempotency-key": crypto.randomUUID() },
        payload: { type: "TOTP", challengeToken: challenge.challengeToken },
      });
      const secret = base32Decode(enroll.json().data.totp.secret);
      await api.request({
        method: "POST",
        url: `/api/v1/auth/mfa/enrollments/${enroll.json().data.id}/confirm`,
        payload: { totpCode: nextCode(secret), challengeToken: challenge.challengeToken },
      });
      const verified = await api.request({
        method: "POST",
        url: "/api/v1/auth/mfa/verify",
        headers: { origin: ADMIN_ORIGIN },
        payload: { challengeToken: challenge.challengeToken, totpCode: nextCode(secret, 1) },
      });
      expect(verified.statusCode, verified.body).toBe(200);
      expect(verified.json().data.session.organization.id).toBe(organization.id);
      expect(verified.json().data.session.permissions).not.toContain("patient.read");

      // A second bootstrap is refused once the organization has an active admin.
      const again = await api.request({
        method: "POST",
        url: `/api/v1/organizations/${organization.id}/admin-bootstrap`,
        headers: { ...bearer(operator), "idempotency-key": crypto.randomUUID() },
        payload: { email: "second@lumen.test", displayName: "Second" },
      });
      expect(again.statusCode).toBe(403);
      expect(again.json().error.code).toBe("SEPARATION_OF_DUTIES");
      const audit = await api.db.query(
        `SELECT action FROM "AuditEvent" WHERE "organizationId" = $1 ORDER BY "occurredAt", action`,
        [organization.id],
      );
      expect(audit.rows.map((r) => r.action)).toEqual(
        expect.arrayContaining([
          "CONFIGURATION_CHANGED",
          "USER_CREATED",
          "ROLE_ASSIGNED",
          "SECURITY_CREDENTIAL_CHANGED",
          "LOGIN_SUCCESS",
        ]),
      );
    });

    it("never lets a platform actor bootstrap itself or grant a clinical role", async () => {
      const org = await fx.organization();
      const self = await api.request({
        method: "POST",
        url: `/api/v1/organizations/${org}/admin-bootstrap`,
        headers: { ...bearer(operator), "idempotency-key": crypto.randomUUID() },
        payload: { email: operator.email, displayName: "Me" },
      });
      expect(self.statusCode).toBe(403);
      expect(self.json().error.code).toBe("SEPARATION_OF_DUTIES");
      // The database refuses a clinical grant from the platform role as well (AE002).
      const target = await fx.user();
      await fx.membership(org, target.id);
      const platform = await api.connectAs("platform");
      try {
        await expect(
          platform.query(
            `INSERT INTO "UserRole" (id, "userId", "organizationId", "roleId", scope) VALUES (gen_random_uuid(), $1, $2, $3, 'ORGANIZATION')`,
            [target.id, org, catalogId("role", "SURGEON_PHYSICIAN")],
          ),
        ).rejects.toThrow(/SEPARATION_OF_DUTIES/);
        await expect(platform.query(`SELECT count(*) FROM "Patient"`)).rejects.toThrow(/permission denied/);
      } finally {
        await platform.end();
      }
    });

    it("lets an organization rename itself but not change its status", async () => {
      const org = await fx.organization();
      const admin = await fx.staff(org, "ORGANIZATION_ADMIN");
      const status = await api.request({
        method: "PATCH",
        url: `/api/v1/organizations/${org}`,
        headers: { ...bearer(admin), "if-match": '"v1"' },
        payload: { status: "SUSPENDED" },
      });
      expect(status.statusCode).toBe(403);
      const rename = await api.request({
        method: "PATCH",
        url: `/api/v1/organizations/${org}`,
        headers: { ...bearer(admin), "if-match": '"v1"' },
        payload: { name: "Renamed Clinic" },
      });
      expect(rename.statusCode).toBe(200);
      expect(rename.headers.etag).toBe('"v2"');
      const suspend = await api.request({
        method: "PATCH",
        url: `/api/v1/organizations/${org}`,
        headers: { ...bearer(operator), "if-match": '"v2"' },
        payload: { status: "SUSPENDED" },
      });
      expect(suspend.statusCode, suspend.body).toBe(200);
      expect(
        (await api.request({ method: "GET", url: "/api/v1/auth/session", headers: bearer(admin) }))
          .statusCode,
      ).toBe(401);
    });

    it("limits a practice admin to its own practice", async () => {
      const org = await fx.organization();
      const mine = await fx.practice(org);
      const other = await fx.practice(org);
      const pa = await fx.staff(org, "PRACTICE_ADMIN", { practiceId: mine });
      const create = await api.request({
        method: "POST",
        url: "/api/v1/practices",
        headers: bearer(pa),
        payload: { name: "New Practice", timezone: "UTC" },
      });
      expect(create.statusCode).toBe(403);
      const ok = await api.request({
        method: "PATCH",
        url: `/api/v1/practices/${mine}`,
        headers: { ...bearer(pa), "if-match": '"v1"' },
        payload: { timezone: "America/Denver" },
      });
      expect(ok.statusCode, ok.body).toBe(200);
      const denied = await api.request({
        method: "PATCH",
        url: `/api/v1/practices/${other}`,
        headers: { ...bearer(pa), "if-match": '"v1"' },
        payload: { timezone: "America/Denver" },
      });
      expect(denied.statusCode).toBe(403);
      const location = await api.request({
        method: "POST",
        url: "/api/v1/locations",
        headers: bearer(pa),
        payload: { practiceId: mine, name: "Suite 2", timezone: "America/Denver", countryCode: "US" },
      });
      expect(location.statusCode, location.body).toBe(201);
      const list = await api.request({
        method: "GET",
        url: `/api/v1/locations?practiceId=${mine}`,
        headers: bearer(pa),
      });
      expect(list.json().data.map((l: { name: string }) => l.name)).toEqual(["Suite 2"]);
      const badZone = await api.request({
        method: "POST",
        url: "/api/v1/locations",
        headers: bearer(pa),
        payload: { practiceId: mine, name: "Suite 3", timezone: "Mars/Olympus" },
      });
      expect(badZone.statusCode).toBe(400);
    });
  });

  describe("users and roles (M1.6)", () => {
    it("invites a user idempotently, and the user accepts", async () => {
      const org = await fx.organization();
      const admin = await fx.staff(org, "ORGANIZATION_ADMIN");
      const key = crypto.randomUUID();
      const body = {
        email: "New.Hire@Example.test",
        displayName: "New Hire",
        roleAssignments: [{ roleId: catalogId("role", "FRONT_DESK"), scope: "ORGANIZATION" }],
      };
      const first = await api.request({
        method: "POST",
        url: "/api/v1/users",
        headers: { ...bearer(admin), "idempotency-key": key },
        payload: body,
      });
      expect(first.statusCode, first.body).toBe(201);
      const replay = await api.request({
        method: "POST",
        url: "/api/v1/users",
        headers: { ...bearer(admin), "idempotency-key": key },
        payload: body,
      });
      expect(replay.json().data.id).toBe(first.json().data.id);
      expect(first.json().data).toMatchObject({
        email: "new.hire@example.test",
        status: "INVITED",
        roleAssignments: [{ roleKey: "FRONT_DESK" }],
      });
      const again = await api.request({
        method: "POST",
        url: "/api/v1/users",
        headers: { ...bearer(admin), "idempotency-key": crypto.randomUUID() },
        payload: body,
      });
      expect(again.statusCode).toBe(409);
      const mail = api.email.outbox.filter((m) => m.to === "new.hire@example.test");
      expect(mail).toHaveLength(1);
      const accepted = await api.request({
        method: "POST",
        url: "/api/v1/auth/invitations/accept",
        payload: { token: tokenFrom(mail[0]?.text ?? ""), password: "new hire passphrase 22" },
      });
      expect(accepted.statusCode).toBe(204);
      const login = await api.request({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: {
          email: "new.hire@example.test",
          password: "new hire passphrase 22",
          clientApp: "IOS_PROVIDER",
          device: DEVICE,
        },
      });
      expect(login.statusCode, login.body).toBe(200);
    });

    it("enforces separation of duties: never oneself, never beyond one's scope", async () => {
      const org = await fx.organization();
      const practice = await fx.practice(org);
      const otherPractice = await fx.practice(org);
      const admin = await fx.staff(org, "ORGANIZATION_ADMIN");
      const pa = await fx.staff(org, "PRACTICE_ADMIN", { practiceId: practice });
      const assign = (who: StaffMember, userId: string, payload: Record<string, unknown>) =>
        api.request({
          method: "POST",
          url: `/api/v1/users/${userId}/role-assignments`,
          headers: bearer(who),
          payload,
        });

      const self = await assign(admin, admin.userId, {
        roleId: catalogId("role", "SURGEON_PHYSICIAN"),
        scope: "ORGANIZATION",
      });
      expect(self.statusCode).toBe(403);
      expect(self.json().error.code).toBe("SEPARATION_OF_DUTIES");

      const target = await fx.user();
      await fx.membership(org, target.id);
      const up = await assign(pa, target.id, {
        roleId: catalogId("role", "ORGANIZATION_ADMIN"),
        scope: "ORGANIZATION",
      });
      expect(up.json().error.code).toBe("SEPARATION_OF_DUTIES");
      const outside = await assign(pa, target.id, {
        roleId: catalogId("role", "FRONT_DESK"),
        scope: "PRACTICE",
        practiceId: otherPractice,
      });
      expect(outside.json().error.code).toBe("SEPARATION_OF_DUTIES");
      const inside = await assign(pa, target.id, {
        roleId: catalogId("role", "FRONT_DESK"),
        scope: "PRACTICE",
        practiceId: practice,
      });
      expect(inside.statusCode, inside.body).toBe(201);
      const duplicate = await assign(pa, target.id, {
        roleId: catalogId("role", "FRONT_DESK"),
        scope: "PRACTICE",
        practiceId: practice,
      });
      expect(duplicate.statusCode).toBe(409);
      const superAdmin = await assign(admin, target.id, {
        roleId: catalogId("role", "SUPER_ADMIN"),
        scope: "ORGANIZATION",
      });
      expect(superAdmin.statusCode).toBe(400);

      // The practice admin cannot manage a user who also works organization-wide.
      await assign(admin, target.id, { roleId: catalogId("role", "CONSULTANT"), scope: "ORGANIZATION" });
      const disable = await api.request({
        method: "POST",
        url: `/api/v1/users/${target.id}/disable`,
        headers: bearer(pa),
      });
      expect(disable.statusCode).toBe(403);
      expect(disable.json().error.code).toBe("SEPARATION_OF_DUTIES");

      const revoke = await api.request({
        method: "DELETE",
        url: `/api/v1/users/${target.id}/role-assignments/${inside.json().data.id}`,
        headers: bearer(admin),
      });
      expect(revoke.statusCode).toBe(204);
      const audit = await api.db.query(
        `SELECT action FROM "AuditEvent" WHERE metadata->>'targetUserId' = $1 ORDER BY "occurredAt"`,
        [target.id],
      );
      expect(audit.rows.map((r) => r.action)).toEqual(["ROLE_ASSIGNED", "ROLE_ASSIGNED", "ROLE_REVOKED"]);
    });

    it("disables a membership and ends only that organization's sessions", async () => {
      const orgA = await fx.organization();
      const orgB = await fx.organization();
      const admin = await fx.staff(orgA, "ORGANIZATION_ADMIN");
      const user = await fx.user();
      await fx.membership(orgA, user.id);
      await fx.membership(orgB, user.id);
      await fx.grant(user.id, "FRONT_DESK", { organizationId: orgA });
      await fx.grant(user.id, "FRONT_DESK", { organizationId: orgB });
      const inA = await signIn(api, { email: user.email, userId: user.id, organizationId: orgA });
      const inB = await signIn(api, { email: user.email, userId: user.id, organizationId: orgB });
      const res = await api.request({
        method: "POST",
        url: `/api/v1/users/${user.id}/disable`,
        headers: bearer(admin),
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().data.status).toBe("DISABLED");
      expect(
        (await api.request({ method: "GET", url: "/api/v1/auth/session", headers: bearer(inA) })).statusCode,
      ).toBe(401);
      expect(
        (await api.request({ method: "GET", url: "/api/v1/auth/session", headers: bearer(inB) })).statusCode,
      ).toBe(200);
      const self = await api.request({
        method: "POST",
        url: `/api/v1/users/${admin.userId}/disable`,
        headers: bearer(admin),
      });
      expect(self.json().error.code).toBe("SEPARATION_OF_DUTIES");
      // Account details are shared with organization B, so A cannot edit them.
      const edit = await api.request({
        method: "PATCH",
        url: `/api/v1/users/${user.id}`,
        headers: { ...bearer(admin), "if-match": '"v2"' },
        payload: { displayName: "Changed" },
      });
      expect(edit.statusCode).toBe(403);
    });

    it("revokes a user's sessions and resets MFA with a stated identity check", async () => {
      const org = await fx.organization();
      const admin = await fx.staff(org, "ORGANIZATION_ADMIN");
      const member = await fx.staff(org, "PRACTICE_ADMIN");
      const revoke = await api.request({
        method: "POST",
        url: `/api/v1/users/${member.userId}/sessions/revoke`,
        headers: bearer(admin),
      });
      expect(revoke.json().data).toEqual({ revokedSessions: 1 });
      expect(
        (await api.request({ method: "GET", url: "/api/v1/auth/session", headers: bearer(member) }))
          .statusCode,
      ).toBe(401);
      const missing = await api.request({
        method: "POST",
        url: `/api/v1/users/${member.userId}/mfa-reset`,
        headers: bearer(admin),
        payload: {},
      });
      expect(missing.statusCode).toBe(400);
      const reset = await api.request({
        method: "POST",
        url: `/api/v1/users/${member.userId}/mfa-reset`,
        headers: bearer(admin),
        payload: { identityVerificationMethod: "VIDEO_CALL" },
      });
      expect(reset.statusCode, reset.body).toBe(200);
      expect(reset.json().data.removedFactors).toBe(1);
      const event = await api.db.query(
        `SELECT metadata FROM "AuditEvent" WHERE action = 'SECURITY_CREDENTIAL_CHANGED' AND "resourceId" = $1`,
        [member.userId],
      );
      expect(event.rows[0].metadata).toMatchObject({
        change: "MFA_RESET",
        identityVerificationMethod: "VIDEO_CALL",
      });
      // The next sign-in must enroll again.
      const login = await api.request({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: member.email, password: PASSWORD, clientApp: "IOS_PROVIDER", device: DEVICE },
      });
      expect(login.json().error.details.enrollmentRequired).toBe(true);
    });

    it("keeps provider profiles with If-Match once they exist", async () => {
      const org = await fx.organization();
      const admin = await fx.staff(org, "ORGANIZATION_ADMIN");
      const doctor = await fx.staff(org, "SURGEON_PHYSICIAN");
      const url = `/api/v1/users/${doctor.userId}/provider-profile`;
      expect((await api.request({ method: "GET", url, headers: bearer(admin) })).statusCode).toBe(404);
      const created = await api.request({
        method: "PUT",
        url,
        headers: bearer(admin),
        payload: { displayName: "Dr. Synthetic", npi: "1234567893" },
      });
      expect(created.statusCode, created.body).toBe(200);
      const noMatch = await api.request({
        method: "PUT",
        url,
        headers: bearer(admin),
        payload: { displayName: "Dr. S" },
      });
      expect(noMatch.statusCode).toBe(428);
      const updated = await api.request({
        method: "PUT",
        url,
        headers: { ...bearer(admin), "if-match": '"v1"' },
        payload: { displayName: "Dr. S" },
      });
      expect(updated.json().data).toMatchObject({ displayName: "Dr. S", version: 2 });
      expect(updated.json().data).not.toHaveProperty("npi");
      const badNpi = await api.request({
        method: "PUT",
        url,
        headers: { ...bearer(admin), "if-match": '"v2"' },
        payload: { displayName: "X", npi: "1234567890" },
      });
      expect(badNpi.statusCode).toBe(400);
      const user = await api.request({
        method: "GET",
        url: `/api/v1/users/${doctor.userId}`,
        headers: bearer(admin),
      });
      expect(user.json().data).toMatchObject({ hasProviderProfile: true, mfaEnrolled: false });
    });

    it("lists roles and the permission catalog", async () => {
      const org = await fx.organization();
      const admin = await fx.staff(org, "ORGANIZATION_ADMIN");
      const roles = await api.request({
        method: "GET",
        url: "/api/v1/roles?limit=100",
        headers: bearer(admin),
      });
      expect(roles.json().data.map((r: { key: string }) => r.key)).toHaveLength(10);
      const permissions = await api.request({
        method: "GET",
        url: "/api/v1/permissions?limit=100",
        headers: bearer(admin),
      });
      expect(permissions.json().data).toHaveLength(53);
      const page = await api.request({
        method: "GET",
        url: "/api/v1/permissions?limit=20",
        headers: bearer(admin),
      });
      const next = await api.request({
        method: "GET",
        url: `/api/v1/permissions?limit=50&cursor=${page.json().page.nextCursor}`,
        headers: bearer(admin),
      });
      expect(next.json().data).toHaveLength(33);
    });
  });

  describe("audit (M1.7)", () => {
    it("reports every access to one patient, newest first, within the organization", async () => {
      const org = await fx.organization();
      const admin = await fx.staff(org, "ORGANIZATION_ADMIN");
      const desk = await fx.staff(org, "FRONT_DESK");
      const patient = await fx.patient(org);
      await api.request({ method: "GET", url: `/api/v1/patients/${patient}`, headers: bearer(desk) });
      await api.request({
        method: "PATCH",
        url: `/api/v1/patients/${patient}`,
        headers: { ...bearer(desk), "if-match": '"v1"' },
        payload: { preferredName: "Pref" },
      });
      const report = await api.request({
        method: "GET",
        url: `/api/v1/audit/events?patientId=${patient}`,
        headers: bearer(admin),
      });
      expect(report.statusCode).toBe(200);
      expect(report.json().data.map((e: { action: string }) => e.action)).toEqual([
        "PATIENT_UPDATED",
        "PATIENT_VIEWED",
      ]);
      expect(report.json().data[0]).toMatchObject({
        actorUserId: desk.userId,
        actorType: "USER",
        outcome: "SUCCESS",
      });
      expect(JSON.stringify(report.json())).not.toContain("Pref");
      const one = await api.request({
        method: "GET",
        url: `/api/v1/audit/events/${report.json().data[0].id}`,
        headers: bearer(admin),
      });
      expect(one.statusCode).toBe(200);
      const desk403 = await api.request({
        method: "GET",
        url: "/api/v1/audit/events",
        headers: bearer(desk),
      });
      expect(desk403.statusCode).toBe(403);
    });

    it("shows a platform operator only platform-level events", async () => {
      const res = await api.request({
        method: "GET",
        url: "/api/v1/audit/events?limit=100",
        headers: bearer(operator),
      });
      expect(res.statusCode).toBe(200);
      const organizations = await api.db.query(
        `SELECT id FROM "AuditEvent" WHERE id = ANY($1::uuid[]) AND "organizationId" IS NOT NULL`,
        [res.json().data.map((e: { id: string }) => e.id)],
      );
      expect(organizations.rowCount).toBe(0);
    });

    it("cannot be changed, even by the database owner role's tables (append-only)", async () => {
      await expect(api.db.query(`UPDATE "AuditEvent" SET action = 'LOGOUT' WHERE true`)).rejects.toThrow(
        /IMMUTABLE_RECORD/,
      );
    });
  });

  describe("settings", () => {
    it("validates values by key and versions them", async () => {
      const org = await fx.organization();
      const admin = await fx.staff(org, "ORGANIZATION_ADMIN");
      const url = "/api/v1/settings/organization/security.sessionPolicy";
      const read = await api.request({ method: "GET", url, headers: bearer(admin) });
      expect(read.json().data).toMatchObject({ isDefault: true, version: 0 });
      expect(read.headers.etag).toBe('"v0"');
      const longer = await api.request({
        method: "PUT",
        url,
        headers: { ...bearer(admin), "if-match": '"v0"' },
        payload: { value: { ...read.json().data.value, ADMIN_WEB: { idleMinutes: 120, absoluteHours: 12 } } },
      });
      expect(longer.statusCode).toBe(400);
      const shorter = await api.request({
        method: "PUT",
        url,
        headers: { ...bearer(admin), "if-match": '"v0"' },
        payload: {
          value: { ...read.json().data.value, IOS_PROVIDER: { idleMinutes: 60, absoluteHours: 24 } },
        },
      });
      expect(shorter.statusCode, shorter.body).toBe(200);
      const unknown = await api.request({
        method: "GET",
        url: "/api/v1/settings/organization/nope",
        headers: bearer(admin),
      });
      expect(unknown.statusCode).toBe(404);
      // New sessions use the shorter lifetime.
      const desk = await fx.staff(org, "FRONT_DESK");
      const row = await api.db.query(
        `SELECT extract(epoch FROM "absoluteExpiresAt" - "createdAt")::int AS seconds FROM "Session" WHERE id = $1`,
        [desk.sessionId],
      );
      expect(row.rows[0].seconds).toBe(24 * 3600);
    });
  });
});
