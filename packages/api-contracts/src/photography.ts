// Clinical photography (spec §6.3 "Photography", §6.6.2, §6.6.6, §5.4.5,
// §5.4.10; Bible §6, §7; ADR-0023). Object keys are never part of a contract:
// stored objects are reached only through short-lived signed URLs (spec §6.1.9).
import {
  BodyRegion as BodyRegionValues,
  DerivativeKind as DerivativeKindValues,
  MalwareScanStatus as MalwareScanStatusValues,
  MediaPermissionCategory as MediaPermissionCategoryValues,
  PermissionEvidence as PermissionEvidenceValues,
  PermissionScope as PermissionScopeValues,
  PhotoPermissionState as PhotoPermissionStateValues,
  PhotoSessionStatus as PhotoSessionStatusValues,
  PhotoSource as PhotoSourceValues,
  PhotoStatus as PhotoStatusValues,
  ProtocolStatus as ProtocolStatusValues,
} from "@aestara/shared-types";
import { PageQuery } from "./pagination.ts";
import { Timestamp, Uuid } from "./primitives.ts";
import { z } from "./zod.ts";

// ---- Shared vocabularies ------------------------------------------------------

/** The 13 live guidance codes [B §6.4] (spec §6.6.6). Nothing else is a guidance code. */
export const GUIDANCE_CODES = [
  "MOVE_LEFT",
  "MOVE_RIGHT",
  "MOVE_CLOSER",
  "MOVE_BACK",
  "CAMERA_TOO_HIGH",
  "CAMERA_TOO_LOW",
  "LEVEL_CAMERA",
  "PATIENT_TURN_LEFT",
  "PATIENT_TURN_RIGHT",
  "RAISE_CHIN",
  "LOWER_CHIN",
  "LIGHTING_TOO_DARK",
  "RETAKE_MOTION_BLUR",
] as const;
export const GuidanceCode = z.enum(GUIDANCE_CODES).meta({
  id: "GuidanceCode",
  description: "Live capture guidance [B §6.4]. Clients turn each code into one plain instruction.",
});

/** The label the position-match score always carries [B §6.5] (DESIGN_SYSTEM.md §3). */
export const POSITION_MATCH_LABEL = "Photographic position match, not a medical measurement.";

export const BodyRegion = z.enum(BodyRegionValues).meta({ id: "BodyRegion" });
export const ProtocolStatus = z.enum(ProtocolStatusValues).meta({ id: "ProtocolStatus" });
export const PhotoSessionStatus = z.enum(PhotoSessionStatusValues).meta({ id: "PhotoSessionStatus" });
export const PhotoSource = z.enum(PhotoSourceValues).meta({ id: "PhotoSource" });
export const PhotoStatus = z.enum(PhotoStatusValues).meta({ id: "PhotoStatus" });
export const DerivativeKind = z.enum(DerivativeKindValues).meta({ id: "DerivativeKind" });
export const MalwareScanStatus = z.enum(MalwareScanStatusValues).meta({ id: "MalwareScanStatus" });
export const MediaPermissionCategory = z.enum(MediaPermissionCategoryValues).meta({
  id: "MediaPermissionCategory",
  description: "Independent categories [B §7.1]; none implies another.",
});
export const PhotoPermissionState = z.enum(PhotoPermissionStateValues).meta({ id: "PhotoPermissionState" });
export const MediaPermissionScope = z.enum(PermissionScopeValues).meta({ id: "MediaPermissionScope" });
export const PermissionEvidence = z.enum(PermissionEvidenceValues).meta({ id: "PermissionEvidence" });

/** A view key: stable UPPER_SNAKE, unique within a protocol (PHOTO_PROTOCOLS.md §2). */
export const ViewKey = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{0,39}$/, "Use UPPER_SNAKE letters, digits and underscores, e.g. LEFT_45.")
  .meta({ example: "LEFT_45" });

const Sha256Hex = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Lower-case hex SHA-256 of the file.")
  .meta({ description: "Lower-case hex SHA-256 of the exact bytes uploaded." });

/** Photo upload limits (ADR-0023 K2-02). */
export const PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png"] as const;
export const PHOTO_MAX_BYTES = 50 * 1024 * 1024;
export const PHOTO_MAX_PIXELS = 100_000_000;
/** Derivative sizes (ADR-0023 K2-06): the longest edge in pixels. */
export const DERIVATIVE_MAX_EDGE_PX = { THUMBNAIL: 400, DISPLAY_PREVIEW: 2048 } as const;

// ---- Protocols ----------------------------------------------------------------

export const PoseTarget = z
  .strictObject({
    subject: z.enum(["FACE", "TORSO"]),
    yawDeg: z
      .number()
      .min(-180)
      .max(180)
      .meta({ description: "The subject's turn from facing the camera; positive shows the left side." }),
    yawToleranceDeg: z.number().min(1).max(45),
    pitchToleranceDeg: z.number().min(1).max(45),
    rollToleranceDeg: z.number().min(1).max(45),
    centerToleranceFraction: z.number().min(0.01).max(0.5),
    frameFill: z.number().min(0.1).max(1).meta({ description: "Subject height as a fraction of the frame." }),
    frameFillTolerance: z.number().min(0.01).max(0.5),
  })
  .meta({ id: "PoseTarget", description: "Target pose and framing tolerances used by live guidance." });

export const ProtocolView = z
  .strictObject({
    id: Uuid,
    viewKey: ViewKey,
    name: z.string(),
    sortOrder: z.int().min(1),
    isRequired: z.boolean(),
    captureInstructions: z.string().optional(),
    poseTarget: PoseTarget.optional(),
  })
  .meta({ id: "ProtocolView" });

export const ProtocolViewInput = z
  .strictObject({
    viewKey: ViewKey,
    name: z.string().trim().min(1).max(60),
    isRequired: z.boolean(),
    captureInstructions: z.string().trim().min(1).max(500).optional(),
    poseTarget: PoseTarget.optional(),
  })
  .meta({ id: "ProtocolViewInput", description: "Views are captured in the order given." });

const ProtocolViews = z
  .array(ProtocolViewInput)
  .min(1)
  .max(20)
  .refine((views) => new Set(views.map((v) => v.viewKey)).size === views.length, {
    message: "Each view key may appear once.",
  });

export const PhotographyProtocol = z
  .strictObject({
    id: Uuid,
    name: z.string(),
    bodyRegion: BodyRegion,
    description: z.string().optional(),
    status: ProtocolStatus,
    practiceId: Uuid.optional().meta({ description: "Absent for an organization-wide protocol." }),
    supersedesId: Uuid.optional(),
    supersededById: Uuid.optional(),
    standard: z
      .boolean()
      .meta({ description: "One of the Bible §6.2 standard protocols seeded for every organization." }),
    views: z.array(ProtocolView),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    version: z.int().min(1),
  })
  .meta({ id: "PhotographyProtocol" });

export const PhotographyProtocolCreate = z
  .strictObject({
    name: z.string().trim().min(1).max(100),
    bodyRegion: BodyRegion,
    description: z.string().trim().min(1).max(500).optional(),
    practiceId: Uuid.optional(),
    supersedesId: Uuid.optional().meta({
      description: "The protocol this draft replaces; activating the draft retires it.",
    }),
    views: ProtocolViews,
  })
  .meta({ id: "PhotographyProtocolCreate", description: "Creates a DRAFT." });

export const PhotographyProtocolUpdate = z
  .strictObject({
    name: z.string().trim().min(1).max(100).optional(),
    bodyRegion: BodyRegion.optional(),
    description: z.string().trim().min(1).max(500).nullable().optional(),
    // A plain uuid: a nullable reference renders as allOf, which would refuse null.
    practiceId: z
      .uuid()
      .nullable()
      .optional()
      .meta({ description: "null makes the protocol organization-wide." }),
    views: ProtocolViews.optional(),
  })
  .refine((u) => Object.keys(u).length > 0, { message: "Change at least one field." })
  .meta({
    id: "PhotographyProtocolUpdate",
    description: "DRAFT protocols only; views are replaced as a set.",
  });

export const PhotographyProtocolListQuery = PageQuery.extend({
  status: ProtocolStatus.optional(),
  bodyRegion: BodyRegion.optional(),
}).meta({ id: "PhotographyProtocolListQuery" });

// ---- Sessions -----------------------------------------------------------------

export const PhotoSessionView = z
  .strictObject({
    viewKey: ViewKey,
    name: z.string(),
    sortOrder: z.int().min(1),
    isRequired: z.boolean(),
    captured: z
      .boolean()
      .meta({ description: "A verified photo of this view exists (accepted or being checked)." }),
    photoCount: z.int().min(0),
  })
  .meta({ id: "PhotoSessionView" });

export const PhotoSession = z
  .strictObject({
    id: Uuid,
    patientId: Uuid,
    protocolId: Uuid,
    protocolName: z.string(),
    source: PhotoSource,
    status: PhotoSessionStatus,
    capturedByUserId: Uuid.optional(),
    practiceId: Uuid.optional(),
    locationId: Uuid.optional(),
    startedAt: Timestamp,
    completedAt: Timestamp.optional(),
    views: z.array(PhotoSessionView),
    missingRequiredViews: z.array(ViewKey),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: "PhotoSession" });

export const PhotoSessionCreate = z
  .strictObject({
    id: z
      .uuid({ version: "v7" })
      .optional()
      .meta({ description: "Client-generated UUIDv7 for offline capture." }),
    protocolId: Uuid,
    practiceId: Uuid.optional(),
    locationId: Uuid.optional(),
    startedAt: Timestamp.optional().meta({
      description:
        "When capture began on the device (offline sessions); defaults to now. Never in the future.",
    }),
  })
  .meta({ id: "PhotoSessionCreate" });

export const PhotoSessionComplete = z
  .strictObject({
    acknowledgeMissingRequiredViews: z.boolean().default(false).meta({
      description: "Complete although required views are missing (422 REQUIRED_VIEWS_MISSING otherwise).",
    }),
  })
  .meta({ id: "PhotoSessionComplete" });

export const PhotoSessionListQuery = PageQuery.extend({ status: PhotoSessionStatus.optional() }).meta({
  id: "PhotoSessionListQuery",
});

// ---- Photos -------------------------------------------------------------------

export const CaptureMetadata = z
  .strictObject({
    deviceModel: z
      .string()
      .regex(/^[A-Za-z0-9,._ -]{1,40}$/)
      .optional()
      .meta({ example: "iPad16,3" }),
    lens: z.enum(["WIDE", "ULTRA_WIDE", "TELEPHOTO", "FRONT"]).optional(),
    yawDeg: z.number().min(-180).max(180).optional(),
    pitchDeg: z.number().min(-90).max(90).optional(),
    rollDeg: z.number().min(-180).max(180).optional(),
    frameFill: z.number().min(0).max(1).optional(),
    exposureDurationSeconds: z.number().positive().max(10).optional(),
    iso: z.number().positive().max(100_000).optional(),
    positionMatchScore: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .meta({ description: `${POSITION_MATCH_LABEL} Present when a ghost overlay was used.` }),
    referencePhotoId: Uuid.optional().meta({ description: "The earlier photo used as the ghost overlay." }),
  })
  .meta({ id: "CaptureMetadata", description: "Device and pose estimates only; never free text." });

export const QualityCheck = z
  .strictObject({
    code: GuidanceCode,
    passed: z.boolean(),
    value: z
      .number()
      .optional()
      .meta({ description: "The measured value behind the check, when it has one." }),
  })
  .meta({ id: "QualityCheck" });

export const PhotoUploadRequest = z
  .strictObject({
    id: z
      .uuid({ version: "v7" })
      .optional()
      .meta({ description: "Client-generated UUIDv7 for offline capture." }),
    photoSessionId: Uuid,
    viewKey: ViewKey,
    contentType: z.enum(PHOTO_CONTENT_TYPES).meta({ description: "JPEG or PNG (ADR-0023 K2-02)." }),
    byteSize: z.int().min(1).max(PHOTO_MAX_BYTES),
    sha256: Sha256Hex,
    capturedAt: Timestamp,
    widthPx: z.int().min(1).max(100_000).optional(),
    heightPx: z.int().min(1).max(100_000).optional(),
    captureMetadata: CaptureMetadata.optional(),
    qualityChecks: z.array(QualityCheck).max(GUIDANCE_CODES.length).optional(),
  })
  .refine(
    (r) => r.widthPx === undefined || r.heightPx === undefined || r.widthPx * r.heightPx <= PHOTO_MAX_PIXELS,
    {
      message: `At most ${PHOTO_MAX_PIXELS / 1_000_000} megapixels.`,
      path: ["widthPx"],
    },
  )
  .meta({ id: "PhotoUploadRequest" });

export const SignedUpload = z
  .strictObject({
    method: z.literal("PUT"),
    url: z.url(),
    expiresAt: Timestamp,
    headers: z
      .record(z.string(), z.string())
      .meta({ description: "Send exactly these headers with the PUT." }),
  })
  .meta({
    id: "SignedUpload",
    description: "A presigned upload, valid 10 minutes. Replay the intent for a fresh one.",
  });

export const PhotoUploadIntent = z
  .strictObject({
    photoId: Uuid,
    status: PhotoStatus,
    upload: SignedUpload.optional().meta({ description: "Present while the photo waits for its bytes." }),
  })
  .meta({ id: "PhotoUploadIntent" });

export const DerivativeAvailability = z
  .strictObject({
    kind: DerivativeKind,
    status: z.enum(["PENDING", "AVAILABLE", "FAILED"]),
    widthPx: z.int().optional(),
    heightPx: z.int().optional(),
  })
  .meta({ id: "DerivativeAvailability" });

export const PhotoRejectionReason = z
  .enum(["MALWARE_DETECTED", "SCAN_FAILED"])
  .meta({ id: "PhotoRejectionReason" });

export const Photo = z
  .strictObject({
    id: Uuid,
    patientId: Uuid,
    photoSessionId: Uuid.optional(),
    viewKey: ViewKey.optional(),
    source: PhotoSource,
    status: PhotoStatus,
    capturedAt: Timestamp,
    capturedByUserId: Uuid.optional(),
    contentType: z.string(),
    byteSize: z.int().optional(),
    sha256: Sha256Hex.optional(),
    widthPx: z.int().optional(),
    heightPx: z.int().optional(),
    captureMetadata: CaptureMetadata.optional(),
    qualityChecks: z.array(QualityCheck).optional(),
    positionMatchScore: z.number().min(0).max(1).optional().meta({ description: POSITION_MATCH_LABEL }),
    scanStatus: MalwareScanStatus,
    rejectionReason: PhotoRejectionReason.optional(),
    derivatives: z.array(DerivativeAvailability),
    tags: z.array(z.string()),
    archivedAt: Timestamp.optional(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: "Photo" });

export const PhotoListQuery = PageQuery.extend({
  photoSessionId: Uuid.optional(),
  viewKey: ViewKey.optional(),
  status: z
    .enum(["QUARANTINED", "ACCEPTED", "REJECTED", "ARCHIVED"])
    .optional()
    .meta({ description: "Default: accepted photos and those being checked." }),
  includeArchived: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
}).meta({ id: "PhotoListQuery" });

export const PhotoVariant = z.enum(["ORIGINAL", "THUMBNAIL", "DISPLAY_PREVIEW"]).meta({
  id: "PhotoVariant",
  description: "ORIGINAL needs photo.export and is always audited.",
});

export const AccessUrlRequest = z.strictObject({ variant: PhotoVariant }).meta({ id: "AccessUrlRequest" });

export const AccessUrl = z
  .strictObject({ photoId: Uuid, variant: PhotoVariant, url: z.url(), expiresAt: Timestamp })
  .meta({ id: "AccessUrl", description: "A signed GET, valid 120 seconds; private, no-store." });

export const BatchAccessUrlRequest = z
  .strictObject({
    photoIds: z
      .array(Uuid)
      .min(1)
      .max(60)
      .refine((ids) => new Set(ids).size === ids.length, { message: "Each photo may appear once." }),
    variant: z.enum(["THUMBNAIL", "DISPLAY_PREVIEW"]),
  })
  .meta({ id: "BatchAccessUrlRequest" });

export const BatchAccessUrls = z
  .strictObject({
    urls: z.array(AccessUrl),
    unavailable: z.array(
      z.strictObject({
        photoId: Uuid,
        reason: z.enum(["NOT_FOUND", "NOT_READY"]).meta({
          description:
            "NOT_FOUND covers absent and not visible alike; NOT_READY means no such derivative yet.",
        }),
      }),
    ),
  })
  .meta({ id: "BatchAccessUrls" });

export const Tag = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(40)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u, "Use letters, digits, spaces, - and _.");

export const PhotoTagsPut = z
  .strictObject({
    tags: z
      .array(Tag)
      .max(20)
      .transform((tags) => [...new Set(tags)]),
  })
  .meta({ id: "PhotoTagsPut", description: "Replaces the photo's tags." });

// ---- Media permissions and releases ------------------------------------------------

export const PhotoPermission = z
  .strictObject({
    id: Uuid,
    category: MediaPermissionCategory,
    scope: MediaPermissionScope,
    photoSessionId: Uuid.optional(),
    photoId: Uuid.optional(),
    state: PhotoPermissionState,
    versionNumber: z.int().min(1),
    effectiveAt: Timestamp,
    expiresAt: Timestamp.optional(),
    evidence: PermissionEvidence.optional(),
    reason: z.string().optional(),
    recordedByUserId: Uuid.optional(),
    createdAt: Timestamp,
    supersededAt: Timestamp.optional(),
  })
  .meta({
    id: "PhotoPermission",
    description: "One version of a media permission (append-only, Bible §7.2).",
  });

export const PhotoPermissionCategorySummary = z
  .strictObject({
    category: MediaPermissionCategory,
    patientWideState: PhotoPermissionState.meta({
      description: "The current patient-wide state; NOT_REQUESTED when nothing is recorded; expiry applied.",
    }),
    patientWide: PhotoPermission.optional(),
    exceptions: z.array(PhotoPermission).meta({
      description: "Current photo- and session-scoped rows; the most specific row wins (ADR-0023 K2-15).",
    }),
  })
  .meta({ id: "PhotoPermissionCategorySummary" });

export const PhotoPermissionSummary = z
  .strictObject({ categories: z.array(PhotoPermissionCategorySummary) })
  .meta({ id: "PhotoPermissionSummary" });

export const PhotoPermissionChange = z
  .strictObject({
    category: MediaPermissionCategory,
    scope: MediaPermissionScope.default("PATIENT_WIDE"),
    photoSessionId: Uuid.optional(),
    photoId: Uuid.optional(),
    state: z
      .enum(["REQUESTED", "GRANTED", "DECLINED", "REVOKED"])
      .meta({ description: "The new state; EXPIRED is set only by the system at expiresAt." }),
    evidence: PermissionEvidence.optional().meta({
      description: "Required for GRANTED. STAFF_ATTESTATION until signed consents arrive (Layer 4).",
    }),
    expiresAt: Timestamp.optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine(
    (c) =>
      (c.scope === "PATIENT_WIDE" && !c.photoSessionId && !c.photoId) ||
      (c.scope === "PHOTO_SESSION" && c.photoSessionId && !c.photoId) ||
      (c.scope === "PHOTO" && c.photoId && !c.photoSessionId),
    { message: "Name exactly the target the scope needs.", path: ["scope"] },
  )
  .meta({ id: "PhotoPermissionChange" });

export const PhotoPermissionHistoryQuery = PageQuery.extend({
  category: MediaPermissionCategory.optional(),
}).meta({
  id: "PhotoPermissionHistoryQuery",
});

export const MediaRelease = z
  .strictObject({
    id: Uuid,
    purpose: MediaPermissionCategory,
    photoId: Uuid.optional(),
    derivativeId: Uuid.optional(),
    releasedByUserId: Uuid,
    releasedAt: Timestamp,
    revokedAt: Timestamp.optional(),
    revokedByUserId: Uuid.optional(),
    revocationReason: z.string().optional(),
    pinnedPermissionIds: z.array(Uuid).min(1),
    active: z.boolean(),
  })
  .meta({ id: "MediaRelease" });

export const MediaReleaseCreate = z.strictObject({ purpose: MediaPermissionCategory, photoId: Uuid }).meta({
  id: "MediaReleaseCreate",
  description: "PATIENT_APP needs consultation.complete; other purposes need photo.export.",
});

export const MediaReleaseRevoke = z
  .strictObject({ reason: z.string().trim().min(1).max(500) })
  .meta({ id: "MediaReleaseRevoke" });

export const MediaReleaseListQuery = PageQuery.extend({
  purpose: MediaPermissionCategory.optional(),
  activeOnly: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
}).meta({ id: "MediaReleaseListQuery" });

// ---- Offline audit replay (spec §8 rule 8) ----------------------------------------

export const OfflineAuditEvent = z
  .strictObject({
    id: z
      .uuid({ version: "v7" })
      .meta({ description: "Generated on the device; replays are recognised by it." }),
    action: z.enum(["PATIENT_VIEWED", "PHOTO_VIEWED"]),
    patientId: Uuid,
    photoId: Uuid.optional(),
    variant: z.enum(["THUMBNAIL", "DISPLAY_PREVIEW"]).optional(),
    occurredAt: Timestamp,
  })
  .refine((e) => (e.action === "PHOTO_VIEWED") === (e.photoId !== undefined), {
    message: "PHOTO_VIEWED names its photo; PATIENT_VIEWED names none.",
    path: ["photoId"],
  })
  .meta({ id: "OfflineAuditEvent" });

export const OfflineAuditBatch = z
  .strictObject({ events: z.array(OfflineAuditEvent).min(1).max(100) })
  .meta({ id: "OfflineAuditBatch" });

export const OfflineAuditResult = z
  .strictObject({
    recorded: z.int().min(0),
    alreadyRecorded: z.int().min(0),
  })
  .meta({ id: "OfflineAuditResult" });
