// Photo annotations (Bible §5.1 "Annotate if needed", §6.6, §23.1; spec §6.3;
// ADR-0026 K3-10): versioned vector layers on accepted photos, the palette and
// limits of the contract, no measurement tools, author-only changes, soft
// deletion, client IDs for offline layers, and audit events without text.
import { uuidv7 } from "@aestara/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseAvailable, startApi, type TestApi } from "./support/app.ts";
import { bearer, Fixtures, type StaffMember } from "./support/fixtures.ts";

describe.runIf(databaseAvailable())("photo annotations (Layer 3)", () => {
  let api: TestApi;
  let fx: Fixtures;
  let org: string;
  let patient: string;
  let photoId: string;
  let surgeon: StaffMember;
  let nurse: StaffMember;
  let photographer: StaffMember;

  const call = (
    who: StaffMember,
    method: string,
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) =>
    api.request({
      method: method as "GET",
      url: `/api/v1/patients/${patient}/photos/${photoId}${url}`,
      headers: { ...bearer(who), ...headers },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
  const idem = () => ({ "idempotency-key": crypto.randomUUID() });
  const at = (version: number) => ({ "if-match": `"v${version}"` });

  const layer = {
    schemaVersion: 1,
    shapes: [
      { type: "ARROW", from: [0.2, 0.3], to: [0.4, 0.45], color: "RED", stroke: "MEDIUM" },
      { type: "ELLIPSE", center: [0.5, 0.5], radiusX: 0.1, radiusY: 0.05, color: "YELLOW", stroke: "THIN" },
      { type: "TEXT", position: [0.6, 0.2], text: "Volume loss here", color: "WHITE", size: "MEDIUM" },
      {
        type: "FREEHAND",
        points: [
          [0.1, 0.1],
          [0.12, 0.13],
          [0.15, 0.14],
        ],
        color: "BLUE",
        stroke: "THICK",
      },
    ],
  };

  beforeAll(async () => {
    api = await startApi();
    fx = new Fixtures(api);
    org = await fx.organization();
    patient = await fx.patient(org);
    surgeon = await fx.staff(org, "SURGEON_PHYSICIAN");
    nurse = await fx.staff(org, "NURSE_INJECTOR_AESTHETICIAN");
    photographer = await fx.staff(org, "PHOTOGRAPHER");
    photoId = (await fx.photography(org, patient, { capturedByUserId: surgeon.userId, release: false }))
      .photoId;
  });
  afterAll(async () => api?.close());

  it("adds a layer, audited without its text, and lists it", async () => {
    const res = await call(surgeon, "POST", "/annotations", { label: "Lips", layer }, idem());
    expect(res.statusCode, res.body).toBe(201);
    const a = res.json().data;
    expect(a).toMatchObject({ photoId, authorUserId: surgeon.userId, label: "Lips", layer, version: 1 });
    const events = await api.db.query(`SELECT action, metadata FROM "AuditEvent" WHERE "resourceId" = $1`, [
      a.id,
    ]);
    expect(events.rows).toEqual([
      { action: "PHOTO_ANNOTATED", metadata: { photoId, change: "created", shapes: 4 } },
    ]);
    expect(JSON.stringify(events.rows)).not.toContain("Volume");
    const listed = await call(photographer, "GET", "/annotations");
    expect(listed.json().data.map((x: { id: string }) => x.id)).toContain(a.id);
  });

  it("accepts only the palette, the widths and normalized coordinates, and no measurements", async () => {
    const bad = [
      { type: "LINE", from: [0, 0], to: [1.2, 0.5], color: "RED", stroke: "THIN" },
      { type: "LINE", from: [0, 0], to: [0.5, 0.5], color: "PINK", stroke: "THIN" },
      { type: "LINE", from: [0, 0], to: [0.5, 0.5], color: "RED", stroke: "HEAVY" },
      { type: "MEASURE", from: [0, 0], to: [0.5, 0.5], color: "RED", stroke: "THIN", millimetres: 12 },
      { type: "TEXT", position: [0.1, 0.1], text: "x".repeat(201), color: "RED", size: "SMALL" },
    ];
    for (const shape of bad) {
      const res = await call(
        surgeon,
        "POST",
        "/annotations",
        { layer: { schemaVersion: 1, shapes: [shape] } },
        idem(),
      );
      expect(res.statusCode, JSON.stringify(shape)).toBe(400);
    }
    const tooMany = Array.from({ length: 501 }, () => layer.shapes[0]);
    const res = await call(
      surgeon,
      "POST",
      "/annotations",
      { layer: { schemaVersion: 1, shapes: tooMany } },
      idem(),
    );
    expect(res.statusCode).toBe(400);
  });

  it("lets only the author change or delete a layer, with If-Match, and keeps the row", async () => {
    const a = (await call(surgeon, "POST", "/annotations", { layer }, idem())).json().data;
    expect((await call(nurse, "PATCH", `/annotations/${a.id}`, { label: "Mine" }, at(1))).statusCode).toBe(
      403,
    );
    expect((await call(nurse, "DELETE", `/annotations/${a.id}`, undefined, at(1))).statusCode).toBe(403);
    const renamed = await call(surgeon, "PATCH", `/annotations/${a.id}`, { label: "Cheeks" }, at(1));
    expect(renamed.json().data).toMatchObject({ label: "Cheeks", version: 2 });
    expect((await call(surgeon, "PATCH", `/annotations/${a.id}`, { label: "x" }, at(1))).statusCode).toBe(
      412,
    );
    expect((await call(surgeon, "DELETE", `/annotations/${a.id}`, undefined, at(2))).statusCode).toBe(204);
    expect(
      (await call(surgeon, "GET", "/annotations")).json().data.map((x: { id: string }) => x.id),
    ).not.toContain(a.id);
    expect((await call(surgeon, "PATCH", `/annotations/${a.id}`, { label: "Back" }, at(3))).statusCode).toBe(
      404,
    );
    const kept = await api.db.query(`SELECT "deletedAt" FROM "PhotoAnnotation" WHERE id = $1`, [a.id]);
    expect(kept.rows[0].deletedAt).not.toBeNull();
  });

  it("takes a client ID for a layer drawn offline, and replays its creation", async () => {
    const id = uuidv7();
    const key = idem();
    const first = await call(surgeon, "POST", "/annotations", { id, layer }, key);
    const again = await call(surgeon, "POST", "/annotations", { id, layer }, key);
    expect([first.json().data.id, again.json().data.id]).toEqual([id, id]);
    expect((await call(surgeon, "POST", "/annotations", { id, layer }, idem())).statusCode).toBe(409);
  });

  it("annotates only accepted photos that are not archived, and needs photo.annotate", async () => {
    expect((await call(photographer, "POST", "/annotations", { layer }, idem())).statusCode).toBe(403);
    const archived = (
      await fx.photography(org, patient, { capturedByUserId: surgeon.userId, release: false })
    ).photoId;
    await api.db.query(`UPDATE "PatientPhoto" SET status = 'ARCHIVED', "archivedAt" = now() WHERE id = $1`, [
      archived,
    ]);
    const res = await api.request({
      method: "POST",
      url: `/api/v1/patients/${patient}/photos/${archived}/annotations`,
      headers: { ...bearer(surgeon), ...idem() },
      payload: { layer },
    });
    expect(res.statusCode).toBe(409);
  });
});
