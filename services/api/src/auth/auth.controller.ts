// Routes of the "Auth" group. Each method is bound to its registry entry; the
// pipeline has already authenticated and validated the request.
import type {
  InvitationAcceptRequest,
  LoginRequest,
  MfaEnrollmentConfirmRequest,
  MfaEnrollmentRequest,
  MfaVerifyRequest,
  PasswordChangeRequest,
  PasswordForgotRequest,
  PasswordResetRequest,
  RefreshRequest,
  SwitchOrganizationRequest,
} from "@aestara/api-contracts";
import { Controller, Inject } from "@nestjs/common";
import type { z } from "zod";
import type { RequestContext } from "../common/context.ts";
import { Ctx, Operation, type OperationResult } from "../common/operation.ts";
import { AuthService } from "./auth.service.ts";
import { CredentialsService } from "./credentials.service.ts";
import { SIGNER } from "./keys.provider.ts";
import { type TokenSigner } from "./keys.ts";

type Body<T extends z.ZodType> = z.output<T>;
const id = (ctx: RequestContext) => ctx.params.id ?? "";

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly credentials: CredentialsService,
    @Inject(SIGNER) private readonly signer: TokenSigner,
  ) {}

  @Operation("login")
  login(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.auth.login(ctx, ctx.body as Body<typeof LoginRequest>);
  }

  @Operation("verifyMfa")
  verifyMfa(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.auth.verifyMfa(ctx, ctx.body as Body<typeof MfaVerifyRequest>);
  }

  @Operation("refreshToken")
  refresh(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.auth.refresh(ctx, ctx.body as Body<typeof RefreshRequest>);
  }

  @Operation("logout")
  logout(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.auth.logout(ctx);
  }

  @Operation("getSession")
  session(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.auth.sessionInfo(ctx);
  }

  @Operation("switchOrganization")
  switchOrganization(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.auth.switchOrganization(ctx, ctx.body as Body<typeof SwitchOrganizationRequest>);
  }

  @Operation("listOwnSessions")
  sessions(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.auth.listOwnSessions(ctx, ctx.query as { limit: number; cursor?: string });
  }

  @Operation("revokeOwnSession")
  revokeSession(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.auth.revokeOwnSession(ctx, id(ctx));
  }

  @Operation("forgotPassword")
  forgot(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.credentials.forgot(ctx, ctx.body as Body<typeof PasswordForgotRequest>);
  }

  @Operation("resetPassword")
  reset(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.credentials.reset(ctx, ctx.body as Body<typeof PasswordResetRequest>);
  }

  @Operation("changePassword")
  change(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.credentials.change(ctx, ctx.body as Body<typeof PasswordChangeRequest>);
  }

  @Operation("acceptInvitation")
  acceptInvitation(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.credentials.acceptInvitation(ctx, ctx.body as Body<typeof InvitationAcceptRequest>);
  }

  @Operation("createMfaEnrollment")
  enroll(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.credentials.createEnrollment(ctx, ctx.body as Body<typeof MfaEnrollmentRequest>);
  }

  @Operation("confirmMfaEnrollment")
  confirm(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.credentials.confirmEnrollment(
      ctx,
      id(ctx),
      ctx.body as Body<typeof MfaEnrollmentConfirmRequest>,
    );
  }

  @Operation("deleteMfaEnrollment")
  removeFactor(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.credentials.deleteFactor(ctx, id(ctx));
  }

  @Operation("getJwks")
  async jwks(): Promise<OperationResult> {
    return { data: { keys: await this.signer.jwks() } };
  }
}
