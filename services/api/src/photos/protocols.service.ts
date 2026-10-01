// Photography protocols (spec §6.3 "/photography-protocols", §5.4.10; Bible
// §6.2; ADR-0023 K2-10, K2-11). A protocol is edited only as a DRAFT; once it
// leaves DRAFT the database freezes it and its views (triggers C12–C14), and a
// change is a new draft that supersedes it. Activating a successor retires its
// predecessor in the same transaction. The Bible §6.2 standard protocols are
// seeded per organization by app_seed_standard_protocols and have no creator.
import type {
  PhotographyProtocol,
  PhotographyProtocolCreate,
  PhotographyProtocolUpdate,
  ProtocolViewInput,
} from "@aestara/api-contracts";
import { Injectable } from "@nestjs/common";
import type { z } from "zod";
import { AuditWriter } from "../audit/audit-writer.ts";
import { checkVersion, defined, iso, lockRow } from "../common/concurrency.ts";
import { type RequestContext, requireAuth, requireOrganization, requireTx } from "../common/context.ts";
import { CursorCodec, paginate } from "../common/cursor.ts";
import { ApiError, notFound } from "../common/errors.ts";
import type { OperationResult } from "../common/operation.ts";
import { requireOrganizationGrant, requireScopedPermission } from "../common/scope.ts";
import type { Tx } from "../db/database.ts";

type ProtocolRow = {
  id: string;
  name: string;
  bodyRegion: "FACE" | "BREAST" | "ABDOMEN_BODY" | "OTHER";
  description: string | null;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
  practiceId: string | null;
  supersedesId: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  views: {
    id: string;
    viewKey: string;
    name: string;
    sortOrder: number;
    isRequired: boolean;
    captureInstructions: string | null;
    poseTarget: unknown;
  }[];
  supersededBy: { id: string } | null;
};

const INCLUDE = {
  views: { orderBy: { sortOrder: "asc" as const } },
  supersededBy: { select: { id: true } },
} as const;

export function protocolDto(p: ProtocolRow): z.input<typeof PhotographyProtocol> {
  return {
    id: p.id,
    name: p.name,
    bodyRegion: p.bodyRegion,
    status: p.status,
    standard: p.createdById === null,
    views: p.views.map((v) => ({
      id: v.id,
      viewKey: v.viewKey,
      name: v.name,
      sortOrder: v.sortOrder,
      isRequired: v.isRequired,
      ...defined({
        captureInstructions: v.captureInstructions,
        poseTarget: (v.poseTarget ?? null) as z.input<
          typeof PhotographyProtocol
        >["views"][number]["poseTarget"],
      }),
    })),
    ...defined({
      description: p.description,
      practiceId: p.practiceId,
      supersedesId: p.supersedesId,
      supersededById: p.supersededBy?.id ?? null,
    }),
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
    version: p.version,
  };
}

function invalid(path: string, code: string, message: string): ApiError {
  return new ApiError("VALIDATION_FAILED", undefined, { fieldErrors: [{ path, code, message }] });
}

@Injectable()
export class ProtocolsService {
  constructor(
    private readonly audit: AuditWriter,
    private readonly cursors: CursorCodec,
  ) {}

  private async load(tx: Tx, id: string): Promise<ProtocolRow> {
    const p = await tx.photographyProtocol.findUnique({ where: { id }, include: INCLUDE });
    if (p === null) throw notFound("PHOTOGRAPHY_PROTOCOL_NOT_FOUND");
    return p as ProtocolRow;
  }

  /** practice.manage over the protocol's practice, or organization-wide for an organization protocol (K2-10). */
  private requireManage(ctx: RequestContext, practiceId: string | null): void {
    const auth = requireAuth(ctx);
    if (practiceId === null) requireOrganizationGrant(auth, "practice.manage");
    else
      requireScopedPermission(auth, "practice.manage", { scope: "PRACTICE", practiceId, locationId: null });
  }

  private async checkPractice(tx: Tx, practiceId: string | null | undefined): Promise<void> {
    if (practiceId === null || practiceId === undefined) return;
    if ((await tx.practice.count({ where: { id: practiceId } })) === 0)
      throw invalid("practiceId", "UNKNOWN_PRACTICE", "Choose one of the organization's practices.");
  }

  private viewRows(
    organizationId: string,
    protocolId: string,
    views: readonly z.output<typeof ProtocolViewInput>[],
  ) {
    return views.map((v, i) => ({
      organizationId,
      protocolId,
      viewKey: v.viewKey,
      name: v.name,
      sortOrder: i + 1,
      isRequired: v.isRequired,
      captureInstructions: v.captureInstructions ?? null,
      ...(v.poseTarget !== undefined ? { poseTarget: v.poseTarget } : {}),
    }));
  }

  private async record(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    change: string,
    extra: Record<string, string> = {},
  ) {
    await this.audit.write(tx, ctx, {
      action: "CONFIGURATION_CHANGED",
      resourceType: "PhotographyProtocol",
      resourceId: id,
      metadata: { change, ...extra },
    });
  }

  async list(
    ctx: RequestContext,
    query: {
      limit: number;
      cursor?: string;
      status?: ProtocolRow["status"];
      bodyRegion?: ProtocolRow["bodyRegion"];
    },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const after = this.cursors.decode("protocols", query.cursor);
    const rows = await tx.photographyProtocol.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.bodyRegion ? { bodyRegion: query.bodyRegion } : {}),
        ...(after ? { id: { gt: after.id } } : {}),
      },
      include: INCLUDE,
      orderBy: { id: "asc" },
      take: query.limit + 1,
    });
    const { items, page } = paginate(rows as ProtocolRow[], query.limit, (p) =>
      this.cursors.encode("protocols", { k: null, id: p.id }),
    );
    return { data: items.map(protocolDto), page };
  }

  async get(ctx: RequestContext, id: string): Promise<OperationResult> {
    const p = await this.load(requireTx(ctx), id);
    return { data: protocolDto(p), version: p.version };
  }

  async create(
    ctx: RequestContext,
    body: z.output<typeof PhotographyProtocolCreate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const organizationId = requireOrganization(ctx);
    const practiceId = body.practiceId ?? null;
    this.requireManage(ctx, practiceId);
    await this.checkPractice(tx, practiceId);
    if (body.supersedesId !== undefined) {
      const predecessor = await tx.photographyProtocol.findUnique({
        where: { id: body.supersedesId },
        include: { supersededBy: { select: { id: true } } },
      });
      if (predecessor === null)
        throw invalid("supersedesId", "UNKNOWN_PROTOCOL", "Choose one of the organization's protocols.");
      if (predecessor.status === "DRAFT")
        throw invalid("supersedesId", "NOT_SUPERSEDABLE", "A draft is edited directly, not superseded.");
      if (predecessor.supersededBy !== null)
        throw new ApiError("CONFLICT", "That protocol already has a successor.");
      this.requireManage(ctx, predecessor.practiceId);
    }
    const created = await tx.photographyProtocol.create({
      data: {
        organizationId,
        name: body.name,
        bodyRegion: body.bodyRegion,
        description: body.description ?? null,
        practiceId,
        supersedesId: body.supersedesId ?? null,
        createdById: requireAuth(ctx).userId,
        status: "DRAFT",
      },
    });
    await tx.photographyProtocolView.createMany({
      data: this.viewRows(organizationId, created.id, body.views),
    });
    await this.record(
      tx,
      ctx,
      created.id,
      "CREATED",
      body.supersedesId ? { supersedesId: body.supersedesId } : {},
    );
    const p = await this.load(tx, created.id);
    return { data: protocolDto(p), version: p.version, resource: { type: "PhotographyProtocol", id: p.id } };
  }

  async update(
    ctx: RequestContext,
    id: string,
    body: z.output<typeof PhotographyProtocolUpdate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const organizationId = requireOrganization(ctx);
    await lockRow(tx, "PhotographyProtocol", id);
    const current = await this.load(tx, id);
    this.requireManage(ctx, current.practiceId);
    checkVersion(ctx, current.version);
    if (current.status !== "DRAFT")
      throw new ApiError(
        "INVALID_STATE_TRANSITION",
        "Only a draft can be edited. Create a new protocol that supersedes this one.",
      );
    if (body.practiceId !== undefined) {
      this.requireManage(ctx, body.practiceId);
      await this.checkPractice(tx, body.practiceId);
    }
    if (body.views !== undefined) {
      await tx.photographyProtocolView.deleteMany({ where: { protocolId: id } });
      await tx.photographyProtocolView.createMany({ data: this.viewRows(organizationId, id, body.views) });
    }
    await tx.photographyProtocol.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.bodyRegion !== undefined ? { bodyRegion: body.bodyRegion } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.practiceId !== undefined ? { practiceId: body.practiceId } : {}),
        version: { increment: 1 },
      },
    });
    await this.record(tx, ctx, id, "UPDATED", { fields: Object.keys(body).sort().join(",") });
    const p = await this.load(tx, id);
    return { data: protocolDto(p), version: p.version };
  }

  async activate(ctx: RequestContext, id: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await lockRow(tx, "PhotographyProtocol", id);
    const current = await this.load(tx, id);
    this.requireManage(ctx, current.practiceId);
    checkVersion(ctx, current.version);
    if (current.status !== "DRAFT")
      throw new ApiError("INVALID_STATE_TRANSITION", "Only a draft can be activated.");
    if (current.views.length === 0)
      throw new ApiError("INVALID_STATE_TRANSITION", "Add at least one view first.");
    if (current.supersedesId !== null) {
      await lockRow(tx, "PhotographyProtocol", current.supersedesId);
      const predecessor = await tx.photographyProtocol.findUniqueOrThrow({
        where: { id: current.supersedesId },
      });
      this.requireManage(ctx, predecessor.practiceId);
      if (predecessor.status === "ACTIVE") {
        await tx.photographyProtocol.update({
          where: { id: predecessor.id },
          data: { status: "RETIRED", version: { increment: 1 } },
        });
        await this.record(tx, ctx, predecessor.id, "RETIRED", { supersededById: id });
      }
    }
    await tx.photographyProtocol.update({
      where: { id },
      data: { status: "ACTIVE", version: { increment: 1 } },
    });
    await this.record(tx, ctx, id, "ACTIVATED");
    const p = await this.load(tx, id);
    return { data: protocolDto(p), version: p.version };
  }

  async retire(ctx: RequestContext, id: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await lockRow(tx, "PhotographyProtocol", id);
    const current = await this.load(tx, id);
    this.requireManage(ctx, current.practiceId);
    checkVersion(ctx, current.version);
    if (current.status === "RETIRED")
      throw new ApiError("INVALID_STATE_TRANSITION", "The protocol is already retired.");
    await tx.photographyProtocol.update({
      where: { id },
      data: { status: "RETIRED", version: { increment: 1 } },
    });
    await this.record(tx, ctx, id, current.status === "DRAFT" ? "DISCARDED" : "RETIRED");
    const p = await this.load(tx, id);
    return { data: protocolDto(p), version: p.version };
  }
}
