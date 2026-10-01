import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  collectionEnvelope,
  ENDPOINTS,
  ERROR_CATALOG,
  ErrorEnvelope,
  etagFor,
  generateOpenApiDocument,
  httpStatusFor,
  Money,
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  PageInfo,
  PageQuery,
  RequestId,
  renderOpenApiDocument,
  resourceEnvelope,
  Timestamp,
  Uuid,
} from "../src/index.ts";

const requestId = "0192f7c4-5b1e-7c3a-9d2f-6a1b2c3d4e5f";

describe("error envelope (spec §6.1.5, Bible §20.4)", () => {
  it("accepts the spec example", () => {
    const parsed = ErrorEnvelope.parse({
      error: {
        code: "PATIENT_NOT_FOUND",
        message: "The requested patient could not be accessed.",
        requestId,
        details: {
          fieldErrors: [{ path: "dateOfBirth", code: "INVALID_DATE", message: "Must be a valid date." }],
        },
      },
    });
    expect(parsed.error.code).toBe("PATIENT_NOT_FOUND");
  });

  it("requires a UUIDv7 request ID", () => {
    const v4 = "3b241101-e2bb-4255-8caf-4136c566a962";
    expect(RequestId.safeParse(v4).success).toBe(false);
    expect(
      ErrorEnvelope.safeParse({ error: { code: "INTERNAL_ERROR", message: "x", requestId: v4 } }).success,
    ).toBe(false);
  });

  it("rejects extra fields that could leak internals", () => {
    const withStack = { error: { code: "INTERNAL_ERROR", message: "x", requestId, stack: "at db.query" } };
    expect(ErrorEnvelope.safeParse(withStack).success).toBe(false);
  });

  it("rejects codes that are not UPPER_SNAKE", () => {
    const bad = { error: { code: "notFound", message: "x", requestId } };
    expect(ErrorEnvelope.safeParse(bad).success).toBe(false);
  });
});

describe("error code catalog (spec §6.2)", () => {
  it("maps each code to the status in the spec", () => {
    const expected: Record<number, string[]> = {
      400: ["VALIDATION_FAILED", "MALFORMED_REQUEST"],
      401: ["UNAUTHENTICATED", "SESSION_INVALID", "MFA_REQUIRED"],
      403: [
        "PERMISSION_DENIED",
        "REAUTHENTICATION_REQUIRED",
        "SEPARATION_OF_DUTIES",
        "MEDIA_PERMISSION_NOT_GRANTED",
      ],
      409: [
        "INVALID_STATE_TRANSITION",
        "IMMUTABLE_RECORD",
        "DUPLICATE_PATIENT_SUSPECTED",
        "IDEMPOTENCY_IN_PROGRESS",
        "IDEMPOTENCY_KEY_REUSED",
        "CONFLICT",
        "SYNC_CONFLICT",
      ],
      412: ["VERSION_CONFLICT"],
      413: ["PAYLOAD_TOO_LARGE"],
      415: ["UNSUPPORTED_MEDIA_TYPE"],
      422: [
        "UPLOAD_VERIFICATION_FAILED",
        "REQUIRED_VIEWS_MISSING",
        "INPUT_QUALITY_INSUFFICIENT",
        "UNSUPPORTED_SIMULATION_INPUT",
      ],
      428: ["PRECONDITION_REQUIRED"],
      429: ["RATE_LIMITED"],
      500: ["INTERNAL_ERROR"],
      503: ["SERVICE_UNAVAILABLE"],
    };
    const actual: Record<number, string[]> = {};
    for (const [code, { status }] of Object.entries(ERROR_CATALOG)) {
      actual[status] = [...(actual[status] ?? []), code];
    }
    expect(actual).toEqual(expected);
  });

  it("treats every <RESOURCE>_NOT_FOUND code as 404 and unknown codes as unmapped", () => {
    expect(httpStatusFor("PATIENT_NOT_FOUND")).toBe(404);
    expect(httpStatusFor("PHOTO_SESSION_NOT_FOUND")).toBe(404);
    expect(httpStatusFor("CONFLICT")).toBe(409);
    expect(httpStatusFor("NOT_FOUND")).toBeUndefined();
    expect(httpStatusFor("SOMETHING_NEW")).toBeUndefined();
  });
});

describe("pagination (spec §6.1.6)", () => {
  it("defaults the limit and coerces query-string numbers", () => {
    expect(PageQuery.parse({}).limit).toBe(PAGE_LIMIT_DEFAULT);
    expect(PageQuery.parse({ limit: "40" }).limit).toBe(40);
  });

  it("enforces 1 ≤ limit ≤ 100", () => {
    expect(PageQuery.safeParse({ limit: 0 }).success).toBe(false);
    expect(PageQuery.safeParse({ limit: PAGE_LIMIT_MAX }).success).toBe(true);
    expect(PageQuery.safeParse({ limit: PAGE_LIMIT_MAX + 1 }).success).toBe(false);
    expect(PageQuery.safeParse({ limit: "2.5" }).success).toBe(false);
  });

  it("rejects unknown query parameters", () => {
    expect(PageQuery.safeParse({ limit: 10, offset: 20 }).success).toBe(false);
  });

  it("requires nextCursor whenever hasMore is true", () => {
    expect(PageInfo.safeParse({ hasMore: true }).success).toBe(false);
    expect(PageInfo.safeParse({ hasMore: true, nextCursor: "eyJ" }).success).toBe(true);
    expect(PageInfo.safeParse({ hasMore: false }).success).toBe(true);
  });

  it("builds resource and collection envelopes", () => {
    const Item = Uuid;
    expect(resourceEnvelope(Item).safeParse({ data: requestId }).success).toBe(true);
    expect(collectionEnvelope(Item).safeParse({ data: [requestId], page: { hasMore: false } }).success).toBe(
      true,
    );
    expect(collectionEnvelope(Item).safeParse({ data: [requestId] }).success).toBe(false);
  });
});

describe("value formats (spec §6.1.2)", () => {
  it("represents money as a two-decimal string in USD", () => {
    expect(Money.safeParse({ amount: "1250.00", currency: "USD" }).success).toBe(true);
    expect(Money.safeParse({ amount: 1250, currency: "USD" }).success).toBe(false);
    expect(Money.safeParse({ amount: "1250.5", currency: "USD" }).success).toBe(false);
    expect(Money.safeParse({ amount: "01250.00", currency: "USD" }).success).toBe(false);
    expect(Money.safeParse({ amount: "1250.00", currency: "EUR" }).success).toBe(false);
  });

  it("requires UTC timestamps with milliseconds", () => {
    expect(Timestamp.safeParse("2026-09-25T14:03:11.412Z").success).toBe(true);
    expect(Timestamp.safeParse("2026-09-25T14:03:11Z").success).toBe(false);
    expect(Timestamp.safeParse("2026-09-25T14:03:11.412+02:00").success).toBe(false);
  });

  it("formats ETags as quoted versions", () => {
    expect(etagFor(7)).toBe('"v7"');
    expect(() => etagFor(-1)).toThrow(RangeError);
  });
});

describe("OpenAPI document (spec §6.8)", () => {
  const doc = generateOpenApiDocument();

  it("is OpenAPI 3.1 with the shared components and one path per registry entry", () => {
    expect(doc.openapi).toBe("3.1.0");
    const operations = Object.values(doc.paths ?? {}).flatMap((item) => Object.keys(item ?? {}));
    expect(operations).toHaveLength(ENDPOINTS.length);
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(
      expect.arrayContaining(["ErrorEnvelope", "ErrorCode", "PageInfo", "Money", "Timestamp", "RequestId"]),
    );
  });

  it("has a reusable error response for every status in the catalog, plus 404", () => {
    const statuses = new Set<number>(Object.values(ERROR_CATALOG).map((e) => e.status));
    statuses.add(404);
    const responses = Object.keys(doc.components?.responses ?? {});
    expect(responses.sort()).toEqual([...statuses].sort((a, b) => a - b).map((s) => `Error${s}`));
  });

  it("carries no organization header: tenant context comes from the token (spec §6.1.3)", () => {
    const text = JSON.stringify(doc).toLowerCase();
    expect(text).not.toContain("x-organization-id");
  });

  it("never makes a referenced schema nullable through allOf, which would refuse null", () => {
    const offenders: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) node.forEach((child, i) => walk(child, `${path}[${i}]`));
      else if (node !== null && typeof node === "object") {
        const allOf = (node as { allOf?: { type?: unknown }[] }).allOf;
        if (allOf?.some((part) => Array.isArray(part.type) && part.type.includes("null")))
          offenders.push(path);
        for (const [key, child] of Object.entries(node)) walk(child, `${path}/${key}`);
      }
    };
    walk(doc, "");
    expect(offenders).toEqual([]);
  });

  it("matches the committed openapi.json", () => {
    const committed = readFileSync(new URL("../openapi.json", import.meta.url), "utf8");
    expect(renderOpenApiDocument()).toBe(committed);
  });
});
