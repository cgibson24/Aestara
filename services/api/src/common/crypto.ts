// Small cryptographic helpers shared by the auth, cursor and idempotency code.
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmacBase64Url(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value).digest("base64url");
}

export function hmacHex(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}

/** A random, URL-safe secret (256 bits by default). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Independent 32-byte keys derived from the one configured root secret (RFC 5869). */
export function deriveKey(rootBase64: string, purpose: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(rootBase64, "base64"), Buffer.alloc(0), `aestara:${purpose}`, 32),
  );
}

/** JSON with sorted keys, so equal bodies hash equally (idempotency, spec §6.1.8). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}
