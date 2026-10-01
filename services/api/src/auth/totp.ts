// TOTP (RFC 6238 over RFC 4226): HMAC-SHA-1, 6 digits, 30-second steps,
// accepting one step either side for clock drift (ADR-0021).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1;
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function newTotpSecret(): Buffer {
  return randomBytes(20);
}

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function totpStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

/**
 * The time step a code matches, or undefined. Steps at or before `lastUsedStep`
 * are refused, so a code can never be replayed (ADR-0021).
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  lastUsedStep: number | undefined,
  now = Date.now(),
): number | undefined {
  const current = totpStep(now);
  for (let step = current - WINDOW; step <= current + WINDOW; step++) {
    if (lastUsedStep !== undefined && step <= lastUsedStep) continue;
    const expected = Buffer.from(hotp(secret, step));
    const given = Buffer.from(code);
    if (expected.length === given.length && timingSafeEqual(expected, given)) return step;
  }
  return undefined;
}

export function otpauthUri(secret: Buffer, account: string, issuer = "Aestara"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
