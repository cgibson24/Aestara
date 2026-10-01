// Routes of the "Organizations" group: organizations, practices, locations.
import type {
  FirstAdmin,
  LocationCreate,
  LocationUpdate,
  OrganizationCreate,
  OrganizationUpdate,
  PracticeCreate,
  PracticeUpdate,
} from "@aestara/api-contracts";
import { Controller } from "@nestjs/common";
import type { z } from "zod";
import type { RequestContext } from "../common/context.ts";
import { Ctx, Operation, type OperationResult } from "../common/operation.ts";
import { OrganizationsService } from "./organizations.service.ts";

type Page = { limit: number; cursor?: string };
const id = (ctx: RequestContext) => ctx.params.id ?? "";

@Controller()
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Operation("listOrganizations")
  list(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.organizations.list(ctx, ctx.query as Page);
  }

  @Operation("createOrganization")
  create(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.organizations.create(ctx, ctx.body as z.output<typeof OrganizationCreate>);
  }

  @Operation("getOrganization")
  get(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.organizations.get(ctx, id(ctx));
  }

  @Operation("updateOrganization")
  update(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.organizations.update(ctx, id(ctx), ctx.body as z.output<typeof OrganizationUpdate>);
  }

  @Operation("bootstrapOrganizationAdmin")
  bootstrap(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.organizations.bootstrapAdmin(ctx, id(ctx), ctx.body as z.output<typeof FirstAdmin>);
  }

  @Operation("listPractices")
  listPractices(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.organizations.listPractices(ctx, ctx.query as Page);
  }

  @Operation("createPractice")
  createPractice(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.organizations.createPractice(ctx, ctx.body as z.output<typeof PracticeCreate>);
  }

  @Operation("getPractice")
  getPractice(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.organizations.getPractice(ctx, id(ctx));
  }

  @Operation("updatePractice")
  updatePractice(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.organizations.updatePractice(ctx, id(ctx), ctx.body as z.output<typeof PracticeUpdate>);
  }

  @Operation("listLocations")
  listLocations(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.organizations.listLocations(ctx, ctx.query as Page & { practiceId?: string });
  }

  @Operation("createLocation")
  createLocation(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.organizations.createLocation(ctx, ctx.body as z.output<typeof LocationCreate>);
  }

  @Operation("getLocation")
  getLocation(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.organizations.getLocation(ctx, id(ctx));
  }

  @Operation("updateLocation")
  updateLocation(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.organizations.updateLocation(ctx, id(ctx), ctx.body as z.output<typeof LocationUpdate>);
  }
}
