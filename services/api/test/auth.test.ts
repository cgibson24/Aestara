// Authentication and sessions over HTTP against PostgreSQL (roadmap M1.3;
// spec §4.2; ADR-0018 K-11 to K-15; ADR-0021).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_ORIGIN, databaseAvailable, startApi, type TestApi } from "./support/app.ts";
import { base32Decode, bearer, DEVICE, Fixtures, nextCode, PASSWORD, signIn } from "./support/fixtures.ts";

const login = (api: TestApi, payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
  api.request({ method: "POST", url: "/api/v1/auth/login", payload, headers });

describe.runIf(databaseAvailable())("authentication", () => {
  let api: TestApi;
  let fx: Fixtures;
  let org: string;

  beforeAll(async () => {
    api = await startApi();
    fx = new Fixtures(api);
    org = await fx.organization();
  });
  afterAll(async () => api?.close());

  const ledger = async (userId: string) =>
    (
      await api.db.query<{ eventType: string; failureReason: string | null }>(
        `SELECT "eventType", "failureReason" FROM "LoginEvent" WHERE "userId" = $1 ORDER BY "occurredAt"`,
        [userId],
      )
    ).rows;

  it("signs a provider in, binds the only organization and hides the refresh token hash", async () => {
    const user = await fx.user();
    await fx.membership(org, user.id);
    await fx.grant(user.id, "FRONT_DESK", { organizationId: org });
    const res = await login(api, {
      email: user.email.toUpperCase(),
      password: PASSWORD,
      clientApp: "IOS_PROVIDER",
      device: DEVICE,
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json().data;
    expect(body.refreshToken).toMatch(/^[0-9a-f-]{36}\.0\./);
    expect(body.session.organization.id).toBe(org);
    expect(body.session.permissions).toEqual(expect.arrayContaining(["patient.read", "patient.create"]));
    expect(body.session.permissions).not.toContain("photo.view");
    const row = await api.db.query(`SELECT "refreshTokenHash", "deviceId" FROM "Session" WHERE id = $1`, [
      body.session.sessionId,
    ]);
    expect(row.rows[0].refreshTokenHash).not.toBe(body.refreshToken);
    expect(row.rows[0].deviceId).not.toBeNull();
    expect((await ledger(user.id)).map((e) => e.eventType)).toEqual(["LOGIN_SUCCESS"]);
    const audit = await api.db.query(
      `SELECT action, "organizationId" FROM "AuditEvent" WHERE "actorUserId" = $1`,
      [user.id],
    );
    expect(audit.rows).toEqual([{ action: "LOGIN_SUCCESS", organizationId: org }]);
  });

  it("answers wrong passwords and unknown accounts identically, ledgering both", async () => {
    const user = await fx.user();
    await fx.membership(org, user.id);
    const wrong = await login(api, {
      email: user.email,
      password: "not the password at all",
      clientApp: "IOS_PROVIDER",
      device: DEVICE,
    });
    const unknown = await login(api, {
      email: "nobody@example.test",
      password: "not the password at all",
      clientApp: "IOS_PROVIDER",
      device: DEVICE,
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe(unknown.json().error.code);
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
    expect(await ledger(user.id)).toEqual([
      { eventType: "LOGIN_FAILURE", failureReason: "INVALID_CREDENTIALS" },
    ]);
    const anonymous = await api.db.query(
      `SELECT count(*)::int AS n FROM "LoginEvent" WHERE "userId" IS NULL AND "failureReason" = 'INVALID_CREDENTIALS'`,
    );
    expect(anonymous.rows[0].n).toBeGreaterThan(0);
    const audit = await api.db.query(`SELECT action, outcome FROM "AuditEvent" WHERE "actorUserId" = $1`, [
      user.id,
    ]);
    expect(audit.rows).toEqual([{ action: "LOGIN_FAILURE", outcome: "FAILURE" }]);
  });

  it("locks the identifier after 5 failures without checking the password, for unknown accounts too", async () => {
    const user = await fx.user();
    await fx.membership(org, user.id);
    for (let i = 0; i < 5; i++)
      expect(
        (
          await login(api, {
            email: user.email,
            password: "wrong wrong wrong",
            clientApp: "IOS_PROVIDER",
            device: DEVICE,
          })
        ).statusCode,
      ).toBe(401);
    const locked = await login(api, {
      email: user.email,
      password: PASSWORD,
      clientApp: "IOS_PROVIDER",
      device: DEVICE,
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe("RATE_LIMITED");
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(800);
    expect((await ledger(user.id)).at(-1)).toEqual({
      eventType: "LOGIN_FAILURE",
      failureReason: "ACCOUNT_LOCKED",
    });
    const status = await api.db.query(`SELECT status FROM "User" WHERE id = $1`, [user.id]);
    expect(status.rows[0].status).toBe("ACTIVE");
    for (let i = 0; i < 5; i++)
      await login(api, {
        email: "ghost@example.test",
        password: "wrong wrong wrong",
        clientApp: "IOS_PROVIDER",
        device: DEVICE,
      });
    expect(
      (
        await login(api, {
          email: "ghost@example.test",
          password: "x",
          clientApp: "IOS_PROVIDER",
          device: DEVICE,
        })
      ).statusCode,
    ).toBe(429);
  });

  it("requires MFA for admin roles and the admin web, and accepts each code once", async () => {
    const user = await fx.user();
    await fx.membership(org, user.id);
    await fx.grant(user.id, "PRACTICE_ADMIN", { organizationId: org });
    const secret = await fx.totp(user.id);
    const first = await login(api, {
      email: user.email,
      password: PASSWORD,
      clientApp: "IOS_PROVIDER",
      device: DEVICE,
    });
    expect(first.statusCode).toBe(401);
    const details = first.json().error.details;
    expect(first.json().error.code).toBe("MFA_REQUIRED");
    expect(details).toMatchObject({ factors: ["TOTP"], enrollmentRequired: false });
    expect((await ledger(user.id)).map((e) => e.eventType)).toEqual(["MFA_CHALLENGE_ISSUED"]);

    const wrong = await api.request({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      payload: { challengeToken: details.challengeToken, totpCode: "000000", device: DEVICE },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().error.code).toBe("MFA_REQUIRED");
    const ok = await api.request({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      payload: { challengeToken: details.challengeToken, totpCode: nextCode(secret), device: DEVICE },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().data.session.mfaVerifiedAt).toBeDefined();

    // The challenge is single-use, and the same code cannot be replayed.
    const replayChallenge = await api.request({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      payload: { challengeToken: details.challengeToken, totpCode: nextCode(secret), device: DEVICE },
    });
    expect(replayChallenge.statusCode).toBe(401);
    const second = await login(api, {
      email: user.email,
      password: PASSWORD,
      clientApp: "IOS_PROVIDER",
      device: DEVICE,
    });
    const replay = await api.request({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      payload: {
        challengeToken: second.json().error.details.challengeToken,
        totpCode: nextCode(secret),
        device: DEVICE,
      },
    });
    expect(replay.statusCode).toBe(401);
    expect((await ledger(user.id)).filter((e) => e.failureReason === "MFA_FAILED")).toHaveLength(2);
  });

  it("ends a challenge after 5 wrong codes", async () => {
    const user = await fx.user();
    await fx.membership(org, user.id);
    await fx.grant(user.id, "ORGANIZATION_ADMIN", { organizationId: org });
    const secret = await fx.totp(user.id);
    const first = await login(api, {
      email: user.email,
      password: PASSWORD,
      clientApp: "IOS_PROVIDER",
      device: DEVICE,
    });
    const token = first.json().error.details.challengeToken;
    for (let i = 0; i < 5; i++)
      await api.request({
        method: "POST",
        url: "/api/v1/auth/mfa/verify",
        payload: { challengeToken: token, totpCode: "123456", device: DEVICE },
      });
    const after = await api.request({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      payload: { challengeToken: token, totpCode: nextCode(secret), device: DEVICE },
    });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe("UNAUTHENTICATED");
  });

  it("lets a user who must use MFA but has none enroll TOTP with the sign-in challenge", async () => {
    const user = await fx.user();
    await fx.membership(org, user.id);
    await fx.grant(user.id, "ORGANIZATION_ADMIN", { organizationId: org });
    const first = await login(api, {
      email: user.email,
      password: PASSWORD,
      clientApp: "IOS_PROVIDER",
      device: DEVICE,
    });
    const details = first.json().error.details;
    expect(details.enrollmentRequired).toBe(true);
    const enroll = await api.request({
      method: "POST",
      url: "/api/v1/auth/mfa/enrollments",
      headers: { "idempotency-key": crypto.randomUUID() },
      payload: { type: "TOTP", challengeToken: details.challengeToken },
    });
    expect(enroll.statusCode, enroll.body).toBe(201);
    const { id, totp } = enroll.json().data;
    const secret = base32Decode(totp.secret);
    const confirm = await api.request({
      method: "POST",
      url: `/api/v1/auth/mfa/enrollments/${id}/confirm`,
      payload: { totpCode: nextCode(secret), challengeToken: details.challengeToken },
    });
    expect(confirm.statusCode, confirm.body).toBe(204);
    const verify = await api.request({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      payload: { challengeToken: details.challengeToken, totpCode: nextCode(secret, 1), device: DEVICE },
    });
    expect(verify.statusCode, verify.body).toBe(200);
    expect(verify.json().data.session.factors).toEqual([
      expect.objectContaining({ type: "TOTP", confirmed: true }),
    ]);
  });

  it("rotates refresh tokens and revokes the session when an old one is replayed", async () => {
    const member = await fx.staff(org, "FRONT_DESK");
    const refresh = (token: string) =>
      api.request({ method: "POST", url: "/api/v1/auth/token/refresh", payload: { refreshToken: token } });
    const first = await refresh(member.refreshToken ?? "");
    expect(first.statusCode, first.body).toBe(200);
    const next = first.json().data.refreshToken;
    expect(next).toMatch(/\.1\./);
    const reused = await refresh(member.refreshToken ?? "");
    expect(reused.statusCode).toBe(401);
    expect(reused.json().error.code).toBe("SESSION_INVALID");
    // The whole session is gone: the newest token and the access token stop working.
    expect((await refresh(next)).statusCode).toBe(401);
    const session = await api.request({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: bearer(first.json().data),
    });
    expect(session.statusCode).toBe(401);
    const row = await api.db.query(`SELECT "revokedReason" FROM "Session" WHERE id = $1`, [member.sessionId]);
    expect(row.rows[0].revokedReason).toBe("REFRESH_TOKEN_REUSE");
    const forged = `${member.sessionId}.0.${"A".repeat(43)}`;
    expect((await refresh(forged)).statusCode).toBe(401);
  });

  it("keeps the admin web refresh token in a strict cookie and checks Origin", async () => {
    const operator = await fx.platformOperator();
    expect(operator.refreshToken).toBeUndefined();
    const user = await fx.user();
    await fx.membership(org, user.id);
    await fx.grant(user.id, "ORGANIZATION_ADMIN", { organizationId: org });
    const secret = await fx.totp(user.id);
    const first = await login(
      api,
      { email: user.email, password: PASSWORD, clientApp: "ADMIN_WEB" },
      { origin: ADMIN_ORIGIN },
    );
    const ok = await api.request({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      headers: { origin: ADMIN_ORIGIN },
      payload: { challengeToken: first.json().error.details.challengeToken, totpCode: nextCode(secret) },
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const cookie = String(ok.headers["set-cookie"]);
    expect(cookie).toMatch(/^aestara_rt=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/api/v1/auth/token/refresh");
    expect(cookie).toContain("Secure");
    expect(ok.json().data.refreshToken).toBeUndefined();
    const value = cookie.split(";")[0] ?? "";
    const crossSite = await api.request({
      method: "POST",
      url: "/api/v1/auth/token/refresh",
      headers: { cookie: value, origin: "https://evil.example" },
      payload: {},
    });
    expect(crossSite.statusCode).toBe(403);
    const refreshed = await api.request({
      method: "POST",
      url: "/api/v1/auth/token/refresh",
      headers: { cookie: value, origin: ADMIN_ORIGIN },
      payload: {},
    });
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    expect(String(refreshed.headers["set-cookie"])).toMatch(/^aestara_rt=[^;]+\.1\./);
  });

  it("revokes immediately on logout, and lists and revokes own sessions", async () => {
    const member = await fx.staff(org, "FRONT_DESK");
    const other = await signIn(api, { email: member.email, userId: member.userId });
    const list = await api.request({ method: "GET", url: "/api/v1/auth/sessions", headers: bearer(member) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
    const revoke = await api.request({
      method: "DELETE",
      url: `/api/v1/auth/sessions/${other.sessionId}`,
      headers: bearer(member),
    });
    expect(revoke.statusCode).toBe(204);
    expect(
      (await api.request({ method: "GET", url: "/api/v1/auth/session", headers: bearer(other) })).statusCode,
    ).toBe(401);
    const logout = await api.request({ method: "POST", url: "/api/v1/auth/logout", headers: bearer(member) });
    expect(logout.statusCode).toBe(204);
    const after = await api.request({ method: "GET", url: "/api/v1/auth/session", headers: bearer(member) });
    expect(after.statusCode).toBe(401);
    expect(after.json().error.code).toBe("SESSION_INVALID");
  });

  it("ends sessions at once when the membership is disabled or the organization suspended", async () => {
    const org2 = await fx.organization();
    const member = await fx.staff(org2, "FRONT_DESK");
    await api.db.query(`UPDATE "Membership" SET status = 'DISABLED' WHERE "userId" = $1`, [member.userId]);
    expect(
      (await api.request({ method: "GET", url: "/api/v1/auth/session", headers: bearer(member) })).statusCode,
    ).toBe(401);
    const org3 = await fx.organization();
    const member3 = await fx.staff(org3, "FRONT_DESK");
    await api.db.query(`UPDATE "Organization" SET status = 'SUSPENDED' WHERE id = $1`, [org3]);
    expect(
      (await api.request({ method: "GET", url: "/api/v1/auth/session", headers: bearer(member3) }))
        .statusCode,
    ).toBe(401);
  });

  it("starts without an organization when there are several, and switches with the MFA rule", async () => {
    const orgA = await fx.organization();
    const orgB = await fx.organization();
    const user = await fx.user();
    await fx.membership(orgA, user.id);
    await fx.membership(orgB, user.id);
    await fx.grant(user.id, "FRONT_DESK", { organizationId: orgA });
    await fx.grant(user.id, "FRONT_DESK", { organizationId: orgB });
    const member = await signIn(api, { email: user.email, userId: user.id });
    const session = await api.request({
      method: "GET",
      url: "/api/v1/auth/session",
      headers: bearer(member),
    });
    expect(session.json().data.organization).toBeUndefined();
    expect(session.json().data.memberships).toHaveLength(2);
    const noOrg = await api.request({
      method: "POST",
      url: "/api/v1/patients/search",
      headers: bearer(member),
      payload: { name: "a" },
    });
    expect(noOrg.statusCode).toBe(403);
    const switched = await api.request({
      method: "PUT",
      url: "/api/v1/auth/session/organization",
      headers: bearer(member),
      payload: { organizationId: orgB },
    });
    expect(switched.statusCode, switched.body).toBe(200);
    const token = { accessToken: switched.json().data.accessToken };
    expect(switched.json().data.session.organization.id).toBe(orgB);
    expect(
      (
        await api.request({
          method: "POST",
          url: "/api/v1/patients/search",
          headers: bearer(token),
          payload: { name: "a" },
        })
      ).statusCode,
    ).toBe(200);
    // The old token was bound to no organization: it no longer matches the session.
    expect(
      (await api.request({ method: "GET", url: "/api/v1/auth/session", headers: bearer(member) })).statusCode,
    ).toBe(401);
    const stranger = await fx.organization();
    const notMine = await api.request({
      method: "PUT",
      url: "/api/v1/auth/session/organization",
      headers: bearer(token),
      payload: { organizationId: stranger },
    });
    expect(notMine.statusCode).toBe(404);
    // An organization that requires MFA for all staff refuses a session without it.
    await api.db.query(
      `INSERT INTO "OrganizationSetting" (id, "organizationId", key, value, "updatedAt") VALUES (gen_random_uuid(), $1, 'security.mfaPolicy', '"ALL_STAFF"', now())`,
      [orgA],
    );
    const refused = await api.request({
      method: "PUT",
      url: "/api/v1/auth/session/organization",
      headers: bearer(token),
      payload: { organizationId: orgA },
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe("REAUTHENTICATION_REQUIRED");
  });

  it("answers forgot-password identically and resets with a single-use token that ends every session", async () => {
    const member = await fx.staff(org, "FRONT_DESK");
    const known = await api.request({
      method: "POST",
      url: "/api/v1/auth/password/forgot",
      payload: { email: member.email },
    });
    const unknown = await api.request({
      method: "POST",
      url: "/api/v1/auth/password/forgot",
      payload: { email: "who@example.test" },
    });
    expect(known.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(known.body).toBe(unknown.body);
    await new Promise((r) => setTimeout(r, 50));
    const mail = api.email.outbox.filter((m) => m.to === member.email && m.kind === "PASSWORD_RESET");
    expect(mail).toHaveLength(1);
    const link = mail[0]?.text.match(/https:\/\/\S+/)?.[0] ?? "";
    expect(link).toMatch(/\/reset-password#token=/);
    const token = new URL(link).hash.replace("#token=", "");
    const weak = await api.request({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token, newPassword: "password1234" },
    });
    expect(weak.statusCode).toBe(400);
    const reset = await api.request({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token, newPassword: "a fresh reset passphrase" },
    });
    expect(reset.statusCode, reset.body).toBe(204);
    expect(
      (await api.request({ method: "GET", url: "/api/v1/auth/session", headers: bearer(member) })).statusCode,
    ).toBe(401);
    const again = await api.request({
      method: "POST",
      url: "/api/v1/auth/password/reset",
      payload: { token, newPassword: "another fresh passphrase" },
    });
    expect(again.statusCode).toBe(401);
    const newLogin = await login(api, {
      email: member.email,
      password: "a fresh reset passphrase",
      clientApp: "IOS_PROVIDER",
      device: DEVICE,
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it("changes the password with the current one and ends the other sessions", async () => {
    const member = await fx.staff(org, "FRONT_DESK");
    const other = await signIn(api, { email: member.email, userId: member.userId });
    const wrong = await api.request({
      method: "POST",
      url: "/api/v1/auth/password/change",
      headers: bearer(member),
      payload: { currentPassword: "not it at all", newPassword: "a brand new passphrase" },
    });
    expect(wrong.statusCode).toBe(400);
    expect((await ledger(member.userId)).at(-1)).toEqual({
      eventType: "LOGIN_FAILURE",
      failureReason: "INVALID_CREDENTIALS",
    });
    const ok = await api.request({
      method: "POST",
      url: "/api/v1/auth/password/change",
      headers: bearer(member),
      payload: { currentPassword: PASSWORD, newPassword: "a brand new passphrase" },
    });
    expect(ok.statusCode, ok.body).toBe(204);
    expect(
      (await api.request({ method: "GET", url: "/api/v1/auth/session", headers: bearer(member) })).statusCode,
    ).toBe(200);
    expect(
      (await api.request({ method: "GET", url: "/api/v1/auth/session", headers: bearer(other) })).statusCode,
    ).toBe(401);
  });

  it("requires a recent MFA for a step-up action on an old session", async () => {
    const member = await fx.staff(org, "PRACTICE_ADMIN");
    await api.db.query(
      `UPDATE "Session" SET "mfaVerifiedAt" = now() - interval '20 minutes', "createdAt" = now() - interval '20 minutes' WHERE id = $1`,
      [member.sessionId],
    );
    const res = await api.request({
      method: "POST",
      url: "/api/v1/auth/password/change",
      headers: bearer(member),
      payload: { currentPassword: PASSWORD, newPassword: "a brand new passphrase" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("REAUTHENTICATION_REQUIRED");
  });

  it("publishes a JWKS that verifies the access tokens", async () => {
    const res = await api.request({ method: "GET", url: "/api/v1/.well-known/jwks.json" });
    expect(res.statusCode).toBe(200);
    expect(res.json().keys[0]).toMatchObject({ kty: "EC", crv: "P-256", alg: "ES256" });
  });
});
