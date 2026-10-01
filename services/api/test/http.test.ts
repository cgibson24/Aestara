// HTTP conventions (spec §6.1; Bible §20) and PHI-safe logging (spec §7.2).
import { RequestId } from "@aestara/api-contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_ORIGIN, databaseAvailable, startApi, type TestApi } from "./support/app.ts";
import { bearer, Fixtures, type StaffMember } from "./support/fixtures.ts";

describe.runIf(databaseAvailable())("HTTP conventions and logging", () => {
  let api: TestApi;
  let fx: Fixtures;
  let member: StaffMember;
  const logs: string[] = [];

  beforeAll(async () => {
    api = await startApi({ LOG_LEVEL: "info" }, { logDestination: { write: (line) => logs.push(line) } });
    fx = new Fixtures(api);
    const org = await fx.organization();
    member = await fx.staff(org, "SURGEON_PHYSICIAN");
  });
  afterAll(async () => api?.close());

  it("answers unknown routes with the error envelope", async () => {
    const res = await api.request({ method: "GET", url: "/api/v1/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toMatch(/_NOT_FOUND$/);
    expect(RequestId.safeParse(res.json().error.requestId).success).toBe(true);
  });

  it("maps malformed bodies, wrong content types and oversized bodies to catalog codes", async () => {
    const malformed = await api.request({
      method: "POST",
      url: "/api/v1/patients/search",
      headers: { ...bearer(member), "content-type": "application/json" },
      payload: "{not json",
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe("MALFORMED_REQUEST");
    const text = await api.request({
      method: "POST",
      url: "/api/v1/patients/search",
      headers: { ...bearer(member), "content-type": "text/plain" },
      payload: "name=Reyes",
    });
    expect(text.statusCode).toBe(415);
    expect(text.json().error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    const large = await api.request({
      method: "POST",
      url: "/api/v1/patients/search",
      headers: { ...bearer(member), "content-type": "application/json" },
      payload: JSON.stringify({ name: "x".repeat(1_100_000) }),
    });
    expect(large.statusCode).toBe(413);
  });

  it("validates with field errors that never echo the value, and refuses unknown query parameters", async () => {
    const res = await api.request({
      method: "POST",
      url: "/api/v1/patients",
      headers: { ...bearer(member), "idempotency-key": crypto.randomUUID() },
      payload: { firstName: "Ana", lastName: "Reyes", dateOfBirth: "12/04/1988", email: "not-an-email" },
    });
    expect(res.statusCode).toBe(400);
    const errors = res.json().error.details.fieldErrors;
    expect(errors.map((e: { path: string }) => e.path).sort()).toEqual(["dateOfBirth", "email"]);
    expect(res.body).not.toContain("12/04/1988");
    expect(res.body).not.toContain("not-an-email");
    const query = await api.request({
      method: "GET",
      url: "/api/v1/practices?offset=10",
      headers: bearer(member),
    });
    expect(query.statusCode).toBe(400);
  });

  it("sets security headers and never caches", async () => {
    const res = await api.request({ method: "GET", url: "/api/v1/health/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    expect(res.headers).toMatchObject({
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
    });
  });

  it("allows CORS only from the admin web origin", async () => {
    const preflight = (origin: string) =>
      api.request({
        method: "OPTIONS",
        url: "/api/v1/patients/search",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,content-type",
        },
      });
    const ok = await preflight(ADMIN_ORIGIN);
    expect(ok.headers["access-control-allow-origin"]).toBe(ADMIN_ORIGIN);
    expect(ok.headers["access-control-allow-credentials"]).toBe("true");
    const evil = await preflight("https://evil.example");
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("serializes concurrent requests with one Idempotency-Key into one patient", async () => {
    const key = crypto.randomUUID();
    const body = { firstName: "Con", lastName: "Current", dateOfBirth: "1981-08-08" };
    const results = await Promise.all(
      [0, 1, 2].map(() =>
        api.request({
          method: "POST",
          url: "/api/v1/patients",
          headers: { ...bearer(member), "idempotency-key": key },
          payload: body,
        }),
      ),
    );
    for (const r of results) expect([201, 409], r.body).toContain(r.statusCode);
    const ids = new Set(results.filter((r) => r.statusCode === 201).map((r) => r.json().data.id));
    expect(ids.size).toBe(1);
    const rows = await api.db.query(`SELECT count(*)::int AS n FROM "Patient" WHERE "lastName" = 'Current'`);
    expect(rows.rows[0].n).toBe(1);
  });

  it("keeps PHI, identifiers in URLs and secrets out of the logs", async () => {
    const created = await api.request({
      method: "POST",
      url: "/api/v1/patients",
      headers: { ...bearer(member), "idempotency-key": crypto.randomUUID() },
      payload: {
        firstName: "Quintessa",
        lastName: "Loggable",
        dateOfBirth: "1977-07-17",
        email: "quintessa@example.test",
        phone: "+15555550177",
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id;
    await api.request({ method: "GET", url: `/api/v1/patients/${id}`, headers: bearer(member) });
    await api.request({
      method: "POST",
      url: "/api/v1/patients/search",
      headers: bearer(member),
      payload: { name: "Quintessa" },
    });
    await api.request({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: member.email, password: "a wrong password guess", clientApp: "ADMIN_WEB" },
    });
    await api.request({
      method: "POST",
      url: "/api/v1/patients/search",
      headers: { ...bearer(member), "content-type": "application/json" },
      payload: "{bad",
    });
    const text = logs.join("");
    expect(logs.length).toBeGreaterThan(3);
    for (const secret of [
      "Quintessa",
      "Loggable",
      "1977-07-17",
      "quintessa@example.test",
      "15555550177",
      id,
      member.email,
      member.accessToken,
      "a wrong password guess",
    ])
      expect(text, secret).not.toContain(secret);
    expect(text).toContain('"route":"/api/v1/patients/:patientId"');
    expect(text).toContain('"operationId":"getPatient"');
  });
});
