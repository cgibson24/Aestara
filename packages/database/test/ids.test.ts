import { describe, expect, it } from "vitest";
import { uuidv7 } from "../src/ids.ts";

describe("uuidv7", () => {
  it("produces RFC 9562 version 7 identifiers ordered by time", () => {
    const a = uuidv7(1_790_000_000_000);
    const b = uuidv7(1_790_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
    expect(Number.parseInt(a.replace(/-/g, "").slice(0, 12), 16)).toBe(1_790_000_000_000);
  });

  it("is unique", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
    expect(ids.size).toBe(1000);
  });
});
