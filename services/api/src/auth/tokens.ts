// Access and refresh tokens (spec §4.2; ADR-0021).
// Access token: ES256 JWT, 10 minutes, claims sub/sid/org/app/amr; no
// permissions (they are evaluated per request). Refresh token:
// `<sessionId>.<generation>.<mac>`, rotated on every use; only its SHA-256 is
// stored on the session.
import { verify } from "node:crypto";
import { ClientApp } from "@aestara/shared-types";
import { hmacBase64Url, safeEqual, sha256Hex } from "../common/crypto.ts";
import { type TokenSigner } from "./keys.ts";

export const ACCESS_TOKEN_TTL_SECONDS = 10 * 60;
export const ISSUER = "aestara-api";
export const AUDIENCE = "aestara";
const CLOCK_SKEW_SECONDS = 30;

export interface AccessClaims {
  readonly sub: string;
  readonly sid: string;
  readonly org?: string;
  readonly app: ClientApp;
  readonly amr: readonly string[];
  readonly iat: number;
  readonly exp: number;
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

export class AccessTokens {
  constructor(private readonly signer: TokenSigner) {}

  async issue(
    claims: { sub: string; sid: string; org: string | null; app: ClientApp; amr: readonly string[] },
    now = Date.now(),
  ): Promise<{ token: string; expiresAt: Date }> {
    const iat = Math.floor(now / 1000);
    const exp = iat + ACCESS_TOKEN_TTL_SECONDS;
    const header = { alg: "ES256", typ: "JWT", kid: this.signer.keyId };
    const payload = {
      iss: ISSUER,
      aud: AUDIENCE,
      sub: claims.sub,
      sid: claims.sid,
      ...(claims.org !== null ? { org: claims.org } : {}),
      app: claims.app,
      amr: claims.amr,
      iat,
      exp,
    };
    const input = `${b64(header)}.${b64(payload)}`;
    const signature = await this.signer.sign(input);
    return { token: `${input}.${signature.toString("base64url")}`, expiresAt: new Date(exp * 1000) };
  }

  /** The verified claims, or undefined for any invalid, expired or foreign token. */
  async verify(token: string, now = Date.now()): Promise<AccessClaims | undefined> {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    const [h, p, s] = parts as [string, string, string];
    let header: { alg?: unknown; kid?: unknown; typ?: unknown };
    let payload: Record<string, unknown>;
    try {
      header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
      payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    } catch {
      return undefined;
    }
    if (header.alg !== "ES256" || header.kid !== this.signer.keyId) return undefined;
    const ok = verify(
      "sha256",
      Buffer.from(`${h}.${p}`),
      { key: await this.signer.publicKey(), dsaEncoding: "ieee-p1363" },
      Buffer.from(s, "base64url"),
    );
    if (!ok) return undefined;
    const seconds = Math.floor(now / 1000);
    if (payload.iss !== ISSUER || payload.aud !== AUDIENCE) return undefined;
    if (typeof payload.exp !== "number" || payload.exp + CLOCK_SKEW_SECONDS < seconds) return undefined;
    if (typeof payload.iat !== "number" || payload.iat - CLOCK_SKEW_SECONDS > seconds) return undefined;
    if (typeof payload.sub !== "string" || typeof payload.sid !== "string") return undefined;
    if (payload.org !== undefined && typeof payload.org !== "string") return undefined;
    if (!(ClientApp as readonly unknown[]).includes(payload.app)) return undefined;
    if (!Array.isArray(payload.amr) || !payload.amr.every((a) => typeof a === "string")) return undefined;
    return payload as unknown as AccessClaims;
  }
}

export interface RefreshTokenParts {
  readonly sessionId: string;
  readonly generation: number;
}

export class RefreshTokens {
  constructor(private readonly key: Buffer) {}

  issue(sessionId: string, generation: number): { token: string; hash: string } {
    const body = `${sessionId}.${generation}`;
    const token = `${body}.${hmacBase64Url(this.key, body)}`;
    return { token, hash: sha256Hex(token) };
  }

  /** Parses and authenticates a token. A bad MAC is simply invalid: a forged token can revoke nothing. */
  parse(token: string): RefreshTokenParts | undefined {
    const match = /^([0-9a-f-]{36})\.(\d{1,9})\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (match === null) return undefined;
    const [, sessionId, generation, mac] = match as unknown as [string, string, string, string];
    if (!safeEqual(mac, hmacBase64Url(this.key, `${sessionId}.${generation}`))) return undefined;
    return { sessionId, generation: Number(generation) };
  }
}
