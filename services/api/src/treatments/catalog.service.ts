// Treatment catalog (spec §6.3 "Treatment plans & estimates"; Bible §11.1,
// §17.1; ADR-0028 K4-03, K4-22; ADR-0029). The catalog is organization-wide:
// reading needs treatmentplan.create or practice.manage, and changing needs
// practice.manage through an organization-wide grant. Categories and
// treatments are retired, never deleted, so plans and procedures keep pointing
// at them; nothing active is left under a retired category.
import type {
  TreatmentCategoryCreate,
  TreatmentCategoryUpdate,
  TreatmentCreate,
  TreatmentUpdate,
} from "@aestara/api-contracts";
import { Injectable } from "@nestjs/common";
import type { z } from "zod";
import { AuditWriter } from "../audit/audit-writer.ts";
import { checkVersion, defined, iso, lockRow, present } from "../common/concurrency.ts";
import { type RequestContext, requireAuth, requireOrganization, requireTx } from "../common/context.ts";
import { CursorCodec, paginate } from "../common/cursor.ts";
import { ApiError, notFound } from "../common/errors.ts";
import type { OperationResult } from "../common/operation.ts";
import { requireOrganizationGrant } from "../common/scope.ts";
import type { Tx } from "../db/database.ts";

type Status = "ACTIVE" | "INACTIVE";

type CategoryRow = {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  status: Status;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

type TreatmentRow = {
  id: string;
  categoryId: string;
  name: string;
  code: string | null;
  description: string | null;
  unitLabel: string | null;
  defaultUnitPrice: { toFixed(digits: number): string } | null;
  status: Status;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

/** A category tree is shallow; this bounds the ancestor walk if data were ever corrupt. */
const MAX_DEPTH = 50;

function categoryDto(c: CategoryRow) {
  return {
    id: c.id,
    name: c.name,
    ...defined({ parentId: c.parentId }),
    sortOrder: c.sortOrder,
    status: c.status,
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
    version: c.version,
  };
}

function treatmentDto(t: TreatmentRow) {
  return {
    id: t.id,
    categoryId: t.categoryId,
    name: t.name,
    ...defined({
      code: t.code,
      description: t.description,
      unitLabel: t.unitLabel,
      defaultUnitPrice:
        t.defaultUnitPrice === null
          ? null
          : { amount: t.defaultUnitPrice.toFixed(2), currency: "USD" as const },
    }),
    status: t.status,
    createdAt: iso(t.createdAt),
    updatedAt: iso(t.updatedAt),
    version: t.version,
  };
}

function invalid(path: string, code: string, message: string): ApiError {
  return new ApiError("VALIDATION_FAILED", undefined, { fieldErrors: [{ path, code, message }] });
}

/** The change an update makes, for the audit row: names only, never values. */
function change(status: Status | undefined, current: Status): string {
  if (status === "INACTIVE" && current === "ACTIVE") return "RETIRED";
  if (status === "ACTIVE" && current === "INACTIVE") return "REACTIVATED";
  return "UPDATED";
}

@Injectable()
export class TreatmentCatalogService {
  constructor(
    private readonly audit: AuditWriter,
    private readonly cursors: CursorCodec,
  ) {}

  private manage(ctx: RequestContext): void {
    requireOrganizationGrant(requireAuth(ctx), "practice.manage");
  }

  private async record(
    tx: Tx,
    ctx: RequestContext,
    resourceType: "TreatmentCategory" | "Treatment",
    id: string,
    what: string,
    fields: readonly string[],
  ): Promise<void> {
    await this.audit.write(tx, ctx, {
      action: "CONFIGURATION_CHANGED",
      resourceType,
      resourceId: id,
      metadata: { change: what, fields: [...fields].sort().join(",") },
    });
  }

  private async category(tx: Tx, id: string): Promise<CategoryRow> {
    const c = await tx.treatmentCategory.findUnique({ where: { id } });
    if (c === null) throw notFound("TREATMENT_CATEGORY_NOT_FOUND");
    return c;
  }

  private async treatment(tx: Tx, id: string): Promise<TreatmentRow> {
    const t = await tx.treatment.findUnique({ where: { id } });
    if (t === null) throw notFound("TREATMENT_NOT_FOUND");
    return t;
  }

  /** An active category of the organization (RLS limits the lookup to the tenant). */
  private async activeCategory(tx: Tx, id: string, path: string): Promise<CategoryRow> {
    const c = await tx.treatmentCategory.findUnique({ where: { id } });
    if (c === null) throw invalid(path, "UNKNOWN_CATEGORY", "Choose one of the organization's categories.");
    if (c.status !== "ACTIVE") throw invalid(path, "CATEGORY_INACTIVE", "Choose an active category.");
    return c;
  }

  /** Refuses placing a category under itself or one of its own subcategories. */
  private async checkNoCycle(tx: Tx, id: string, parentId: string): Promise<void> {
    let cursor: string | null = parentId;
    for (let depth = 0; cursor !== null && depth < MAX_DEPTH; depth++) {
      if (cursor === id)
        throw invalid(
          "parentId",
          "CATEGORY_CYCLE",
          "A category cannot sit under itself or its subcategories.",
        );
      const next: { parentId: string | null } | null = await tx.treatmentCategory.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = next?.parentId ?? null;
    }
  }

  private async checkCodeFree(tx: Tx, code: string, exceptId?: string): Promise<void> {
    const other = await tx.treatment.findFirst({
      where: { code, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (other !== null) throw new ApiError("CONFLICT", "Another treatment already uses this code.");
  }

  // ---- Categories ----

  async listCategories(
    ctx: RequestContext,
    query: { limit: number; cursor?: string; status?: Status },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const after = this.cursors.decode("treatment-categories", query.cursor);
    const rows = await tx.treatmentCategory.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(after ? { id: { gt: after.id } } : {}),
      },
      orderBy: { id: "asc" },
      take: query.limit + 1,
    });
    const { items, page } = paginate(rows, query.limit, (c) =>
      this.cursors.encode("treatment-categories", { k: null, id: c.id }),
    );
    return { data: items.map(categoryDto), page };
  }

  async createCategory(
    ctx: RequestContext,
    body: z.output<typeof TreatmentCategoryCreate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    this.manage(ctx);
    if (body.parentId !== undefined) await this.activeCategory(tx, body.parentId, "parentId");
    const created = await tx.treatmentCategory.create({
      data: {
        organizationId: requireOrganization(ctx),
        name: body.name,
        parentId: body.parentId ?? null,
        sortOrder: body.sortOrder ?? 0,
      },
    });
    await this.record(tx, ctx, "TreatmentCategory", created.id, "CREATED", Object.keys(body));
    return {
      data: categoryDto(created),
      version: created.version,
      resource: { type: "TreatmentCategory", id: created.id },
    };
  }

  async updateCategory(
    ctx: RequestContext,
    id: string,
    body: z.output<typeof TreatmentCategoryUpdate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await lockRow(tx, "TreatmentCategory", id);
    const current = await this.category(tx, id);
    this.manage(ctx);
    checkVersion(ctx, current.version);
    const parentId = body.parentId === undefined ? current.parentId : body.parentId;
    const status = body.status ?? current.status;
    if (body.parentId !== undefined && body.parentId !== null) {
      await this.activeCategory(tx, body.parentId, "parentId");
      await this.checkNoCycle(tx, id, body.parentId);
    }
    if (status === "ACTIVE" && current.status === "INACTIVE" && parentId !== null) {
      const parent = await this.category(tx, parentId);
      if (parent.status !== "ACTIVE")
        throw invalid("status", "PARENT_INACTIVE", "Reactivate its parent category first.");
    }
    if (status === "INACTIVE" && current.status === "ACTIVE") {
      const [children, treatments] = await Promise.all([
        tx.treatmentCategory.count({ where: { parentId: id, status: "ACTIVE" } }),
        tx.treatment.count({ where: { categoryId: id, status: "ACTIVE" } }),
      ]);
      if (children > 0 || treatments > 0)
        throw new ApiError(
          "CONFLICT",
          "Retire or move this category's active treatments and subcategories first.",
          { activeTreatments: treatments, activeSubcategories: children },
        );
    }
    const updated = await tx.treatmentCategory.update({
      where: { id },
      data: { ...present(body), version: { increment: 1 } },
    });
    await this.record(
      tx,
      ctx,
      "TreatmentCategory",
      id,
      change(body.status, current.status),
      Object.keys(body),
    );
    return { data: categoryDto(updated), version: updated.version };
  }

  // ---- Treatments ----

  async listTreatments(
    ctx: RequestContext,
    query: { limit: number; cursor?: string; categoryId?: string; status?: Status },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const after = this.cursors.decode("treatments", query.cursor);
    const rows = await tx.treatment.findMany({
      where: {
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(after ? { id: { gt: after.id } } : {}),
      },
      orderBy: { id: "asc" },
      take: query.limit + 1,
    });
    const { items, page } = paginate(rows, query.limit, (t) =>
      this.cursors.encode("treatments", { k: null, id: t.id }),
    );
    return { data: items.map(treatmentDto), page };
  }

  async createTreatment(
    ctx: RequestContext,
    body: z.output<typeof TreatmentCreate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    this.manage(ctx);
    await this.activeCategory(tx, body.categoryId, "categoryId");
    if (body.code !== undefined) await this.checkCodeFree(tx, body.code);
    const created = await tx.treatment.create({
      data: {
        organizationId: requireOrganization(ctx),
        categoryId: body.categoryId,
        name: body.name,
        code: body.code ?? null,
        description: body.description ?? null,
        unitLabel: body.unitLabel ?? null,
        defaultUnitPrice: body.defaultUnitPrice?.amount ?? null,
      },
    });
    await this.record(tx, ctx, "Treatment", created.id, "CREATED", Object.keys(body));
    return {
      data: treatmentDto(created),
      version: created.version,
      resource: { type: "Treatment", id: created.id },
    };
  }

  async updateTreatment(
    ctx: RequestContext,
    id: string,
    body: z.output<typeof TreatmentUpdate>,
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    await lockRow(tx, "Treatment", id);
    const current = await this.treatment(tx, id);
    this.manage(ctx);
    checkVersion(ctx, current.version);
    if (body.categoryId !== undefined) await this.activeCategory(tx, body.categoryId, "categoryId");
    if (body.status === "ACTIVE" && current.status === "INACTIVE" && body.categoryId === undefined) {
      const category = await this.category(tx, current.categoryId);
      if (category.status !== "ACTIVE")
        throw invalid("status", "CATEGORY_INACTIVE", "Reactivate its category, or move it to an active one.");
    }
    if (body.code !== undefined && body.code !== null) await this.checkCodeFree(tx, body.code, id);
    const { defaultUnitPrice, ...rest } = body;
    const updated = await tx.treatment.update({
      where: { id },
      data: {
        ...present(rest),
        ...(defaultUnitPrice !== undefined ? { defaultUnitPrice: defaultUnitPrice?.amount ?? null } : {}),
        version: { increment: 1 },
      },
    });
    await this.record(tx, ctx, "Treatment", id, change(body.status, current.status), Object.keys(body));
    return { data: treatmentDto(updated), version: updated.version };
  }
}
