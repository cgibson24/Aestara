// Before/after sets (Bible §8.1–8.2, §34.1 #12–14, #17, #20–21; spec §6.3;
// ADR-0026 K3-11 to K3-13): exactly two photos of the same patient, the same
// view and capture order; unknown, other-patient and other-tenant photos give
// one indistinguishable 404; originals untouched; manual alignment and reset.
import { uuidv7 } from "@aestara/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { databaseAvailable, startApi, type TestApi } from "./support/app.ts";
import { bearer, Fixtures, type StaffMember } from "./support/fixtures.ts";

const FACE_FRONT = { subject: "FACE", yawDeg: 0 };
const FACE_LEFT_45 = { subject: "FACE", yawDeg: 45 };
const TORSO_FRONT = { subject: "TORSO", yawDeg: 0 };

describe.runIf(databaseAvailable())("before/after sets (Layer 3)", () => {
  let api: TestApi;
  let fx: Fixtures;
  let org: string;
  let otherOrg: string;
  let patient: string;
  let otherPatient: string;
  let foreignPatient: string;
  let surgeon: StaffMember;
  let foreignSurgeon: StaffMember;
  let photographer: StaffMember;
  let frontDesk: StaffMember;
  let protocolId: string;

  const call = (
    who: StaffMember,
    method: string,
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
    patientId = patient,
  ) =>
    api.request({
      method: method as "GET",
      url: `/api/v1/patients/${patientId}${url}`,
      headers: { ...bearer(who), ...headers },
      ...(payload !== undefined ? { payload: payload as object } : {}),
    });
  const idem = () => ({ "idempotency-key": crypto.randomUUID() });
  const at = (version: number) => ({ "if-match": `"v${version}"` });

  /** A protocol view with a pose target, in its own protocol, of `organizationId`. */
  async function view(organizationId: string, viewKey: string, pose: object | null): Promise<string> {
    const pid = uuidv7();
    const vid = uuidv7();
    await api.db.query(
      `INSERT INTO "PhotographyProtocol" (id, "organizationId", name, "bodyRegion", status, "updatedAt")
       VALUES ($1, $2, 'Fixture', 'FACE', 'DRAFT', now())`,
      [pid, organizationId],
    );
    await api.db.query(
      `INSERT INTO "PhotographyProtocolView" (id, "organizationId", "protocolId", "viewKey", name, "sortOrder", "isRequired", "poseTarget")
       VALUES ($1, $2, $3, $4, $4, 1, true, $5)`,
      [vid, organizationId, pid, viewKey, pose === null ? null : JSON.stringify(pose)],
    );
    await api.db.query(`UPDATE "PhotographyProtocol" SET status = 'ACTIVE' WHERE id = $1`, [pid]);
    protocolId = pid;
    return vid;
  }

  /** A photo of `patientId` for a protocol view, `daysAgo` before now. */
  async function photo(
    organizationId: string,
    patientId: string,
    viewId: string,
    viewKey: string,
    daysAgo: number,
    status = "ACCEPTED",
  ): Promise<string> {
    const objectId = uuidv7();
    const id = uuidv7();
    await api.db.query(
      `INSERT INTO "StorageObject" (id, "organizationId", "objectClass", bucket, "objectKey", "contentType", "byteSize", sha256, status, "scanStatus", "verifiedAt")
       VALUES ($1, $2, 'CLINICAL_ORIGINAL', 'aestara-test-media', $3, 'image/jpeg', 4, $4, 'AVAILABLE', 'CLEAN', now())`,
      [objectId, organizationId, `CLINICAL_ORIGINAL/${uuidv7()}`, "a".repeat(64)],
    );
    await api.db.query(
      `INSERT INTO "PatientPhoto" (id, "organizationId", "patientId", "protocolViewId", "viewKey", source, status, "originalObjectId", "capturedAt", "updatedAt", "archivedAt")
       VALUES ($1, $2, $3, $4, $5, 'PROVIDER_CAPTURE', $6::"PhotoStatus", $7, now() - make_interval(days => $8::int), now(),
               CASE WHEN $6::text = 'ARCHIVED' THEN now() END)`,
      [id, organizationId, patientId, viewId, viewKey, status, objectId, daysAgo],
    );
    return id;
  }

  async function original(photoId: string) {
    return (
      await api.db.query(
        `SELECT o."objectKey", o.sha256, p."capturedAt" FROM "PatientPhoto" p JOIN "StorageObject" o ON o.id = p."originalObjectId" WHERE p.id = $1`,
        [photoId],
      )
    ).rows[0];
  }

  let front: string;
  let left45: string;
  let torsoFront: string;
  let noPose: string;

  beforeAll(async () => {
    api = await startApi();
    fx = new Fixtures(api);
    org = await fx.organization();
    otherOrg = await fx.organization();
    patient = await fx.patient(org);
    otherPatient = await fx.patient(org);
    foreignPatient = await fx.patient(otherOrg);
    surgeon = await fx.staff(org, "SURGEON_PHYSICIAN");
    foreignSurgeon = await fx.staff(otherOrg, "SURGEON_PHYSICIAN");
    photographer = await fx.staff(org, "PHOTOGRAPHER");
    frontDesk = await fx.staff(org, "FRONT_DESK");
    front = await view(org, "FRONT", FACE_FRONT);
    left45 = await view(org, "LEFT_45", FACE_LEFT_45);
    torsoFront = await view(org, "FRONT", TORSO_FRONT);
    noPose = await view(org, "FRONT", null);
  });
  afterAll(async () => api?.close());

  it("pairs two photos of the same patient and view, audited, originals untouched [B §34.1 #12, #14]", async () => {
    const before = await photo(org, patient, front, "FRONT", 90);
    const after = await photo(org, patient, front, "FRONT", 1);
    const originals = [await original(before), await original(after)];
    const res = await call(
      photographer,
      "POST",
      "/before-after",
      { beforePhotoId: before, afterPhotoId: after, title: "Lips, 3 months" },
      idem(),
    );
    expect(res.statusCode, res.body).toBe(201);
    const set = res.json().data;
    expect(set).toMatchObject({
      beforePhotoId: before,
      afterPhotoId: after,
      viewKey: "FRONT",
      registrationMode: "NONE",
      title: "Lips, 3 months",
      version: 1,
    });
    expect(set.registrationTransform).toBeUndefined();
    const events = await api.db.query(`SELECT action, metadata FROM "AuditEvent" WHERE "resourceId" = $1`, [
      set.id,
    ]);
    expect(events.rows).toEqual([
      { action: "BEFORE_AFTER_CREATED", metadata: { beforePhotoId: before, afterPhotoId: after } },
    ]);
    expect(JSON.stringify(events.rows)).not.toContain("Lips");
    expect([await original(before), await original(after)]).toEqual(originals);
    const listed = await call(photographer, "GET", "/before-after");
    expect(listed.json().data.map((s: { id: string }) => s.id)).toContain(set.id);
  });

  it("gives the same 404 for unknown, other-patient and other-tenant photos [B §34.1 #13, #20]", async () => {
    const before = await photo(org, patient, front, "FRONT", 60);
    const ofOtherPatient = await photo(org, otherPatient, front, "FRONT", 1);
    const foreignView = await view(otherOrg, "FRONT", FACE_FRONT);
    const ofOtherTenant = await photo(otherOrg, foreignPatient, foreignView, "FRONT", 1);
    const bodies = [];
    for (const afterPhotoId of [uuidv7(), ofOtherPatient, ofOtherTenant]) {
      const res = await call(
        surgeon,
        "POST",
        "/before-after",
        { beforePhotoId: before, afterPhotoId },
        idem(),
      );
      expect(res.statusCode).toBe(404);
      bodies.push({ code: res.json().error.code, message: res.json().error.message });
    }
    expect(bodies[0]).toEqual({
      code: "PHOTO_NOT_FOUND",
      message: "The requested photo could not be accessed.",
    });
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    const foreign = await call(foreignSurgeon, "GET", "/before-after");
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().error.code).toBe("PATIENT_NOT_FOUND");
  });

  it("refuses photos of different views [Bible §8.1 'compatible view']", async () => {
    const before = await photo(org, patient, front, "FRONT", 60);
    for (const [viewId, key] of [
      [left45, "LEFT_45"],
      [torsoFront, "FRONT"],
      [noPose, "FRONT"],
    ] as const) {
      const after = await photo(org, patient, viewId, key, 1);
      const res = await call(
        surgeon,
        "POST",
        "/before-after",
        { beforePhotoId: before, afterPhotoId: after },
        idem(),
      );
      expect(res.statusCode, `${key}`).toBe(422);
      expect(res.json().error.code).toBe("INCOMPATIBLE_VIEWS");
    }
  });

  it("refuses a before photo that is not the earlier one, and the same photo twice", async () => {
    const earlier = await photo(org, patient, front, "FRONT", 60);
    const later = await photo(org, patient, front, "FRONT", 1);
    const reversed = await call(
      surgeon,
      "POST",
      "/before-after",
      { beforePhotoId: later, afterPhotoId: earlier },
      idem(),
    );
    expect(reversed.statusCode).toBe(422);
    expect(reversed.json().error.code).toBe("BEFORE_AFTER_ORDER");
    const same = await call(
      surgeon,
      "POST",
      "/before-after",
      { beforePhotoId: earlier, afterPhotoId: earlier },
      idem(),
    );
    expect(same.statusCode).toBe(400);
  });

  it("uses only accepted photos that are not archived", async () => {
    const before = await photo(org, patient, front, "FRONT", 60);
    for (const status of ["ARCHIVED", "QUARANTINED", "REJECTED"]) {
      const after = await photo(org, patient, front, "FRONT", 1, status);
      const res = await call(
        surgeon,
        "POST",
        "/before-after",
        { beforePhotoId: before, afterPhotoId: after },
        idem(),
      );
      expect(res.statusCode, status).toBe(409);
    }
  });

  it("links a consultation of the same patient only", async () => {
    const before = await photo(org, patient, front, "FRONT", 60);
    const after = await photo(org, patient, front, "FRONT", 1);
    const practice = await fx.practice(org);
    const elsewhere = await fx.consultation(org, otherPatient, practice, surgeon.userId);
    const res = await call(
      surgeon,
      "POST",
      "/before-after",
      { beforePhotoId: before, afterPhotoId: after, consultationId: elsewhere },
      idem(),
    );
    expect(res.json().error.details.fieldErrors[0].code).toBe("UNKNOWN_CONSULTATION");
    const own = await fx.consultation(org, patient, practice, surgeon.userId);
    const linked = await call(
      surgeon,
      "POST",
      "/before-after",
      { beforePhotoId: before, afterPhotoId: after, consultationId: own },
      idem(),
    );
    expect(linked.json().data.consultationId).toBe(own);
    const filtered = await call(surgeon, "GET", `/before-after?consultationId=${own}`);
    expect(filtered.json().data.map((s: { id: string }) => s.id)).toEqual([linked.json().data.id]);
  });

  it("aligns by hand and resets, with If-Match and photo.annotate [B §34.1 #17]", async () => {
    const before = await photo(org, patient, front, "FRONT", 60);
    const after = await photo(org, patient, front, "FRONT", 1);
    const set = (
      await call(surgeon, "POST", "/before-after", { beforePhotoId: before, afterPhotoId: after }, idem())
    ).json().data;
    const transform = { scale: 1.04, rotationDeg: -2.5, translateX: 0.01, translateY: -0.02 };
    const denied = await call(
      photographer,
      "PATCH",
      `/before-after/${set.id}`,
      { registration: { mode: "MANUAL", transform } },
      at(1),
    );
    expect(denied.statusCode).toBe(403);
    const aligned = await call(
      surgeon,
      "PATCH",
      `/before-after/${set.id}`,
      { registration: { mode: "MANUAL", transform } },
      at(1),
    );
    expect(aligned.statusCode, aligned.body).toBe(200);
    expect(aligned.json().data).toMatchObject({
      registrationMode: "MANUAL",
      registrationTransform: transform,
      version: 2,
    });
    const tooFar = await call(
      surgeon,
      "PATCH",
      `/before-after/${set.id}`,
      { registration: { mode: "MANUAL", transform: { ...transform, scale: 9 } } },
      at(2),
    );
    expect(tooFar.statusCode).toBe(400);
    const stale = await call(
      surgeon,
      "PATCH",
      `/before-after/${set.id}`,
      { registration: { mode: "NONE" } },
      at(1),
    );
    expect(stale.statusCode).toBe(412);
    const reset = await call(
      surgeon,
      "PATCH",
      `/before-after/${set.id}`,
      { registration: { mode: "NONE" } },
      at(2),
    );
    expect(reset.json().data.registrationMode).toBe("NONE");
    expect(reset.json().data.registrationTransform).toBeUndefined();
    expect([await original(before), await original(after)].every(Boolean)).toBe(true);
  });

  it("is photo data: patient.read alone does not reach it", async () => {
    expect((await call(frontDesk, "GET", "/before-after")).statusCode).toBe(403);
    expect(protocolId).toBeDefined();
  });
});
