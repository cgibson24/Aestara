// Routes of the "Roles" group: roles and the permission catalog, served from
// the catalog loaded at start-up (they only change through migrations).
import type { Role } from "@aestara/api-contracts";
import { Controller } from "@nestjs/common";
import type { z } from "zod";
import { Catalog, type CatalogRole } from "../auth/catalog.ts";
import type { RequestContext } from "../common/context.ts";
import { CursorCodec, paginate } from "../common/cursor.ts";
import { notFound } from "../common/errors.ts";
import { Ctx, Operation, type OperationResult } from "../common/operation.ts";

function roleDto(r: CatalogRole): z.input<typeof Role> {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    ...(r.description ? { description: r.description } : {}),
    system: true,
    permissions: [...r.permissions].sort(),
  };
}

@Controller()
export class RolesController {
  constructor(
    private readonly catalog: Catalog,
    private readonly cursors: CursorCodec,
  ) {}

  @Operation("listRoles")
  roles(@Ctx() ctx: RequestContext): OperationResult {
    const { limit, cursor } = ctx.query as { limit: number; cursor?: string };
    const after = this.cursors.decode("roles", cursor);
    const rows = this.catalog
      .allRoles()
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .filter((r) => after === undefined || r.key > (after.k ?? ""));
    const { items, page } = paginate(rows.slice(0, limit + 1), limit, (r) =>
      this.cursors.encode("roles", { k: r.key, id: r.id }),
    );
    return { data: items.map(roleDto), page };
  }

  @Operation("getRole")
  role(@Ctx() ctx: RequestContext): OperationResult {
    const role = this.catalog.role(ctx.params.id ?? "");
    if (role === undefined) throw notFound("ROLE_NOT_FOUND");
    return { data: roleDto(role) };
  }

  @Operation("listPermissions")
  permissions(@Ctx() ctx: RequestContext): OperationResult {
    const { limit, cursor } = ctx.query as { limit: number; cursor?: string };
    const after = this.cursors.decode("permissions", cursor);
    const rows = this.catalog
      .permissions()
      .filter((p) => after === undefined || p.key > (after.k ?? ""))
      .map((p) => ({ ...p, id: p.key }));
    const { items, page } = paginate(rows.slice(0, limit + 1), limit, (p) =>
      this.cursors.encode("permissions", { k: p.key, id: p.key }),
    );
    return { data: items.map(({ key, description }) => ({ key, description })), page };
  }
}
