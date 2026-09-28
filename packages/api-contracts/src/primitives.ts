// Value formats shared by every endpoint (spec §6.1.2). Response and request
// schemas compose these instead of re-declaring formats.
import { z } from "./zod.ts";

/** Resource identifier: a UUID string. */
export const Uuid = z.uuid().meta({
  id: "Uuid",
  description: "Resource identifier (UUID).",
  example: "0192f7c4-5b1e-7c3a-9d2f-6a1b2c3d4e5f",
});

/**
 * Server-generated request identifier (UUIDv7), returned in `X-Request-Id` and
 * in every error envelope (spec §6.1.4).
 */
export const RequestId = z.uuid({ version: "v7" }).meta({
  id: "RequestId",
  description: "Server-generated request identifier (UUIDv7). Quote it when reporting a problem.",
  example: "0192f7c4-5b1e-7c3a-9d2f-6a1b2c3d4e5f",
});

/** RFC 3339 UTC timestamp with milliseconds, e.g. `2026-09-25T14:03:11.412Z`. */
export const Timestamp = z.iso.datetime({ precision: 3 }).meta({
  id: "Timestamp",
  description: "RFC 3339 UTC timestamp with milliseconds.",
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$",
  example: "2026-09-25T14:03:11.412Z",
});

/** Calendar date without time or zone, `YYYY-MM-DD`. */
export const DateOnly = z.iso.date().meta({
  id: "DateOnly",
  description: "Calendar date (YYYY-MM-DD).",
  example: "1988-04-12",
});

/** Currencies the platform accepts. United States only (ADR-0006). */
export const Currency = z.enum(["USD"]).meta({
  id: "Currency",
  description: "ISO 4217 currency code. USD only (ADR-0006); new codes are additive.",
});

/** Money is a decimal string plus a currency, never a float (spec §6.1.2). */
export const Money = z
  .strictObject({
    amount: z
      .string()
      .regex(/^-?(0|[1-9]\d*)\.\d{2}$/, "Must be a decimal string with two fraction digits.")
      .meta({ example: "1250.00" }),
    currency: Currency,
  })
  .meta({
    id: "Money",
    description: "Monetary amount as a decimal string with two fraction digits, plus its currency.",
  });

export type Money = z.infer<typeof Money>;
