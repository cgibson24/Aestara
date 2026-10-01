// Password hashing and policy (spec §4.2; ADR-0018 K-15; ADR-0021).
// Argon2id from Node's crypto module, with the OWASP minimum parameters
// (19 MiB, 2 passes, 1 lane), stored in the PHC string format. The policy is
// NIST SP 800-63B: length only, plus a bundled list of common passwords
// (SecLists, MIT licence) and context words; no composition rules.
import { argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";

const argon2Async = promisify(argon2);

const PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await argon2Async("argon2id", { message: password, nonce: salt, ...PARAMS });
  const b64 = (b: Buffer) => b.toString("base64").replace(/=+$/, "");
  return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${b64(salt)}$${b64(hash)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const m = PHC.exec(stored);
  if (m === null) return false;
  const [, memory, passes, parallelism, salt, hash] = m as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const expected = Buffer.from(hash, "base64");
  const actual = await argon2Async("argon2id", {
    message: password,
    nonce: Buffer.from(salt, "base64"),
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    tagLength: expected.length,
  });
  return timingSafeEqual(actual, expected);
}

/** A fixed hash to verify against when the account does not exist, so timing does not reveal it. */
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(24).toString("base64url"));
  return dummyHash;
}

let commonPasswords: Set<string> | undefined;
function common(): Set<string> {
  if (commonPasswords === undefined) {
    const file = new URL("./common-passwords.txt.gz", import.meta.url);
    commonPasswords = new Set(gunzipSync(readFileSync(file)).toString("utf8").split("\n").filter(Boolean));
  }
  return commonPasswords;
}

/** Load the list at start-up rather than on the first password change. */
export function preloadPasswordList(): number {
  return common().size;
}

/** Why a new password is refused, or undefined when it is acceptable. Length is checked by the contract. */
export function passwordProblem(password: string, context: { email?: string } = {}): string | undefined {
  const lowered = password.toLowerCase();
  if (common().has(lowered)) return "This password is too common. Choose another.";
  if (/^(.)\1+$/.test(password)) return "This password is too easy to guess. Choose another.";
  const words = ["aestara"];
  const local = context.email?.split("@")[0]?.toLowerCase();
  if (local !== undefined && local.length >= 4) words.push(local);
  if (words.some((w) => lowered.includes(w)))
    return "Do not use your email or the product name in your password.";
  return undefined;
}
