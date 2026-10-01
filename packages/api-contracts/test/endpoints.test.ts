// Invariants of the Layer 1 endpoint registry (spec §6.1, §6.3, §6.4).
import { AuditAction } from "@aestara/shared-types";
import { describe, expect, it } from "vitest";
import {
  DuplicateCheckRequest,
  ENDPOINTS,
  type EndpointDefinition,
  errorStatuses,
  NOT_FOUND_PATTERN,
  Npi,
  PatientCreate,
  PatientSearchRequest,
  PatientUpdate,
  RoleAssignmentCreate,
  routePath,
  SessionPolicy,
} from "../src/index.ts";

const all: readonly EndpointDefinition[] = ENDPOINTS;

/** Words that would put PHI or a secret into a URL (spec §6.1.10, ADR-0018 K-09). */
const FORBIDDEN_URL_FIELDS = [
  "name",
  "firstName",
  "lastName",
  "dateOfBirth",
  "email",
  "phone",
  "mrn",
  "token",
  "password",
  "code",
];

describe("endpoint registry", () => {
  it("has unique operation IDs and unique method + path pairs", () => {
    expect(new Set(all.map((e) => e.operationId)).size).toBe(all.length);
    expect(new Set(all.map((e) => `${e.method} ${e.path}`)).size).toBe(all.length);
  });

  it("declares exactly the path parameters its path uses", () => {
    for (const e of all) {
      const inPath = [...e.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      const declared = Object.keys(e.params?.shape ?? {}).sort();
      expect(declared, e.operationId).toEqual(inPath);
    }
  });

  it("names a <RESOURCE>_NOT_FOUND code for every path resource", () => {
    for (const e of all.filter((x) => x.params !== undefined)) {
      expect(e.notFound, e.operationId).toMatch(NOT_FOUND_PATTERN);
    }
  });

  it("never carries PHI or secrets in a query string", () => {
    for (const e of all) {
      for (const key of Object.keys(e.query?.shape ?? {})) {
        expect(FORBIDDEN_URL_FIELDS, `${e.operationId}?${key}`).not.toContain(key);
      }
    }
  });

  it("requires If-Match on every PATCH and Idempotency-Key on patient creation", () => {
    for (const e of all.filter((x) => x.method === "PATCH"))
      expect(e.ifMatch, e.operationId).toBe("required");
    expect(all.find((e) => e.operationId === "createPatient")?.idempotency).toBe("required");
    expect(all.find((e) => e.operationId === "createUser")?.idempotency).toBe("required");
  });

  it("only audits actions of the AuditAction enum", () => {
    for (const e of all) for (const a of e.audit ?? []) expect(AuditAction, e.operationId).toContain(a);
  });

  it("marks every patient route for ACCESS_DENIED auditing", () => {
    for (const e of all.filter((x) => x.path.startsWith("/patients")))
      expect(e.patientData, e.operationId).toBe(true);
  });

  it("covers the Layer 1 subset of spec §6.4", () => {
    const prefixes = new Set(all.map((e) => `/${e.path.split("/")[1]}`));
    for (const p of [
      "/auth",
      "/organizations",
      "/practices",
      "/locations",
      "/users",
      "/roles",
      "/permissions",
      "/patients",
      "/audit",
      "/settings",
      "/health",
      "/.well-known",
    ])
      expect(prefixes).toContain(p);
  });

  it("derives error statuses from auth, parameters and headers", () => {
    const update = all.find((e) => e.operationId === "updatePatient");
    expect(update && errorStatuses(update)).toEqual([400, 401, 403, 404, 409, 412, 428, 500, 503]);
    const live = all.find((e) => e.operationId === "getLiveness");
    expect(live && errorStatuses(live)).toEqual([400, 500, 503]);
  });

  it("converts paths to the router form", () => {
    expect(routePath("/patients/{patientId}/contacts/{contactId}")).toBe(
      "/patients/:patientId/contacts/:contactId",
    );
  });
});

describe("Layer 1 request schemas", () => {
  const ana = { firstName: "Ana", lastName: "Reyes", dateOfBirth: "1988-04-12" };

  it("never accepts organizationId on a patient (spec §6.6.1)", () => {
    expect(
      PatientCreate.safeParse({ ...ana, organizationId: "0192f7c4-5b1e-7c3a-9d2f-6a1b2c3d4e5f" }).success,
    ).toBe(false);
  });

  it("rejects future dates of birth and non-E.164 phones", () => {
    expect(PatientCreate.safeParse({ ...ana, dateOfBirth: "2999-01-01" }).success).toBe(false);
    expect(PatientCreate.safeParse({ ...ana, phone: "555-0123" }).success).toBe(false);
    expect(PatientCreate.parse(ana).confirmNoDuplicate).toBe(false);
  });

  it("never lets an update set ARCHIVED (spec §5.4.10)", () => {
    expect(PatientUpdate.safeParse({ status: "ARCHIVED" }).success).toBe(false);
    expect(PatientUpdate.safeParse({ status: "DECEASED" }).success).toBe(true);
    expect(PatientUpdate.safeParse({}).success).toBe(false);
  });

  it("requires at least one search term", () => {
    expect(PatientSearchRequest.safeParse({}).success).toBe(false);
    expect(PatientSearchRequest.parse({ name: "rey" }).limit).toBe(25);
  });

  it("checks role assignment scope shapes", () => {
    const roleId = "0192f7c4-5b1e-7c3a-9d2f-6a1b2c3d4e5f";
    expect(RoleAssignmentCreate.safeParse({ roleId, scope: "ORGANIZATION" }).success).toBe(true);
    expect(RoleAssignmentCreate.safeParse({ roleId, scope: "PRACTICE" }).success).toBe(false);
    expect(RoleAssignmentCreate.safeParse({ roleId, scope: "PLATFORM" }).success).toBe(false);
    expect(
      RoleAssignmentCreate.safeParse({ roleId, scope: "ORGANIZATION", practiceId: roleId }).success,
    ).toBe(false);
  });

  it("validates NPI check digits", () => {
    expect(Npi.safeParse("1234567893").success).toBe(true);
    expect(Npi.safeParse("1234567890").success).toBe(false);
  });

  it("lets organizations shorten session lifetimes, never extend them", () => {
    const base = {
      IOS_PROVIDER: { idleMinutes: 60, absoluteHours: 24 },
      ADMIN_WEB: { idleMinutes: 15, absoluteHours: 8 },
      IOS_PATIENT: { idleMinutes: 60, absoluteHours: 24 },
    };
    expect(SessionPolicy.safeParse(base).success).toBe(true);
    expect(
      SessionPolicy.safeParse({ ...base, ADMIN_WEB: { idleMinutes: 60, absoluteHours: 8 } }).success,
    ).toBe(false);
  });

  it("requires names and a date of birth for a duplicate check", () => {
    expect(DuplicateCheckRequest.safeParse({ firstName: "Ana", lastName: "Reyes" }).success).toBe(false);
  });
});
