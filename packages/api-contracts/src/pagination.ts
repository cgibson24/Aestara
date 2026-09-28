// Response envelopes and cursor pagination (spec §6.1.5, §6.1.6).
import { z } from "./zod.ts";

export const PAGE_LIMIT_DEFAULT = 25;
export const PAGE_LIMIT_MAX = 100;

/**
 * Query parameters every collection endpoint accepts. Endpoints extend this
 * with their own documented filters; the object is strict, so an unknown
 * parameter fails validation (400 VALIDATION_FAILED).
 */
export const PageQuery = z.strictObject({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGE_LIMIT_MAX)
    .default(PAGE_LIMIT_DEFAULT)
    .meta({ description: `Page size, 1–${PAGE_LIMIT_MAX}. Default ${PAGE_LIMIT_DEFAULT}.` }),
  cursor: z
    .string()
    .min(1)
    .optional()
    .meta({ description: "Opaque, signed, expiring cursor from page.nextCursor. Never build one by hand." }),
});

export type PageQuery = z.infer<typeof PageQuery>;

/** Cursor pagination state. There are no total counts, to avoid enumeration. */
export const PageInfo = z
  .strictObject({
    nextCursor: z.string().min(1).optional(),
    hasMore: z.boolean(),
  })
  .meta({
    id: "PageInfo",
    description: "Cursor pagination state. nextCursor is present when hasMore is true.",
  })
  .refine((page) => !page.hasMore || page.nextCursor !== undefined, {
    message: "nextCursor is required when hasMore is true.",
    path: ["nextCursor"],
  });

/** `{ "data": <resource> }` */
export function resourceEnvelope<T extends z.ZodType>(item: T) {
  return z.strictObject({ data: item });
}

/** `{ "data": [<resource>…], "page": { … } }` */
export function collectionEnvelope<T extends z.ZodType>(item: T) {
  return z.strictObject({ data: z.array(item), page: PageInfo });
}
