// Routes of the "Users" group.
import type {
  MfaResetRequest,
  ProviderProfilePut,
  RoleAssignmentCreate,
  StaffProfilePut,
  UserCreate,
  UserUpdate,
} from "@aestara/api-contracts";
import { Controller } from "@nestjs/common";
import type { z } from "zod";
import type { RequestContext } from "../common/context.ts";
import { Ctx, Operation, type OperationResult } from "../common/operation.ts";
import { UsersService } from "./users.service.ts";

const id = (ctx: RequestContext) => ctx.params.id ?? "";

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Operation("listUsers")
  list(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.users.list(ctx, ctx.query as { limit: number; cursor?: string });
  }

  @Operation("createUser")
  create(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.users.create(ctx, ctx.body as z.output<typeof UserCreate>);
  }

  @Operation("getUser")
  get(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.users.get(ctx, id(ctx));
  }

  @Operation("updateUser")
  update(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.users.update(ctx, id(ctx), ctx.body as z.output<typeof UserUpdate>);
  }

  @Operation("disableUser")
  disable(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.users.disable(ctx, id(ctx));
  }

  @Operation("createRoleAssignment")
  assign(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.users.createAssignment(ctx, id(ctx), ctx.body as z.output<typeof RoleAssignmentCreate>);
  }

  @Operation("revokeRoleAssignment")
  revoke(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.users.revokeAssignment(ctx, id(ctx), ctx.params.assignmentId ?? "");
  }

  @Operation("getProviderProfile")
  getProvider(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.users.getProviderProfile(ctx, id(ctx));
  }

  @Operation("putProviderProfile")
  putProvider(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.users.putProviderProfile(ctx, id(ctx), ctx.body as z.output<typeof ProviderProfilePut>);
  }

  @Operation("getStaffProfile")
  getStaff(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.users.getStaffProfile(ctx, id(ctx));
  }

  @Operation("putStaffProfile")
  putStaff(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.users.putStaffProfile(ctx, id(ctx), ctx.body as z.output<typeof StaffProfilePut>);
  }

  @Operation("revokeUserSessions")
  revokeSessions(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.users.revokeSessions(ctx, id(ctx));
  }

  @Operation("resetUserMfa")
  resetMfa(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.users.resetMfa(ctx, id(ctx), ctx.body as z.output<typeof MfaResetRequest>);
  }
}
