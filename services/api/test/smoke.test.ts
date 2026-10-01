import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseAvailable, startApi, type TestApi } from "./support/app.ts";
import { bearer, Fixtures } from "./support/fixtures.ts";

describe.runIf(databaseAvailable())("smoke", () => {
  let api: TestApi;
  let fx: Fixtures;
  beforeAll(async () => {
    api = await startApi();
    fx = new Fixtures(api);
  });
  afterAll(async () => api?.close());

  it("serves health and signs in", async () => {
    const live = await api.request({ method: "GET", url: "/api/v1/health/live" });
    expect(live.statusCode).toBe(200);
    expect(live.headers["x-request-id"]).toBeTruthy();
    const org = await fx.organization();
    const member = await fx.staff(org, "FRONT_DESK");
    const res = await api.request({ method: "GET", url: "/api/v1/auth/session", headers: bearer(member) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.permissions).toContain("patient.read");
  });
});
