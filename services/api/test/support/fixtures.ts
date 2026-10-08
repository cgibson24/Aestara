// Synthetic fixtures (never PHI) inserted directly as existing data, plus
// sign-in helpers that go through the real HTTP flows.
import { randomUUID } from "node:crypto";
import { catalogId, uuidv7 } from "@aestara/database";
import { expect } from "vitest";
import { LocalSealer } from "../../src/auth/keys.ts";
import { hashPassword } from "../../src/auth/passwords.ts";
import { hotp, newTotpSecret, totpStep } from "../../src/auth/totp.ts";
import type { TestApi } from "./app.ts";

export const PASSWORD = "correct horse battery staple 7";

let passwordHash: Promise<string> | undefined;
const sharedHash = () => {
  passwordHash ??= hashPassword(PASSWORD);
  return passwordHash;
};

export interface StaffMember {
  readonly userId: string;
  readonly email: string;
  readonly totpSecret?: Buffer;
  accessToken: string;
  refreshToken?: string;
  sessionId: string;
}

export class Fixtures {
  private seq = 0;
  constructor(private readonly api: TestApi) {}

  async organization(name = `Org ${++this.seq}`): Promise<string> {
    const id = uuidv7();
    await this.api.db.query(
      `INSERT INTO "Organization" (id, name, slug, "updatedAt") VALUES ($1, $2, $3, now())`,
      [id, name, `org-${id.slice(-12)}`],
    );
    return id;
  }

  async practice(organizationId: string, name = `Practice ${++this.seq}`): Promise<string> {
    const id = uuidv7();
    await this.api.db.query(
      `INSERT INTO "Practice" (id, "organizationId", name, timezone, "updatedAt") VALUES ($1, $2, $3, 'America/New_York', now())`,
      [id, organizationId, name],
    );
    return id;
  }

  async location(
    organizationId: string,
    practiceId: string,
    name = `Location ${++this.seq}`,
  ): Promise<string> {
    const id = uuidv7();
    await this.api.db.query(
      `INSERT INTO "Location" (id, "organizationId", "practiceId", name, timezone, "updatedAt")
       VALUES ($1, $2, $3, $4, 'America/New_York', now())`,
      [id, organizationId, practiceId, name],
    );
    return id;
  }

  async user(
    options: { email?: string; status?: string; password?: boolean } = {},
  ): Promise<{ id: string; email: string }> {
    const id = uuidv7();
    const email = options.email ?? `staff-${randomUUID().slice(0, 8)}@example.test`;
    await this.api.db.query(
      `INSERT INTO "User" (id, kind, email, "displayName", status, "updatedAt") VALUES ($1, 'WORKFORCE', $2, 'Test Staff', $3::"UserStatus", now())`,
      [id, email, options.status ?? "ACTIVE"],
    );
    if (options.password !== false)
      await this.api.db.query(
        `INSERT INTO "UserCredential" (id, "userId", type, "passwordHash", "confirmedAt", "createdAt")
         VALUES ($1, $2, 'PASSWORD', $3, now() - interval '1 day', now() - interval '1 day')`,
        [uuidv7(), id, await sharedHash()],
      );
    return { id, email };
  }

  async membership(organizationId: string, userId: string, status = "ACTIVE"): Promise<string> {
    const id = uuidv7();
    await this.api.db.query(
      `INSERT INTO "Membership" (id, "organizationId", "userId", status, "activatedAt", "updatedAt")
       VALUES ($1, $2, $3, $4::"MembershipStatus", CASE WHEN $4::text = 'ACTIVE' THEN now() END, now())`,
      [id, organizationId, userId, status],
    );
    return id;
  }

  async grant(
    userId: string,
    roleKey: string,
    scope: { organizationId?: string; practiceId?: string; locationId?: string } = {},
  ): Promise<string> {
    const id = uuidv7();
    const kind =
      scope.organizationId === undefined
        ? "PLATFORM"
        : scope.locationId
          ? "LOCATION"
          : scope.practiceId
            ? "PRACTICE"
            : "ORGANIZATION";
    await this.api.db.query(
      `INSERT INTO "UserRole" (id, "userId", "organizationId", "roleId", scope, "practiceId", "locationId")
       VALUES ($1, $2, $3, $4, $5::"RoleAssignmentScope", $6, $7)`,
      [
        id,
        userId,
        scope.organizationId ?? null,
        catalogId("role", roleKey),
        kind,
        scope.practiceId ?? null,
        scope.locationId ?? null,
      ],
    );
    return id;
  }

  async totp(userId: string): Promise<Buffer> {
    const secret = newTotpSecret();
    const sealed = await new LocalSealer(this.api.sealKey).seal(secret, `totp:${userId}`);
    await this.api.db.query(
      `INSERT INTO "UserCredential" (id, "userId", type, "totpSecretCiphertext", label, "confirmedAt")
       VALUES ($1, $2, 'TOTP', $3, 'Test authenticator', now())`,
      [uuidv7(), userId, sealed],
    );
    return secret;
  }

  async patient(organizationId: string, fields: Record<string, unknown> = {}): Promise<string> {
    const id = uuidv7();
    const p: Record<string, unknown> = {
      firstName: "Ana",
      lastName: "Synthetic",
      dateOfBirth: "1988-04-12",
      ...fields,
    };
    await this.api.db.query(
      `INSERT INTO "Patient" (id, "organizationId", "firstName", "lastName", "dateOfBirth", email, phone, mrn, "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
      [
        id,
        organizationId,
        p.firstName,
        p.lastName,
        p.dateOfBirth,
        p.email ?? null,
        p.phone ?? null,
        p.mrn ?? null,
      ],
    );
    return id;
  }

  /**
   * Photography data that already exists for a patient (ADR-0023): an ACTIVE
   * one-view protocol, a session, an accepted photo whose original is stored and
   * scanned clean, a patient-wide PATIENT_APP grant, and a release pinning it.
   */
  async photography(
    organizationId: string,
    patientId: string,
    options: {
      capturedByUserId: string;
      objectKey?: string;
      sha256?: string;
      byteSize?: number;
      release?: boolean;
    },
  ): Promise<{
    protocolId: string;
    photoSessionId: string;
    photoId: string;
    releaseId: string;
    permissionId: string;
    objectKey: string;
  }> {
    const protocolId = uuidv7();
    const photoSessionId = uuidv7();
    const objectId = uuidv7();
    const photoId = uuidv7();
    const permissionId = uuidv7();
    const releaseId = uuidv7();
    const objectKey = options.objectKey ?? `CLINICAL_ORIGINAL/${uuidv7()}`;
    const q = (sql: string, values: unknown[]) => this.api.db.query(sql, values);
    await q(
      `INSERT INTO "PhotographyProtocol" (id, "organizationId", name, "bodyRegion", status, "createdById", "updatedAt")
       VALUES ($1, $2, 'Fixture face', 'FACE', 'DRAFT', $3, now())`,
      [protocolId, organizationId, options.capturedByUserId],
    );
    await q(
      `INSERT INTO "PhotographyProtocolView" (id, "organizationId", "protocolId", "viewKey", name, "sortOrder", "isRequired")
       VALUES ($1, $2, $3, 'FRONT', 'Front', 1, true)`,
      [uuidv7(), organizationId, protocolId],
    );
    await q(`UPDATE "PhotographyProtocol" SET status = 'ACTIVE' WHERE id = $1`, [protocolId]);
    await q(
      `INSERT INTO "PhotoSession" (id, "organizationId", "patientId", "protocolId", source, "capturedByUserId", "startedAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'PROVIDER_CAPTURE', $5, now(), now())`,
      [photoSessionId, organizationId, patientId, protocolId, options.capturedByUserId],
    );
    await q(
      `INSERT INTO "StorageObject" (id, "organizationId", "objectClass", bucket, "objectKey", "contentType", "byteSize", sha256, status, "scanStatus", "verifiedAt")
       VALUES ($1, $2, 'CLINICAL_ORIGINAL', 'aestara-test-media', $3, 'image/jpeg', $4, $5, 'AVAILABLE', 'CLEAN', now())`,
      [objectId, organizationId, objectKey, options.byteSize ?? 4, options.sha256 ?? "a".repeat(64)],
    );
    await q(
      `INSERT INTO "PatientPhoto" (id, "organizationId", "patientId", "photoSessionId", "viewKey", source, status, "originalObjectId", "capturedByUserId", "capturedAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'FRONT', 'PROVIDER_CAPTURE', 'ACCEPTED', $5, $6, now(), now())`,
      [photoId, organizationId, patientId, photoSessionId, objectId, options.capturedByUserId],
    );
    if (options.release !== false) {
      await q(
        `INSERT INTO "PhotoPermission" (id, "organizationId", "patientId", category, scope, state, "versionNumber", "effectiveAt", evidence)
         VALUES ($1, $2, $3, 'PATIENT_APP', 'PATIENT_WIDE', 'GRANTED', 1, now(), 'STAFF_ATTESTATION')`,
        [permissionId, organizationId, patientId],
      );
      await q(
        `WITH r AS (
           INSERT INTO "MediaRelease" (id, "organizationId", "patientId", purpose, "photoId", "releasedById")
           VALUES ($1, $2, $3, 'PATIENT_APP', $4, $5) RETURNING id)
         INSERT INTO "MediaReleasePermission" ("organizationId", "patientId", "mediaReleaseId", "permissionId")
         SELECT $2, $3, r.id, $6 FROM r`,
        [releaseId, organizationId, patientId, photoId, options.capturedByUserId, permissionId],
      );
    }
    return { protocolId, photoSessionId, photoId, releaseId, permissionId, objectKey };
  }

  /**
   * A ready CLINICAL_USE export of a photo, as the worker leaves it: a verified
   * output object, a succeeded job and a release pinning a patient-wide grant.
   */
  async export(organizationId: string, patientId: string, photoId: string, userId: string): Promise<string> {
    const exportId = uuidv7();
    const objectId = uuidv7();
    const jobId = uuidv7();
    const releaseId = uuidv7();
    const permissionId = uuidv7();
    const q = (sql: string, values: unknown[]) => this.api.db.query(sql, values);
    await q(
      `INSERT INTO "StorageObject" (id, "organizationId", "objectClass", bucket, "objectKey", "contentType", "byteSize", sha256, status, "scanStatus", "verifiedAt")
       VALUES ($1, $2, 'CLINICAL_DERIVATIVE', 'aestara-test-media', $3, 'image/jpeg', 4, $4, 'AVAILABLE', 'NOT_REQUIRED', now())`,
      [objectId, organizationId, `CLINICAL_DERIVATIVE/${uuidv7()}`, "c".repeat(64)],
    );
    await q(
      `INSERT INTO "AIJob" (id, "organizationId", "patientId", "jobType", status, "idempotencyKey", "requestedById", attempt, "inputSummary", "resultSummary", "startedAt", "finishedAt", "updatedAt")
       VALUES ($1, $2, $3, 'IMAGE_DERIVATIVE', 'SUCCEEDED', $4, $5, 1, $6, '{"widthPx": 400, "heightPx": 300}', now(), now(), now())`,
      [
        jobId,
        organizationId,
        patientId,
        `export:${exportId}`,
        userId,
        JSON.stringify({
          exportId,
          releaseId,
          objectId,
          layout: "SINGLE",
          photoIds: [photoId],
          transform: null,
        }),
      ],
    );
    await q(
      `INSERT INTO "PhotoDerivative" (id, "organizationId", "patientId", "sourcePhotoId", kind, "storageObjectId", "generationMetadata", "generatedByJobId", "createdById")
       VALUES ($1, $2, $3, $4, 'EXPORT_DERIVATIVE', $5, '{"layout": "SINGLE", "maxEdgePx": 4096}', $6, $7)`,
      [exportId, organizationId, patientId, photoId, objectId, jobId, userId],
    );
    await q(
      `INSERT INTO "PhotoPermission" (id, "organizationId", "patientId", category, scope, state, "versionNumber", "effectiveAt", evidence)
       VALUES ($1, $2, $3, 'CLINICAL_USE', 'PATIENT_WIDE', 'GRANTED', 1, now(), 'STAFF_ATTESTATION')`,
      [permissionId, organizationId, patientId],
    );
    await q(
      `WITH r AS (
         INSERT INTO "MediaRelease" (id, "organizationId", "patientId", purpose, "derivativeId", "releasedById")
         VALUES ($1, $2, $3, 'CLINICAL_USE', $4, $5) RETURNING id)
       INSERT INTO "MediaReleasePermission" ("organizationId", "patientId", "mediaReleaseId", "permissionId")
       SELECT $2, $3, r.id, $6 FROM r`,
      [releaseId, organizationId, patientId, exportId, userId, permissionId],
    );
    return exportId;
  }

  /** An uploaded clinical PDF with one available version. */
  /** A category and one treatment in it (ADR-0028 K4-03). */
  async treatmentCatalog(
    organizationId: string,
  ): Promise<{ treatmentCategoryId: string; treatmentId: string }> {
    const treatmentCategoryId = uuidv7();
    const treatmentId = uuidv7();
    await this.api.db.query(
      `INSERT INTO "TreatmentCategory" (id, "organizationId", name, "updatedAt") VALUES ($1, $2, 'Injectables', now())`,
      [treatmentCategoryId, organizationId],
    );
    await this.api.db.query(
      `INSERT INTO "Treatment" (id, "organizationId", "categoryId", name, "defaultUnitPrice", "updatedAt")
       VALUES ($1, $2, $3, 'Lip filler', 450, now())`,
      [treatmentId, organizationId, treatmentCategoryId],
    );
    return { treatmentCategoryId, treatmentId };
  }

  /** A DRAFT plan option of a consultation with one priced item (ADR-0028 K4-04). */
  async treatmentPlan(
    organizationId: string,
    patientId: string,
    practiceId: string,
    consultationId: string | null,
    treatmentId: string,
    createdById: string,
  ): Promise<string> {
    const id = uuidv7();
    await this.api.db.query(
      `INSERT INTO "TreatmentPlan" (id, "organizationId", "patientId", "consultationId", "practiceId", "optionLabel", title,
                                    subtotal, "estimatedTotal", "createdById", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'Plan A', 'Lips', 450, 450, $6, now())`,
      [id, organizationId, patientId, consultationId, practiceId, createdById],
    );
    await this.api.db.query(
      `INSERT INTO "TreatmentPlanItem" (id, "organizationId", "patientId", "treatmentPlanId", "treatmentId", "unitPrice", "lineTotal", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 450, 450, now())`,
      [uuidv7(), organizationId, patientId, id, treatmentId],
    );
    return id;
  }

  async document(organizationId: string, patientId: string, userId: string): Promise<string> {
    const objectId = uuidv7();
    const documentId = uuidv7();
    const q = (sql: string, values: unknown[]) => this.api.db.query(sql, values);
    await q(
      `INSERT INTO "StorageObject" (id, "organizationId", "objectClass", bucket, "objectKey", "contentType", "byteSize", sha256, status, "scanStatus", "verifiedAt")
       VALUES ($1, $2, 'DOCUMENT', 'aestara-test-media', $3, 'application/pdf', 10, $4, 'AVAILABLE', 'CLEAN', now())`,
      [objectId, organizationId, `DOCUMENT/${uuidv7()}`, "d".repeat(64)],
    );
    await q(
      `INSERT INTO "Document" (id, "organizationId", "patientId", type, title, "createdById", "updatedAt")
       VALUES ($1, $2, $3, 'UPLOADED_CLINICAL', 'Referral letter', $4, now())`,
      [documentId, organizationId, patientId, userId],
    );
    await q(
      `INSERT INTO "DocumentVersion" (id, "organizationId", "patientId", "documentId", "versionNumber", "storageObjectId", sha256, "createdById")
       VALUES ($1, $2, $3, $4, 1, $5, $6, $7)`,
      [uuidv7(), organizationId, patientId, documentId, objectId, "d".repeat(64), userId],
    );
    return documentId;
  }

  /** An empty annotation layer on a photo, by its author. */
  async annotation(
    organizationId: string,
    patientId: string,
    photoId: string,
    authorUserId: string,
  ): Promise<string> {
    const id = uuidv7();
    await this.api.db.query(
      `INSERT INTO "PhotoAnnotation" (id, "organizationId", "patientId", "photoId", "authorUserId", layer, "updatedAt")
       VALUES ($1, $2, $3, $4, $5, '{"schemaVersion": 1, "shapes": []}', now())`,
      [id, organizationId, patientId, photoId, authorUserId],
    );
    return id;
  }

  /** A later photo of the same view as `beforePhotoId`, and a before/after set of the two. */
  async beforeAfter(
    organizationId: string,
    patientId: string,
    beforePhotoId: string,
    createdById: string,
  ): Promise<string> {
    const objectId = uuidv7();
    const afterId = uuidv7();
    const setId = uuidv7();
    const q = (sql: string, values: unknown[]) => this.api.db.query(sql, values);
    await q(
      `INSERT INTO "StorageObject" (id, "organizationId", "objectClass", bucket, "objectKey", "contentType", "byteSize", sha256, status, "scanStatus", "verifiedAt")
       VALUES ($1, $2, 'CLINICAL_ORIGINAL', 'aestara-test-media', $3, 'image/jpeg', 4, $4, 'AVAILABLE', 'CLEAN', now())`,
      [objectId, organizationId, `CLINICAL_ORIGINAL/${uuidv7()}`, "e".repeat(64)],
    );
    await q(
      `INSERT INTO "PatientPhoto" (id, "organizationId", "patientId", "photoSessionId", "protocolViewId", "viewKey", source, status, "originalObjectId", "capturedByUserId", "capturedAt", "updatedAt")
       SELECT $1, $2, $3, "photoSessionId", "protocolViewId", "viewKey", 'PROVIDER_CAPTURE', 'ACCEPTED', $4, $5, "capturedAt" + interval '30 days', now()
         FROM "PatientPhoto" WHERE id = $6`,
      [afterId, organizationId, patientId, objectId, createdById, beforePhotoId],
    );
    await q(
      `INSERT INTO "BeforeAfterSet" (id, "organizationId", "patientId", "beforePhotoId", "afterPhotoId", "viewKey", "createdById", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'FRONT', $6, now())`,
      [setId, organizationId, patientId, beforePhotoId, afterId, createdById],
    );
    return setId;
  }

  /** A draft note in an open consultation, a concern and a history entry of its patient. */
  async clinicalRecords(
    organizationId: string,
    patientId: string,
    consultationId: string,
    authorUserId: string,
  ): Promise<{ noteId: string; concernId: string; entryId: string }> {
    const noteId = uuidv7();
    const concernId = uuidv7();
    const entryId = uuidv7();
    await this.api.db.query(
      `INSERT INTO "ConsultationNote" (id, "organizationId", "patientId", "consultationId", "authorUserId", body, "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'Fixture note', now())`,
      [noteId, organizationId, patientId, consultationId, authorUserId],
    );
    await this.api.db.query(
      `INSERT INTO "PatientConcern" (id, "organizationId", "patientId", area, description, "updatedAt")
       VALUES ($1, $2, $3, 'LIPS', 'Fixture concern', now())`,
      [concernId, organizationId, patientId],
    );
    await this.api.db.query(
      `INSERT INTO "PatientMedicalHistory" (id, "organizationId", "patientId", category, description, "updatedAt")
       VALUES ($1, $2, $3, 'ALLERGY', 'Fixture allergy', now())`,
      [entryId, organizationId, patientId],
    );
    return { noteId, concernId, entryId };
  }

  /** A consultation of a patient, in DRAFT or moved along the spec §5.4.1 machine. */
  async consultation(
    organizationId: string,
    patientId: string,
    practiceId: string,
    createdById: string,
    status: "DRAFT" | "IN_PROGRESS" = "DRAFT",
  ): Promise<string> {
    const id = uuidv7();
    await this.api.db.query(
      `INSERT INTO "Consultation" (id, "organizationId", "patientId", "practiceId", reason, "createdById", "updatedAt")
       VALUES ($1, $2, $3, $4, 'Fixture reason', $5, now())`,
      [id, organizationId, patientId, practiceId, createdById],
    );
    if (status === "IN_PROGRESS")
      await this.api.db.query(
        `UPDATE "Consultation" SET status = 'IN_PROGRESS', "startedAt" = now() WHERE id = $1`,
        [id],
      );
    return id;
  }

  /** A member of an organization holding one role, signed in to the provider app (with MFA when needed). */
  async staff(
    organizationId: string,
    roleKey: string,
    scope: { practiceId?: string; locationId?: string } = {},
  ): Promise<StaffMember> {
    const user = await this.user();
    await this.membership(organizationId, user.id);
    await this.grant(user.id, roleKey, { organizationId, ...scope });
    const needsMfa = ["ORGANIZATION_ADMIN", "PRACTICE_ADMIN", "SUPER_ADMIN"].includes(roleKey);
    const totpSecret = needsMfa ? await this.totp(user.id) : undefined;
    return signIn(this.api, { email: user.email, userId: user.id, totpSecret });
  }

  /** A platform operator (SUPER_ADMIN grant, no membership) signed in to the admin web. */
  async platformOperator(): Promise<StaffMember> {
    const user = await this.user();
    await this.grant(user.id, "SUPER_ADMIN");
    const totpSecret = await this.totp(user.id);
    return signIn(this.api, { email: user.email, userId: user.id, totpSecret, clientApp: "ADMIN_WEB" });
  }
}

/**
 * A TOTP code. Each time step is accepted once per authenticator, so a second
 * sign-in by the same user within 30 seconds uses the next step (offset 1),
 * which the ±1 step window still accepts.
 */
export function nextCode(secret: Buffer, offset = 0): string {
  return hotp(secret, totpStep() + offset);
}

export const DEVICE = {
  installationId: "0192f7c4-5b1e-7c3a-9d2f-6a1b2c3d4e5f",
  name: "Test iPad",
  model: "iPad16,3",
};

export async function signIn(
  api: TestApi,
  who: {
    email: string;
    userId: string;
    totpSecret?: Buffer | undefined;
    clientApp?: string;
    organizationId?: string;
  },
): Promise<StaffMember> {
  const clientApp = who.clientApp ?? "IOS_PROVIDER";
  const device = clientApp === "IOS_PROVIDER" ? { device: DEVICE } : {};
  const headers = clientApp === "ADMIN_WEB" ? { origin: "https://admin.aestara.test" } : {};
  let res = await api.request({
    method: "POST",
    url: "/api/v1/auth/login",
    headers,
    payload: {
      email: who.email,
      password: PASSWORD,
      clientApp,
      ...device,
      ...(who.organizationId ? { organizationId: who.organizationId } : {}),
    },
  });
  if (res.statusCode === 401 && res.json().error.code === "MFA_REQUIRED") {
    if (who.totpSecret === undefined) throw new Error("MFA required but the user has no authenticator");
    res = await api.request({
      method: "POST",
      url: "/api/v1/auth/mfa/verify",
      headers,
      payload: {
        challengeToken: res.json().error.details.challengeToken,
        totpCode: nextCode(who.totpSecret),
        ...device,
        ...(who.organizationId ? { organizationId: who.organizationId } : {}),
      },
    });
  }
  expect(res.statusCode, res.body).toBe(200);
  const body = res.json().data;
  return {
    userId: who.userId,
    email: who.email,
    ...(who.totpSecret ? { totpSecret: who.totpSecret } : {}),
    accessToken: body.accessToken,
    ...(body.refreshToken ? { refreshToken: body.refreshToken } : {}),
    sessionId: body.session.sessionId,
  };
}

/** Authorization header for a signed-in member. */
export function bearer(member: { accessToken: string }): Record<string, string> {
  return { authorization: `Bearer ${member.accessToken}` };
}

export function base32Decode(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...value].map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)));
}
