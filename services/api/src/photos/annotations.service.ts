// Photo annotations (spec §6.3 "Photography"; Bible §5.1, §6.6, §23.1;
// ADR-0026 K3-10). Layers are vector JSON over an accepted, unarchived photo;
// the original is never touched. Only the author changes or deletes a layer,
// and deleting keeps the row. Layers drawn offline arrive with client UUIDv7s
// and replay with If-Match. PHOTO_ANNOTATED never carries a layer's text.
import type { PhotoAnnotation, PhotoAnnotationCreate, PhotoAnnotationUpdate } from "@aestara/api-contracts";
import { uuidv7 } from "@aestara/database";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { z } from "zod";
import { AuditWriter } from "../audit/audit-writer.ts";
import { checkVersion, defined, iso, lockRow } from "../common/concurrency.ts";
import { type RequestContext, requireAuth, requireOrganization, requireTx } from "../common/context.ts";
import { ApiError, notFound } from "../common/errors.ts";
import { Idempotency } from "../common/idempotency.ts";
import type { OperationResult } from "../common/operation.ts";
import type { Tx } from "../db/database.ts";

type AnnotationRow = {
  id: string;
  photoId: string;
  authorUserId: string;
  label: string | null;
  layer: unknown;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
};

function annotationDto(a: AnnotationRow): z.input<typeof PhotoAnnotation> {
  return {
    id: a.id,
    photoId: a.photoId,
    authorUserId: a.authorUserId,
    ...defined({ label: a.label }),
    layer: a.layer as z.input<typeof PhotoAnnotation>["layer"],
    createdAt: iso(a.createdAt),
    updatedAt: iso(a.updatedAt),
    version: a.version,
  };
}

const shapes = (layer: { shapes: unknown[] }) => layer.shapes.length;

@Injectable()
export class AnnotationsService implements OnModuleInit {
  constructor(
    private readonly audit: AuditWriter,
    private readonly idempotency: Idempotency,
  ) {}

  onModuleInit(): void {
    this.idempotency.register("createPhotoAnnotation", async (ctx, id) => {
      const row = await this.annotation(requireTx(ctx), ctx.params.photoId ?? "", id);
      return { data: annotationDto(row), version: row.version, resource: { type: "PhotoAnnotation", id } };
    });
  }

  /** The photo, visible to the caller; annotating needs it accepted and unarchived. */
  private async photo(tx: Tx, patientId: string, photoId: string, forChange: boolean): Promise<void> {
    const p = await tx.patientPhoto.findFirst({
      where: { id: photoId, patientId, status: { not: "UPLOAD_PENDING" } },
      select: { status: true },
    });
    if (p === null) throw notFound("PHOTO_NOT_FOUND");
    if (forChange && p.status !== "ACCEPTED")
      throw new ApiError(
        "INVALID_STATE_TRANSITION",
        p.status === "ARCHIVED"
          ? "An archived photo is not annotated."
          : "Only accepted photos are annotated.",
      );
  }

  private async annotation(tx: Tx, photoId: string, id: string): Promise<AnnotationRow> {
    const a = await tx.photoAnnotation.findFirst({ where: { id, photoId, deletedAt: null } });
    if (a === null) throw notFound("PHOTO_ANNOTATION_NOT_FOUND");
    return a;
  }

  /** The caller's own layer, checked for If-Match. */
  private async ownLayer(ctx: RequestContext, patientId: string, photoId: string, id: string) {
    const tx = requireTx(ctx);
    await this.photo(tx, patientId, photoId, false);
    await lockRow(tx, "PhotoAnnotation", id);
    const current = await this.annotation(tx, photoId, id);
    if (current.authorUserId !== requireAuth(ctx).userId)
      throw new ApiError("PERMISSION_DENIED", "Only the layer's author can change or delete it.");
    checkVersion(ctx, current.version);
    await this.photo(tx, patientId, photoId, true);
    return { tx, current };
  }

  async list(ctx: RequestContext, patientId: string, photoId: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await this.photo(tx, patientId, photoId, false);
    const rows = await tx.photoAnnotation.findMany({
      where: { photoId, deletedAt: null },
      orderBy: { id: "asc" },
      take: 100,
    });
    return { data: rows.map(annotationDto), page: { hasMore: false } };
  }

  async create(
    ctx: RequestContext,
    patientId: string,
    photoId: string,
    body: z.output<typeof PhotoAnnotationCreate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await this.photo(tx, patientId, photoId, true);
    const id = body.id ?? uuidv7();
    if ((await tx.photoAnnotation.count({ where: { id } })) > 0) throw new ApiError("CONFLICT");
    let created: AnnotationRow;
    try {
      created = await tx.photoAnnotation.create({
        data: {
          id,
          organizationId: requireOrganization(ctx),
          patientId,
          photoId,
          authorUserId: requireAuth(ctx).userId,
          label: body.label ?? null,
          layer: body.layer,
        },
      });
    } catch (error) {
      // The ID is taken outside this organization: a generic conflict, nothing more (spec §6.1.8).
      if ((error as { code?: string }).code === "P2002") throw new ApiError("CONFLICT");
      throw error;
    }
    await this.audit.write(tx, ctx, {
      action: "PHOTO_ANNOTATED",
      resourceType: "PhotoAnnotation",
      resourceId: id,
      patientId,
      metadata: { photoId, change: "created", shapes: shapes(body.layer) },
    });
    return {
      data: annotationDto(created),
      version: created.version,
      resource: { type: "PhotoAnnotation", id },
    };
  }

  async update(
    ctx: RequestContext,
    patientId: string,
    photoId: string,
    id: string,
    body: z.output<typeof PhotoAnnotationUpdate>,
  ): Promise<OperationResult> {
    const { tx } = await this.ownLayer(ctx, patientId, photoId, id);
    const updated = await tx.photoAnnotation.update({
      where: { id },
      data: {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.layer !== undefined ? { layer: body.layer } : {}),
        version: { increment: 1 },
      },
    });
    await this.audit.write(tx, ctx, {
      action: "PHOTO_ANNOTATED",
      resourceType: "PhotoAnnotation",
      resourceId: id,
      patientId,
      metadata: {
        photoId,
        change: "updated",
        ...(body.layer !== undefined ? { shapes: shapes(body.layer) } : {}),
      },
    });
    return { data: annotationDto(updated), version: updated.version };
  }

  async remove(
    ctx: RequestContext,
    patientId: string,
    photoId: string,
    id: string,
  ): Promise<OperationResult> {
    const { tx } = await this.ownLayer(ctx, patientId, photoId, id);
    await tx.photoAnnotation.update({
      where: { id },
      data: { deletedAt: new Date(), version: { increment: 1 } },
    });
    await this.audit.write(tx, ctx, {
      action: "PHOTO_ANNOTATED",
      resourceType: "PhotoAnnotation",
      resourceId: id,
      patientId,
      metadata: { photoId, change: "deleted" },
    });
    return {};
  }
}
