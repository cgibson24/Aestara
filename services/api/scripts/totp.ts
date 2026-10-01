// RFC 6238 codes for the test administrator's authenticator. Each code is for
// a time step not used before: the api refuses a replayed step (ADR-0021).
import { createHmac } from "node:crypto";

function base32(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase())
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => Number.parseInt(b, 2)));
}

export function code(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32(secret)).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const value = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}

/** Hands out codes for the current step, then the next one (the api accepts one step either side). */
export class Authenticator {
  private lastStep = 0;
  private readonly secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  /** The last time step handed out; a later sign-in must use a later one. */
  get lastUsedStep(): number {
    return this.lastStep;
  }

  async next(): Promise<string> {
    let step = Math.floor(Date.now() / 30_000);
    if (step <= this.lastStep) step = this.lastStep + 1;
    // Beyond one step ahead, wait for the clock to catch up.
    while (step > Math.floor(Date.now() / 30_000) + 1) await new Promise((r) => setTimeout(r, 1000));
    this.lastStep = step;
    return code(this.secret, step);
  }
}
