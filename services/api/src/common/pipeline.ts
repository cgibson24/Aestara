// The operation pipeline: every route runs through it, in this order
// (spec §4.6, §6.1; ADR-0021):
//   1. authenticate the access token (401 UNAUTHENTICATED)
//   2. validate path, query and body against the contract (400)
//   3. check the If-Match and Idempotency-Key headers (428, 400)
//   4. open the request transaction: tenant (aestara_app + set_config),
//      platform (aestara_platform) or identity (no tenant)
//   5. load the session and grants inside it (401 SESSION_INVALID)
//   6. authorize: permission (403, or 404 when the resource is not visible),
//      step-up (403 REAUTHENTICATION_REQUIRED); refusals on patient routes are
//      audited as ACCESS_DENIED after the rollback
//   7. idempotency: claim the key or replay the first outcome
//   8. run the handler, then shape the envelope and ETag
// Public and token-authenticated operations (sign-in, refresh, reset,
// invitations) skip 4–7: their services manage their own transactions, because
// the security ledger must commit even when the request fails.
import { type EndpointDefinition, etagFor, Header } from "@aestara/api-contracts";
import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyReply, FastifyRequest } from "fastify";
import { from, lastValueFrom, type Observable } from "rxjs";
import { z } from "zod";
import { AuditWriter } from "../audit/audit-writer.ts";
import { Catalog } from "../auth/catalog.ts";
import { type EvaluationScope, SessionLoader } from "../auth/session-loader.ts";
import { AccessTokens } from "../auth/tokens.ts";
import { CONFIG, type Config } from "../config.ts";
import { Database, type Tx } from "../db/database.ts";
import type { AuthContext, RequestContext } from "./context.ts";
import { ApiError, notFound } from "./errors.ts";
import { Idempotency } from "./idempotency.ts";
import { OPERATION_KEY, type OperationResult } from "./operation.ts";
import { parseInput } from "./validation.ts";
import { readPermissionFor, resourceVisible } from "./visibility.ts";

export const STEP_UP_WINDOW_MS = 15 * 60 * 1000;

const IfMatchHeader = z.string().regex(/^"v(\d{1,9})"$/);
const IdempotencyKeyHeader = z.uuid();

function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer ([A-Za-z0-9_\-.]+)$/.exec(header ?? "");
  return match?.[1];
}

function header(req: FastifyRequest, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

@Injectable()
export class OperationPipeline implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: Database,
    private readonly tokens: AccessTokens,
    private readonly sessions: SessionLoader,
    private readonly catalog: Catalog,
    private readonly idempotency: Idempotency,
    private readonly audit: AuditWriter,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const op = this.reflector.get<EndpointDefinition | undefined>(OPERATION_KEY, context.getHandler());
    if (op === undefined) throw new Error("Every route must be bound to a registry operation");
    const http = context.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    return from(this.run(op, req, reply, () => lastValueFrom(next.handle(), { defaultValue: undefined })));
  }

  private async run(
    op: EndpointDefinition,
    req: FastifyRequest,
    reply: FastifyReply,
    handler: () => Promise<unknown>,
  ): Promise<unknown> {
    const ctx = req.ctx;
    ctx.operation = op;

    // 1. Authenticate.
    const bearer = bearerToken(header(req, "authorization"));
    const usesSession =
      op.auth.kind === "session" ||
      op.auth.kind === "permission" ||
      (op.auth.kind === "token" && op.auth.token === "challenge-or-session" && bearer !== undefined);
    const claims = usesSession && bearer !== undefined ? await this.tokens.verify(bearer) : undefined;
    if (usesSession && claims === undefined) throw new ApiError("UNAUTHENTICATED");

    // 2. Validate.
    ctx.params = op.params ? (parseInput(op.params, req.params ?? {}) as Record<string, string>) : {};
    ctx.query = op.query ? parseInput(op.query, req.query ?? {}) : {};
    if (!op.query && Object.keys((req.query as object | undefined) ?? {}).length > 0)
      throw new ApiError("VALIDATION_FAILED", "This endpoint takes no query parameters.");
    if (op.body !== undefined && req.body !== undefined && req.body !== null) {
      // JSON only (spec §6.1.2): Fastify would otherwise accept text/plain bodies.
      const type = header(req, "content-type") ?? "";
      if (!/^application\/json\s*(;|$)/i.test(type)) throw new ApiError("UNSUPPORTED_MEDIA_TYPE");
    }
    ctx.body = op.body ? parseInput(op.body, req.body ?? {}) : undefined;

    // 3. Headers.
    const ifMatch = header(req, Header.ifMatch);
    if (op.ifMatch !== undefined) {
      if (ifMatch === undefined) {
        if (op.ifMatch === "required") throw new ApiError("PRECONDITION_REQUIRED");
      } else {
        const parsed = IfMatchHeader.safeParse(ifMatch);
        if (!parsed.success) throw fieldError(Header.ifMatch, 'Use the ETag value, e.g. "v3".');
        ctx.ifMatch = Number(/\d+/.exec(parsed.data)?.[0]);
      }
    }
    if (op.idempotency === "required") {
      const key = header(req, Header.idempotencyKey);
      if (key === undefined || !IdempotencyKeyHeader.safeParse(key).success)
        throw fieldError(Header.idempotencyKey, "Send a UUID Idempotency-Key header.");
      ctx.idempotencyKey = key;
    }

    let result: OperationResult | undefined;
    if (claims === undefined) {
      result = (await handler()) as OperationResult | undefined;
    } else {
      // 4. Open the request transaction in the right scope.
      const scope = this.evaluationScope(op, claims.org);
      const inTx = async (tx: Tx): Promise<OperationResult | undefined> => {
        ctx.tx = tx;
        try {
          // 5. Session and grants.
          const auth = await this.sessions.load(tx, claims, scope);
          ctx.auth = auth;
          // 6. Authorize.
          await this.authorize(op, ctx, auth, tx);
          if (op.stepUp) await this.requireStepUp(tx, auth);
          // 7. Idempotency.
          const idempotent = op.idempotency === "required";
          if (idempotent) {
            const replay = await this.idempotency.begin(tx, ctx, op, auth.userId, auth.organizationId);
            if (replay !== undefined) return replay;
          }
          // 8. Handler.
          const out = (await handler()) as OperationResult | undefined;
          if (idempotent && out !== undefined)
            await this.idempotency.complete(tx, ctx, auth.userId, out.status ?? op.response.status, out);
          return out;
        } finally {
          ctx.tx = undefined;
        }
      };
      try {
        result =
          scope === "organization" && claims.org !== undefined
            ? await this.db.tenant(claims.org, inTx)
            : scope === "platform"
              ? await this.db.platformTx(inTx)
              : await this.db.identity(inTx);
      } catch (error) {
        await this.auditDenial(op, ctx, error);
        throw error;
      }
    }
    for (const task of ctx.afterCommit.splice(0)) await task();
    return this.shape(op, ctx, reply, result);
  }

  /** Where the permission is evaluated: the session's organization, else the platform (spec §4.6). */
  private evaluationScope(op: EndpointDefinition, org: string | undefined): EvaluationScope {
    if (op.auth.kind !== "permission") return org !== undefined ? "organization" : "none";
    const scopes = op.auth.scopes;
    if (scopes.length === 1 && scopes[0] === "platform") return "platform";
    if (org !== undefined && scopes.includes("organization")) return "organization";
    if (scopes.includes("platform")) return "platform";
    return "none";
  }

  private async authorize(
    op: EndpointDefinition,
    ctx: RequestContext,
    auth: AuthContext,
    tx: Tx,
  ): Promise<void> {
    if (op.auth.kind !== "permission") return;
    if (auth.scope === "none")
      throw new ApiError("PERMISSION_DENIED", "Choose an organization first.", { reason: "NO_ORGANIZATION" });
    if (auth.permissions.has(op.auth.permission)) return;
    if (op.notFound !== undefined) {
      const read = readPermissionFor(op);
      const canSee = read !== undefined && auth.permissions.has(read);
      if (!canSee || !(await resourceVisible(op, ctx.params, auth, tx, this.catalog)))
        throw notFound(op.notFound);
    }
    throw new ApiError("PERMISSION_DENIED");
  }

  private async requireStepUp(tx: Tx, auth: AuthContext): Promise<void> {
    const since = new Date(Date.now() - STEP_UP_WINDOW_MS);
    if (auth.mfaVerifiedAt !== null && auth.mfaVerifiedAt >= since) return;
    if (auth.sessionCreatedAt >= since) {
      const factors = await tx.userCredential.count({
        where: {
          userId: auth.userId,
          type: { in: ["TOTP", "WEBAUTHN"] },
          confirmedAt: { not: null },
          revokedAt: null,
        },
      });
      if (factors === 0) return;
    }
    throw new ApiError("REAUTHENTICATION_REQUIRED");
  }

  private async auditDenial(op: EndpointDefinition, ctx: RequestContext, error: unknown): Promise<void> {
    if (!op.patientData || !(error instanceof ApiError) || op.auth.kind !== "permission") return;
    const refused =
      error.code === "PERMISSION_DENIED" ||
      (error.status === 404 && ctx.auth !== undefined && !ctx.auth.permissions.has(op.auth.permission));
    if (!refused) return;
    await this.audit.recordDenial(ctx, {
      permission: op.auth.permission,
      patientId: ctx.params.patientId ?? null,
    });
  }

  private shape(
    op: EndpointDefinition,
    ctx: RequestContext,
    reply: FastifyReply,
    result: OperationResult | undefined,
  ): unknown {
    if (ctx.setCookies.length > 0) reply.header("set-cookie", ctx.setCookies);
    if (result?.status !== undefined) reply.status(result.status);
    if (op.response.etag && result?.version !== undefined) reply.header(Header.etag, etagFor(result.version));
    if (op.response.shape === "none") return undefined;
    if (result === undefined) throw new Error(`${op.operationId} returned no result`);
    const body =
      op.response.shape === "collection"
        ? { data: result.data, page: result.page ?? { hasMore: false } }
        : op.response.shape === "resource"
          ? { data: result.data }
          : result.data;
    if (this.config.validateResponses && op.response.schema !== undefined) {
      const items = op.response.shape === "collection" ? (result.data as unknown[]) : [result.data];
      for (const item of items) {
        const check = op.response.schema.safeParse(item);
        if (!check.success) {
          const paths = check.error.issues.map((i) => i.path.join(".")).join(", ");
          throw new Error(`Response of ${op.operationId} breaks its contract at: ${paths}`);
        }
      }
    }
    return body;
  }
}

function fieldError(path: string, message: string): ApiError {
  return new ApiError("VALIDATION_FAILED", undefined, { fieldErrors: [{ path, code: "INVALID", message }] });
}
