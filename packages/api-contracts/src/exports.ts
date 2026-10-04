// Purpose-specific exports (spec §6.3 "Photography" and "Before / after";
// Bible §7.3, §8.3, §22.4; ADR-0026 K3-14, K3-15). An export is a new
// derivative of the original, rendered asynchronously for one purpose under the
// patient's current grant for it, and downloadable while its release is active.
import { Timestamp, Uuid } from "./primitives.ts";
import { z } from "./zod.ts";

/**
 * The purposes an export can serve. PATIENT_APP is a release, not an export;
 * AI_TRAINING and INTERNAL_AI_EVALUATION are dataset uses (Layer 7).
 */
export const EXPORT_PURPOSES = [
  "CLINICAL_USE",
  "EDUCATION",
  "WEBSITE",
  "SOCIAL_MEDIA",
  "PAID_ADVERTISING",
  "RESEARCH",
] as const;
export const ExportPurpose = z.enum(EXPORT_PURPOSES).meta({
  id: "ExportPurpose",
  description: "Each purpose needs the patient's current grant of the same media-permission category.",
});

/** Purposes whose single-photo exports are MARKETING_DERIVATIVE (K3-14). */
export const MARKETING_EXPORT_PURPOSES: readonly (typeof EXPORT_PURPOSES)[number][] = [
  "WEBSITE",
  "SOCIAL_MEDIA",
  "PAID_ADVERTISING",
];

/** An export's long edge: at most this many pixels, never enlarged (K3-15). */
export const EXPORT_MAX_EDGE_PX = 4096;

export const EXPORT_KINDS = [
  "EXPORT_DERIVATIVE",
  "MARKETING_DERIVATIVE",
  "ANNOTATED_DERIVATIVE",
  "BEFORE_AFTER_DERIVATIVE",
] as const;
export const ExportKind = z.enum(EXPORT_KINDS).meta({
  id: "ExportKind",
  description:
    "What the image is: a before/after composite, a photo with one annotation layer drawn in, or a " +
    "plain photo (MARKETING_DERIVATIVE for website, social media and paid advertising).",
});

export const ExportStatus = z.enum(["PENDING", "READY", "FAILED", "REVOKED"]).meta({
  id: "ExportStatus",
  description: "REVOKED once the release is revoked, whatever the render did.",
});

export const ExportFailure = z.enum(["SOURCE_CHANGED", "RENDER_FAILED"]).meta({
  id: "ExportFailure",
  description:
    "SOURCE_CHANGED: the annotation layer changed or was deleted before the render; export again. " +
    "RENDER_FAILED: the image could not be rendered; no file was produced.",
});

export const MediaExport = z
  .strictObject({
    id: Uuid,
    purpose: ExportPurpose,
    kind: ExportKind,
    status: ExportStatus,
    photoIds: z
      .array(Uuid)
      .min(1)
      .max(2)
      .meta({ description: "The photo, or the set's before and after photos." }),
    beforeAfterSetId: Uuid.optional(),
    annotationId: Uuid.optional(),
    mediaReleaseId: Uuid,
    requestedByUserId: Uuid,
    requestedAt: Timestamp,
    widthPx: z.int().positive().optional(),
    heightPx: z.int().positive().optional(),
    failure: ExportFailure.optional(),
    revokedAt: Timestamp.optional(),
  })
  .meta({ id: "MediaExport" });

export const PhotoExportCreate = z
  .strictObject({
    purpose: ExportPurpose,
    annotationId: Uuid.optional().meta({ description: "One of the photo's annotation layers, drawn in." }),
  })
  .meta({ id: "PhotoExportCreate" });

export const BeforeAfterExportCreate = z
  .strictObject({ purpose: ExportPurpose })
  .meta({ id: "BeforeAfterExportCreate" });

export const ExportAccessUrl = z
  .strictObject({ exportId: Uuid, url: z.url(), expiresAt: Timestamp })
  .meta({ id: "ExportAccessUrl", description: "A signed GET, valid 10 minutes; private, no-store." });
