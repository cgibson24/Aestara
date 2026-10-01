// Liveness and readiness probes (spec §6.1.10): unauthenticated, no data and no
// dependency details.
import { Controller } from "@nestjs/common";
import { ApiError } from "../common/errors.ts";
import { Operation, type OperationResult } from "../common/operation.ts";
import { Database } from "../db/database.ts";

@Controller()
export class HealthController {
  constructor(private readonly db: Database) {}

  @Operation("getLiveness")
  live(): OperationResult {
    return { data: { status: "ok" } };
  }

  @Operation("getReadiness")
  async ready(): Promise<OperationResult> {
    if (!(await this.db.ping()))
      throw new ApiError("SERVICE_UNAVAILABLE", undefined, undefined, { "Retry-After": "5" });
    return { data: { status: "ok" } };
  }
}
