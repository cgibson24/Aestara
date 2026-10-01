// Unit tests that need no database: token formats, TOTP, passwords, lockout,
// search keys, cursors, configuration, logging and the route table.
import { verify as cryptoVerify, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkRouteTable } from "../src/app.ts";
import { derToP1363, LocalSealer, LocalSigner } from "../src/auth/keys.ts";
import { lockFromFailures } from "../src/auth/lockout.ts";
import { hashPassword, passwordProblem, verifyPassword } from "../src/auth/passwords.ts";
import { AccessTokens, RefreshTokens } from "../src/auth/tokens.ts";
import { base32Encode, hotp, otpauthUri, verifyTotp } from "../src/auth/totp.ts";
import { canonicalJson, deriveKey } from "../src/common/crypto.ts";
import { CursorCodec, paginate } from "../src/common/cursor.ts";
import { mapDatabaseError } from "../src/common/errors.ts";
import { safeError } from "../src/common/logging.ts";
import { loadConfig } from "../src/config.ts";
import { nameKey, prefixEnd, prefixRange, similarNames } from "../src/patients/search-keys.ts";

const pem = () =>
  generateKeyPairSync("ec", { namedCurve: "P-256" })
    .privateKey.export({ format: "pem", type: "pkcs8" })
    .toString();

describe("access tokens (ADR-0021)", () => {
  const signer = new LocalSigner(pem(), "k1");
  const tokens = new AccessTokens(signer);
  const claims = {
    sub: "u1",
    sid: "0192f7c4-5b1e-7c3a-9d2f-6a1b2c3d4e5f",
    org: "o1",
    app: "ADMIN_WEB" as const,
    amr: ["pwd", "mfa"],
  };

  it("issues ES256 tokens that verify, with a 10-minute lifetime and no permissions", async () => {
    const { token, expiresAt } = await tokens.issue(claims);
    const verified = await tokens.verify(token);
    expect(verified?.sub).toBe("u1");
    expect(verified?.org).toBe("o1");
    expect(verified && verified.exp - verified.iat).toBe(600);
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(600_000);
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());
    expect(Object.keys(payload).sort()).toEqual([
      "amr",
      "app",
      "aud",
      "exp",
      "iat",
      "iss",
      "org",
      "sid",
      "sub",
    ]);
  });

  it("rejects tampered, foreign, expired and alg-none tokens", async () => {
    const { token } = await tokens.issue(claims);
    const [h, p, s] = token.split(".") as [string, string, string];
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), org: "o2" }),
    ).toString("base64url");
    expect(await tokens.verify(`${h}.${forged}.${s}`)).toBeUndefined();
    const other = await new AccessTokens(new LocalSigner(pem(), "k1")).issue(claims);
    expect(await tokens.verify(other.token)).toBeUndefined();
    const old = await tokens.issue(claims, Date.now() - 20 * 60_000);
    expect(await tokens.verify(old.token)).toBeUndefined();
    const none = `${Buffer.from(JSON.stringify({ alg: "none", kid: "k1" })).toString("base64url")}.${p}.`;
    expect(await tokens.verify(none)).toBeUndefined();
  });

  it("publishes the public key as a JWKS entry", async () => {
    const [jwk] = await signer.jwks();
    expect(jwk).toMatchObject({ kty: "EC", crv: "P-256", kid: "k1", alg: "ES256", use: "sig" });
    expect(jwk).not.toHaveProperty("d");
  });

  it("converts KMS DER signatures to JWS form", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    for (let i = 0; i < 20; i++) {
      const data = randomBytes(32);
      const der = sign("sha256", data, privateKey);
      const p1363 = derToP1363(der);
      expect(p1363).toHaveLength(64);
      expect(sign("sha256", data, { key: privateKey, dsaEncoding: "ieee-p1363" })).toHaveLength(64);
      expect(cryptoVerify("sha256", data, { key: publicKey, dsaEncoding: "ieee-p1363" }, p1363)).toBe(true);
    }
  });
});

describe("refresh tokens (ADR-0021)", () => {
  const refresh = new RefreshTokens(randomBytes(32));
  const sid = "0192f7c4-5b1e-7c3a-9d2f-6a1b2c3d4e5f";

  it("authenticates the session and generation", () => {
    const { token, hash } = refresh.issue(sid, 3);
    expect(refresh.parse(token)).toEqual({ sessionId: sid, generation: 3 });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a forged MAC, so a forged token can revoke nothing", () => {
    const { token } = refresh.issue(sid, 3);
    const forged = token.replace(/\.3\./, ".2.");
    expect(refresh.parse(forged)).toBeUndefined();
    expect(new RefreshTokens(randomBytes(32)).parse(token)).toBeUndefined();
  });
});

describe("TOTP (RFC 6238)", () => {
  // RFC 6238 Appendix B, SHA-1 seed "12345678901234567890".
  const seed = Buffer.from("12345678901234567890");
  it("matches the RFC test vectors (6 digits)", () => {
    expect(hotp(seed, Math.floor(59 / 30))).toBe("287082");
    expect(hotp(seed, Math.floor(1111111109 / 30))).toBe("081804");
    expect(hotp(seed, Math.floor(1234567890 / 30))).toBe("005924");
    expect(hotp(seed, Math.floor(2000000000 / 30))).toBe("279037");
  });

  it("accepts ±1 step once, never a used step again", () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(seed, hotp(seed, step - 1), undefined, now)).toBe(step - 1);
    expect(verifyTotp(seed, hotp(seed, step + 1), undefined, now)).toBe(step + 1);
    expect(verifyTotp(seed, hotp(seed, step + 2), undefined, now)).toBeUndefined();
    expect(verifyTotp(seed, hotp(seed, step), step, now)).toBeUndefined();
  });

  it("encodes the secret for authenticator apps", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(otpauthUri(seed, "a@example.test")).toMatch(
      /^otpauth:\/\/totp\/Aestara%3Aa%40example\.test\?secret=/,
    );
  });
});

describe("passwords (NIST SP 800-63B)", () => {
  it("hashes with Argon2id in PHC form and verifies", async () => {
    const hash = await hashPassword("a long enough passphrase");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword(hash, "a long enough passphrase")).toBe(true);
    expect(await verifyPassword(hash, "a long enough passphrasf")).toBe(false);
  });

  it("refuses common passwords, repeats and context words", () => {
    expect(passwordProblem("password1234")).toMatch(/common/);
    expect(passwordProblem("aaaaaaaaaaaaaa")).toBeDefined();
    expect(passwordProblem("my aestara login 9")).toBeDefined();
    expect(passwordProblem("jordan.lee.2026!", { email: "jordan.lee@example.test" })).toBeDefined();
    expect(passwordProblem("violet canyon mirror 42")).toBeUndefined();
  });
});

describe("lockout schedule (ADR-0021)", () => {
  const minutes = (n: number) => n * 60_000;
  const failuresAt = (start: number, count: number) =>
    Array.from({ length: count }, (_, i) => new Date(start + i * 1000));

  it("locks for 15 minutes after 5 failures and doubles per further 5", () => {
    const t0 = Date.UTC(2026, 9, 1);
    expect(lockFromFailures(failuresAt(t0, 4), t0 + 10_000).locked).toBe(false);
    const five = lockFromFailures(failuresAt(t0, 5), t0 + 10_000);
    expect(five.locked).toBe(true);
    expect(five.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
    expect(lockFromFailures(failuresAt(t0, 5), t0 + minutes(16)).locked).toBe(false);
    const ten = lockFromFailures(failuresAt(t0, 10), t0 + minutes(20));
    expect(ten.locked).toBe(true);
    expect(lockFromFailures(failuresAt(t0, 40), t0 + minutes(60 * 23)).retryAfterSeconds).toBeLessThanOrEqual(
      24 * 3600,
    );
  });
});

describe("search keys (ADR-0020)", () => {
  it("normalizes like app_name_search_key", () => {
    expect(nameKey("  O'Brien-Núñez ")).toBe("obriennunez");
    expect(nameKey("Straße")).toBe("strasse");
    expect(nameKey("Øster")).toBe("oster");
    expect(nameKey("---")).toBe("");
  });

  it("turns a prefix into a leakproof range", () => {
    expect(prefixEnd("ab")).toBe("ac");
    expect(prefixEnd("a9")).toBe("aa");
    expect(prefixEnd("az")).toBe("b");
    expect(prefixEnd("zz")).toBeUndefined();
    expect(prefixRange("rey")).toEqual({ gte: "rey", lt: "rez" });
  });

  it("finds similar names for duplicate detection", () => {
    expect(similarNames("reyes", "reyes")).toBe(true);
    expect(similarNames("reyes", "reyez")).toBe(true);
    expect(similarNames("christopher", "chris")).toBe(true);
    expect(similarNames("reyes", "garcia")).toBe(false);
  });
});

describe("cursors (spec §6.1.6)", () => {
  const codec = new CursorCodec(randomBytes(32));
  it("round-trips, binds to the list and expires", () => {
    const c = codec.encode("patients", { k: "reyes", id: "x" });
    expect(codec.decode("patients", c)).toEqual({ k: "reyes", id: "x" });
    expect(() => codec.decode("users", c)).toThrow();
    expect(() => codec.decode("patients", `${c}x`)).toThrow();
    expect(() => codec.decode("patients", c, Date.now() + 25 * 3600_000)).toThrow();
  });

  it("pages with limit + 1 rows", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(paginate(rows, 2, (r) => r.id).page).toEqual({ hasMore: true, nextCursor: "b" });
    expect(paginate(rows, 3, (r) => r.id).page).toEqual({ hasMore: false });
  });
});

describe("configuration", () => {
  const base = {
    DATABASE_URL: "postgresql://a@h/d",
    PLATFORM_DATABASE_URL: "postgresql://b@h/d",
    API_SECRET_KEY: randomBytes(32).toString("base64"),
    JWT_PRIVATE_KEY_PEM: "pem",
    SECRET_SEAL_KEY: randomBytes(32).toString("base64"),
  };
  it("requires KMS, SES and an admin origin in production", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(
      /JWT_SIGNER.*SECRET_SEALER.*EMAIL_TRANSPORT/s,
    );
  });
  it("names invalid variables without echoing their values", () => {
    try {
      loadConfig({ ...base, API_SECRET_KEY: "c2hvcnQ=" });
      expect.unreachable();
    } catch (e) {
      expect(String(e)).toContain("API_SECRET_KEY");
      expect(String(e)).not.toContain("c2hvcnQ=");
    }
  });
});

describe("crypto helpers", () => {
  it("hashes bodies canonically and derives independent keys", () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }], u: undefined })).toBe(
      '{"a":[1,{"c":3,"d":2}],"b":1}',
    );
    const root = randomBytes(32).toString("base64");
    expect(deriveKey(root, "a").equals(deriveKey(root, "b"))).toBe(false);
  });

  it("seals with AES-GCM bound to its context", async () => {
    const sealer = new LocalSealer(randomBytes(32));
    const sealed = await sealer.seal(Buffer.from("seed"), "totp:u1");
    expect((await sealer.open(sealed, "totp:u1")).toString()).toBe("seed");
    await expect(sealer.open(sealed, "totp:u2")).rejects.toThrow();
  });
});

describe("logging (spec §7.2)", () => {
  it("logs errors without their message", () => {
    const logged = safeError(new Error("duplicate key email=ana@example.test"));
    expect(JSON.stringify(logged)).not.toContain("ana@example.test");
    expect(logged.name).toBe("Error");
  });
});

describe("route table", () => {
  it("binds every registry operation exactly once", async () => {
    await import("../src/app.ts");
    expect(() => checkRouteTable()).not.toThrow();
  });
});

describe("database errors", () => {
  it("answers a saturated database with 503 and Retry-After, not 500", () => {
    const error = mapDatabaseError(
      Object.assign(new Error("Transaction API error: Unable to start a transaction in the given time."), {
        code: "P2028",
      }),
    );
    expect(error?.code).toBe("SERVICE_UNAVAILABLE");
    expect(error?.status).toBe(503);
    expect(error?.headers?.["Retry-After"]).toBe("2");
  });
});
