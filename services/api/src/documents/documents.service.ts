// Clinical documents (spec §6.3 "Documents"; Bible §12, §14.4; ADR-0026
// K3-16, K3-20; ADR-0027). Layer 3 documents are uploaded PDFs and generated
// consultation summaries. Every version is a write-once file: an upload is
// verified (size, SHA-256, `%PDF-`) and scanned before it is served, and a
// version is never changed. Uploaded documents are organization-owned patient
// data; linking one to a consultation needs that consultation's practice.
// Titles are never audited or logged.
import {
  DOCUMENT_MAX_BYTES,
  type Document,
  type DocumentAccessUrl,
  type DocumentUploadIntent,
  type DocumentUploadRequest,
} from "@aestara/api-contracts";
import { uuidv7 } from "@aestara/database";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { z } from "zod";
import { AuditWriter } from "../audit/audit-writer.ts";
import { defined, iso, lockRow } from "../common/concurrency.ts";
import { type RequestContext, requireAuth, requireOrganization, requireTx } from "../common/context.ts";
import { CursorCodec, paginate } from "../common/cursor.ts";
import { ApiError, notFound } from "../common/errors.ts";
import { Idempotency } from "../common/idempotency.ts";
import type { OperationResult } from "../common/operation.ts";
import { ConsultationsService } from "../consultations/consultations.service.ts";
import type { Tx } from "../db/database.ts";
import { matchesSignature } from "../media/formats.ts";
import { hexToBase64, ObjectStore, UPLOAD_URL_SECONDS } from "../media/object-store.ts";
import { DocumentIntake } from "./intake.ts";

type Version = {
  id: string;
  versionNumber: number;
  sha256: string;
  changeNote: string | null;
  createdById: string | null;
  createdAt: Date;
  storageObjectId: string;
  storageObject: { status: string; byteSize: bigint | null; objectKey: string; contentType: string };
};

export type DocumentRow = {
  id: string;
  patientId: string;
  type: z.output<typeof Document>["type"];
  title: string;
  consultationId: string | null;
  status: "ACTIVE" | "ARCHIVED";
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  versions: Version[];
};

export const DOCUMENT_INCLUDE = {
  versions: {
    include: {
      storageObject: { select: { status: true, byteSize: true, objectKey: true, contentType: true } },
    },
    orderBy: { versionNumber: "desc" },
  },
} as const;

function versionStatus(v: Version): "SCANNING" | "AVAILABLE" | "REJECTED" {
  if (v.storageObject.status === "AVAILABLE") return "AVAILABLE";
  if (v.storageObject.status === "REJECTED") return "REJECTED";
  return "SCANNING";
}

export function documentDto(d: DocumentRow): z.input<typeof Document> {
  return {
    id: d.id,
    patientId: d.patientId,
    type: d.type,
    title: d.title,
    status: d.status,
    ...defined({ consultationId: d.consultationId, createdByUserId: d.createdById }),
    createdAt: iso(d.createdAt),
    updatedAt: iso(d.updatedAt),
    versions: d.versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      status: versionStatus(v),
      sha256: v.sha256,
      createdAt: iso(v.createdAt),
      ...defined({
        byteSize: v.storageObject.byteSize === null ? null : Number(v.storageObject.byteSize),
        changeNote: v.changeNote,
        createdByUserId: v.createdById,
      }),
    })),
  };
}

function verificationFailed(reason: string, message: string): ApiError {
  return new ApiError("UPLOAD_VERIFICATION_FAILED", message, { reason });
}

@Injectable()
export class DocumentsService implements OnModuleInit {
  constructor(
    private readonly audit: AuditWriter,
    private readonly consultations: ConsultationsService,
    private readonly cursors: CursorCodec,
    private readonly idempotency: Idempotency,
    private readonly intake: DocumentIntake,
    private readonly store: ObjectStore,
  ) {}

  onModuleInit(): void {
    // A new document takes its first upload's ID, so the replay finds both (ADR-0027).
    this.idempotency.register("createDocumentUpload", async (ctx, uploadId) => {
      const body = ctx.body as z.output<typeof DocumentUploadRequest>;
      return {
        data: await this.intent(requireTx(ctx), body.documentId ?? uploadId, uploadId),
        resource: { type: "StorageObject", id: uploadId },
      };
    });
    this.idempotency.register("completeDocumentUpload", async (ctx, id) => ({
      data: documentDto(await this.document(requireTx(ctx), ctx.params.patientId ?? "", id, true)),
      resource: { type: "Document", id },
    }));
  }

  private async patient(tx: Tx, patientId: string): Promise<void> {
    if ((await tx.patient.count({ where: { id: patientId } })) === 0) throw notFound("PATIENT_NOT_FOUND");
  }

  /** A document of the patient; one without a completed version does not exist yet, except to complete it. */
  async document(tx: Tx, patientId: string, id: string, pendingToo = false): Promise<DocumentRow> {
    const d = (await tx.document.findFirst({
      where: { id, patientId },
      include: DOCUMENT_INCLUDE,
    })) as DocumentRow | null;
    if (d === null || (d.versions.length === 0 && !pendingToo)) throw notFound("DOCUMENT_NOT_FOUND");
    return d;
  }

  async list(
    ctx: RequestContext,
    patientId: string,
    query: { limit: number; cursor?: string; type?: DocumentRow["type"]; consultationId?: string },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await this.patient(tx, patientId);
    const after = this.cursors.decode("documents", query.cursor);
    const rows = (await tx.document.findMany({
      where: {
        patientId,
        versions: { some: {} },
        ...(query.type ? { type: query.type } : {}),
        ...(query.consultationId ? { consultationId: query.consultationId } : {}),
        ...(after ? { id: { lt: after.id } } : {}),
      },
      include: DOCUMENT_INCLUDE,
      orderBy: { id: "desc" },
      take: query.limit + 1,
    })) as DocumentRow[];
    const { items, page } = paginate(rows, query.limit, (d) =>
      this.cursors.encode("documents", { k: null, id: d.id }),
    );
    return { data: items.map(documentDto), page };
  }

  async get(ctx: RequestContext, patientId: string, id: string): Promise<OperationResult> {
    return { data: documentDto(await this.document(requireTx(ctx), patientId, id)) };
  }

  /** The intent's answer: a fresh PUT while the file is still awaited. */
  private async intent(
    tx: Tx,
    documentId: string,
    uploadId: string,
  ): Promise<z.input<typeof DocumentUploadIntent>> {
    const object = await tx.storageObject.findUniqueOrThrow({
      where: { id: uploadId },
      select: { objectKey: true, contentType: true, sha256: true, status: true },
    });
    if (object.status !== "PENDING_UPLOAD") return { documentId, uploadId };
    const put = await this.store.presignUpload({
      key: object.objectKey,
      contentType: object.contentType,
      sha256Hex: object.sha256 ?? "",
    });
    return {
      documentId,
      uploadId,
      upload: { method: "PUT", url: put.url, headers: put.headers, expiresAt: iso(put.expiresAt) },
    };
  }

  /**
   * Registers the file a new document or a new version will hold. The version
   * itself is created when the upload is completed and verified.
   */
  async createUpload(
    ctx: RequestContext,
    patientId: string,
    body: z.output<typeof DocumentUploadRequest>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const organizationId = requireOrganization(ctx);
    const auth = requireAuth(ctx);
    await this.patient(tx, patientId);
    const uploadId = uuidv7();
    let documentId: string;
    if (body.documentId !== undefined) {
      const existing = await tx.document.findFirst({
        where: { id: body.documentId, patientId },
        select: { id: true, type: true, status: true },
      });
      if (existing === null)
        throw new ApiError("VALIDATION_FAILED", undefined, {
          fieldErrors: [
            {
              path: "documentId",
              code: "UNKNOWN_DOCUMENT",
              message: "Choose one of this patient's documents.",
            },
          ],
        });
      if (existing.type !== "UPLOADED_CLINICAL")
        throw new ApiError("INVALID_STATE_TRANSITION", "Only uploaded documents take new uploaded versions.");
      if (existing.status !== "ACTIVE")
        throw new ApiError("INVALID_STATE_TRANSITION", "An archived document takes no new versions.");
      documentId = existing.id;
    } else {
      if (body.consultationId !== undefined) {
        // Linking to a consultation is a change to it: its practice's grant applies (K3-20).
        const c = await tx.consultation.findFirst({
          where: { id: body.consultationId, patientId },
          select: { practiceId: true, locationId: true },
        });
        if (c === null)
          throw new ApiError("VALIDATION_FAILED", undefined, {
            fieldErrors: [
              {
                path: "consultationId",
                code: "UNKNOWN_CONSULTATION",
                message: "Choose one of this patient's consultations.",
              },
            ],
          });
        this.consultations.requireScope(ctx, "document.manage", c.practiceId, c.locationId);
      }
      documentId = uploadId;
      await tx.document.create({
        data: {
          id: documentId,
          organizationId,
          patientId,
          type: "UPLOADED_CLINICAL",
          title: body.title ?? "",
          consultationId: body.consultationId ?? null,
          createdById: auth.userId,
        },
      });
    }
    await tx.storageObject.create({
      data: {
        id: uploadId,
        organizationId,
        objectClass: "DOCUMENT",
        bucket: this.store.bucket,
        objectKey: this.store.newKey("DOCUMENT"),
        contentType: body.contentType,
        byteSize: BigInt(body.byteSize),
        sha256: body.sha256,
        status: "PENDING_UPLOAD",
        scanStatus: "PENDING",
        kmsKeyAlias: this.store.kmsKeyId,
        uploadedById: auth.userId,
      },
    });
    return {
      data: await this.intent(tx, documentId, uploadId),
      resource: { type: "StorageObject", id: uploadId },
    };
  }

  /**
   * Verifies the uploaded file and adds it as the document's next version
   * (spec §6.1.9; K2-03, K3-16). The version is served once its scan is clean.
   */
  async completeUpload(
    ctx: RequestContext,
    patientId: string,
    documentId: string,
    uploadId: string,
    changeNote: string | undefined,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    await lockRow(tx, "Document", documentId);
    const d = await this.document(tx, patientId, documentId, true);
    if (d.type !== "UPLOADED_CLINICAL")
      throw new ApiError("INVALID_STATE_TRANSITION", "Only uploaded documents take new uploaded versions.");
    const object = await tx.storageObject.findFirst({
      where: { id: uploadId, objectClass: "DOCUMENT", uploadedById: auth.userId },
      select: {
        id: true,
        objectKey: true,
        contentType: true,
        byteSize: true,
        sha256: true,
        status: true,
        scanStatus: true,
      },
    });
    // A new document waits for the upload that created it; a version for any of the caller's uploads.
    if (object === null || (d.versions.length === 0 && object.id !== d.id))
      throw new ApiError("VALIDATION_FAILED", undefined, {
        fieldErrors: [
          { path: "uploadId", code: "UNKNOWN_UPLOAD", message: "Use the uploadId of your upload intent." },
        ],
      });
    if (
      object.status !== "PENDING_UPLOAD" ||
      (await tx.documentVersion.count({ where: { storageObjectId: object.id } })) > 0
    )
      throw new ApiError("INVALID_STATE_TRANSITION", "This upload was already completed.");
    const stored = await this.store.head(object.objectKey);
    if (stored === undefined)
      throw verificationFailed("NOT_UPLOADED", "No file was uploaded for this document.");
    if (stored.byteSize > DOCUMENT_MAX_BYTES) throw new ApiError("PAYLOAD_TOO_LARGE");
    if (stored.byteSize !== Number(object.byteSize ?? -1))
      throw verificationFailed("SIZE_MISMATCH", "The uploaded file does not have the declared size.");
    const declared = object.sha256 ?? "";
    const verified =
      stored.sha256Base64 !== undefined
        ? stored.sha256Base64 === hexToBase64(declared)
        : (await this.store.sha256Hex(object.objectKey)) === declared;
    if (!verified)
      throw verificationFailed("CHECKSUM_MISMATCH", "The uploaded file does not match its checksum.");
    if (!matchesSignature(object.contentType, await this.store.firstBytes(object.objectKey)))
      throw new ApiError("UNSUPPORTED_MEDIA_TYPE", "The file is not a PDF.");

    await tx.storageObject.update({
      where: { id: object.id },
      data: { status: "QUARANTINED", verifiedAt: new Date() },
    });
    const versionNumber = (d.versions[0]?.versionNumber ?? 0) + 1;
    await tx.documentVersion.create({
      data: {
        id: uuidv7(),
        organizationId: requireOrganization(ctx),
        patientId,
        documentId,
        versionNumber,
        storageObjectId: object.id,
        sha256: declared,
        changeNote: changeNote ?? null,
        createdById: auth.userId,
      },
    });
    await tx.document.update({ where: { id: documentId }, data: { updatedAt: new Date() } });
    await this.audit.write(tx, ctx, {
      action: "DOCUMENT_ADDED",
      resourceType: "Document",
      resourceId: documentId,
      patientId,
      metadata: { type: d.type, versionNumber, generated: false },
    });
    // The scan may have finished first (it starts when the bytes land in S3).
    if (object.scanStatus === "CLEAN" || object.scanStatus === "INFECTED" || object.scanStatus === "ERROR")
      await this.intake.apply(tx, object.id, object.scanStatus);
    return {
      data: documentDto(await this.document(tx, patientId, documentId)),
      resource: { type: "Document", id: documentId },
    };
  }

  /** A signed download of an available version, as an attachment (K3-16). */
  async accessUrl(
    ctx: RequestContext,
    patientId: string,
    documentId: string,
    versionId: string | undefined,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const d = await this.document(tx, patientId, documentId);
    // Without a version: the newest available one, else the newest, to say why there is none.
    const version =
      versionId === undefined
        ? (d.versions.find((v) => versionStatus(v) === "AVAILABLE") ?? d.versions[0])
        : d.versions.find((v) => v.id === versionId);
    if (version === undefined)
      throw new ApiError("VALIDATION_FAILED", undefined, {
        fieldErrors: [
          { path: "versionId", code: "UNKNOWN_VERSION", message: "Choose one of the document's versions." },
        ],
      });
    if (versionStatus(version) !== "AVAILABLE")
      throw new ApiError(
        "INVALID_STATE_TRANSITION",
        versionStatus(version) === "REJECTED"
          ? "This version was blocked by the malware scan."
          : "The document is still being checked.",
      );
    const signed = await this.store.presignDownload({
      key: version.storageObject.objectKey,
      contentType: version.storageObject.contentType,
      fileName: `document-v${version.versionNumber}.pdf`,
      seconds: UPLOAD_URL_SECONDS,
      disposition: "attachment",
    });
    await this.audit.write(tx, ctx, {
      action: "DOCUMENT_VIEWED",
      resourceType: "Document",
      resourceId: documentId,
      patientId,
      metadata: { versionNumber: version.versionNumber, type: d.type },
    });
    const data: z.input<typeof DocumentAccessUrl> = {
      documentId,
      versionId: version.id,
      versionNumber: version.versionNumber,
      url: signed.url,
      expiresAt: iso(signed.expiresAt),
    };
    return { data };
  }
}
