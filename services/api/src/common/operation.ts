// Binds a controller method to its entry in the endpoint registry
// (packages/api-contracts/src/endpoints.ts): method, path and success status
// come from the registry, so the routes cannot drift from the contract.
import { endpoint, type OperationId, routePath } from "@aestara/api-contracts";
import {
  applyDecorators,
  createParamDecorator,
  Delete,
  type ExecutionContext,
  Get,
  HttpCode,
  Patch,
  Post,
  Put,
  SetMetadata,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { RequestContext } from "./context.ts";

export const OPERATION_KEY = "aestara:operation";

/** Operation IDs bound by a decorator; checked against the registry at start-up. */
export const BOUND_OPERATIONS = new Map<string, number>();

const METHOD = { GET: Get, POST: Post, PUT: Put, PATCH: Patch, DELETE: Delete } as const;

export function Operation(operationId: OperationId): MethodDecorator {
  const e = endpoint(operationId);
  BOUND_OPERATIONS.set(operationId, (BOUND_OPERATIONS.get(operationId) ?? 0) + 1);
  return applyDecorators(
    SetMetadata(OPERATION_KEY, e),
    METHOD[e.method](routePath(e.path)),
    HttpCode(e.response.status),
  );
}

/** The request context of the current request. */
export const Ctx = createParamDecorator(
  (_: unknown, exec: ExecutionContext): RequestContext =>
    exec.switchToHttp().getRequest<FastifyRequest>().ctx,
);

export interface OperationResult {
  /** The resource, the collection items, or the bare body. */
  readonly data?: unknown;
  readonly page?: { hasMore: boolean; nextCursor?: string };
  /** Sets `ETag: "v{version}"` on operations that declare one. */
  readonly version?: number;
  /** What an idempotent create made, for replays (spec §6.1.8). */
  readonly resource?: { readonly type: string; readonly id: string };
  /** Overrides the registry's status (replays). */
  readonly status?: number;
  readonly replayed?: boolean;
}
