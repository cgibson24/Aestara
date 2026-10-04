// Clinical documents and the patient timeline (spec §6.3 "Documents" and
// `/timeline`; Bible §4.3, §12, §14.4; ADR-0026 K3-16 to K3-18; ADR-0027).
// Layer 3 documents are uploaded PDFs and generated consultation summaries.
// Every version is an immutable, write-once file; uploads are scanned.
import {
  DocumentStatus as DocumentStatusValues,
  DocumentType as DocumentTypeValues,
} from "@aestara/shared-types";
import { PageQuery } from "./pagination.ts";
import { SignedUpload } from "./photography.ts";
import { Timestamp, Uuid } from "./primitives.ts";
import { z } from "./zod.ts";

/** An uploaded document: at most 50 MiB, PDF only (K3-16). */
export const DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;
export const DOCUMENT_CONTENT_TYPES = ["application/pdf"] as const;

export const DocumentType = z.enum(DocumentTypeValues).meta({
  id: "DocumentType",
  description: "Layer 3 creates CONSULTATION_SUMMARY (generated) and UPLOADED_CLINICAL (uploaded by staff).",
});
export const DocumentStatus = z.enum(DocumentStatusValues).meta({ id: "DocumentStatus" });

export const DocumentVersionStatus = z.enum(["SCANNING", "AVAILABLE", "REJECTED"]).meta({
  id: "DocumentVersionStatus",
  description: "From the file: being scanned, available, or rejected by the malware scan and never served.",
});

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/, "64 lowercase hexadecimal characters.");

export const DocumentVersion = z
  .strictObject({
    id: Uuid,
    versionNumber: z.int().positive(),
    status: DocumentVersionStatus,
    byteSize: z.int().positive().optional(),
    sha256: Sha256,
    changeNote: z.string().optional(),
    createdByUserId: Uuid.optional(),
    createdAt: Timestamp,
  })
  .meta({ id: "DocumentVersion" });

export const Document = z
  .strictObject({
    id: Uuid,
    patientId: Uuid,
    type: DocumentType,
    title: z.string(),
    consultationId: Uuid.optional(),
    status: DocumentStatus,
    createdByUserId: Uuid.optional(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
    versions: z.array(DocumentVersion).min(1).meta({ description: "Newest first." }),
  })
  .meta({ id: "Document" });

export const DocumentListQuery = PageQuery.extend({
  type: DocumentType.optional(),
  consultationId: Uuid.optional(),
}).meta({ id: "DocumentListQuery" });

const Title = z.string().trim().min(1).max(200);

export const DocumentUploadRequest = z
  .strictObject({
    documentId: Uuid.optional().meta({ description: "Add a version to this uploaded document." }),
    title: Title.optional().meta({ description: "A new document's title. Never audited or logged." }),
    consultationId: Uuid.optional().meta({
      description: "Link a new document to a consultation of the patient.",
    }),
    contentType: z.enum(DOCUMENT_CONTENT_TYPES),
    byteSize: z.int().min(1).max(DOCUMENT_MAX_BYTES),
    sha256: Sha256,
  })
  .refine((v) => (v.documentId === undefined) !== (v.title === undefined), {
    message: "Give either documentId (a new version) or title (a new document).",
  })
  .refine((v) => v.documentId === undefined || v.consultationId === undefined, {
    message: "A new version keeps its document's consultation.",
  })
  .meta({ id: "DocumentUploadRequest" });

export const DocumentUploadIntent = z
  .strictObject({
    documentId: Uuid,
    uploadId: Uuid.meta({ description: "Send it to complete-upload once the PUT succeeded." }),
    upload: SignedUpload.optional().meta({ description: "Present while the file is awaited." }),
  })
  .meta({ id: "DocumentUploadIntent" });

export const DocumentUploadComplete = z
  .strictObject({
    uploadId: Uuid,
    changeNote: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .meta({ description: "What the new version changes." }),
  })
  .meta({ id: "DocumentUploadComplete" });

export const DocumentAccessUrlRequest = z
  .strictObject({
    versionId: Uuid.optional().meta({ description: "Default: the newest available version." }),
  })
  .meta({ id: "DocumentAccessUrlRequest" });

export const DocumentAccessUrl = z
  .strictObject({
    documentId: Uuid,
    versionId: Uuid,
    versionNumber: z.int().positive(),
    url: z.url(),
    expiresAt: Timestamp,
  })
  .meta({ id: "DocumentAccessUrl", description: "A signed GET, valid 10 minutes, served as an attachment." });

// ---- Patient timeline (K3-18) ----------------------------------------------------------

export const TIMELINE_DOMAINS = [
  "PATIENT",
  "CONSULTATION",
  "PHOTOGRAPHY",
  "DOCUMENT",
  "MEDIA_PERMISSION",
] as const;
export const TimelineDomain = z.enum(TIMELINE_DOMAINS).meta({
  id: "TimelineDomain",
  description:
    "Each domain needs its read permission: patient.read, consultation.create, photo.view, document.read " +
    "and photo.permission.read.",
});

export const TimelineItemKind = z
  .enum([
    "PATIENT_CREATED",
    "PATIENT_ARCHIVED",
    "CONSULTATION_CREATED",
    "CONSULTATION_STARTED",
    "CONSULTATION_SUBMITTED_FOR_REVIEW",
    "CONSULTATION_COMPLETED",
    "CONSULTATION_CANCELLED",
    "CONSULTATION_ARCHIVED",
    "PHOTO_SESSION_COMPLETED",
    "BEFORE_AFTER_CREATED",
    "DOCUMENT_ADDED",
    "MEDIA_PERMISSION_CHANGED",
    "MEDIA_RELEASED",
    "MEDIA_RELEASE_REVOKED",
  ])
  .meta({ id: "TimelineItemKind" });

export const TimelineItem = z
  .strictObject({
    id: z.string().meta({ description: "Opaque and stable." }),
    kind: TimelineItemKind,
    domain: TimelineDomain,
    occurredAt: Timestamp,
    actorUserId: Uuid.optional(),
    resource: z.strictObject({
      type: z.enum([
        "Patient",
        "Consultation",
        "PhotoSession",
        "BeforeAfterSet",
        "Document",
        "PhotoPermission",
        "MediaRelease",
      ]),
      id: Uuid,
    }),
  })
  .meta({ id: "TimelineItem", description: "Metadata only: never text from the record." });

export const TimelineQuery = PageQuery.extend({ domain: TimelineDomain.optional() }).meta({
  id: "TimelineQuery",
});
