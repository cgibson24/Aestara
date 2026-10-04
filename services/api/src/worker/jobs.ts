// Scheduled work (ADR-0023 K2-06, K2-07, K2-15). Each job loops over the active
// organizations and runs in each one's tenant transaction:
//   - every minute: retry derivative and registration attempts whose result
//     never arrived;
//   - every hour: expire media permissions past expiresAt;
//   - every day: reconcile the audit table with its WORM copy for the last
//     8 days (offline views can be replayed up to 7 days late), and raise an
//     alert on any difference (spec §7.3 (4)).
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { Inject, Injectable } from "@nestjs/common";
import type { Logger } from "pino";
import { AwsClients } from "../aws/clients.ts";
import { CONFIG, type WorkerConfig } from "../config.ts";
import { Database } from "../db/database.ts";
import { PermissionLedger } from "../photos/permission-ledger.ts";
import { DerivativeJobs } from "./derivatives.ts";
import { ExportJobs } from "./exports.ts";
import { WORKER_LOGGER } from "./logger.ts";
import { RegistrationJobs } from "./registrations.ts";
import { AUDIT_ARCHIVE_PREFIX } from "./relay.ts";
import { systemContext } from "./system-context.ts";
import { WorkerDb } from "./worker-db.ts";

export interface ReconciliationDay {
  readonly day: string;
  /** Audit rows of the day already relayed, by ID. */
  readonly relayed: number;
  readonly archived: number;
  readonly missingFromArchive: number;
  readonly unknownInArchive: number;
}

@Injectable()
export class ScheduledJobs {
  constructor(
    private readonly db: Database,
    private readonly workerDb: WorkerDb,
    private readonly aws: AwsClients,
    private readonly ledger: PermissionLedger,
    private readonly derivatives: DerivativeJobs,
    private readonly registrations: RegistrationJobs,
    private readonly exports: ExportJobs,
    @Inject(CONFIG) private readonly config: Pick<WorkerConfig, "AUDIT_ARCHIVE_BUCKET">,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
  ) {}

  async expirePermissions(now = new Date()): Promise<number> {
    let total = 0;
    for (const organizationId of await this.workerDb.activeOrganizations())
      total += await this.db.tenant(organizationId, (tx) => this.ledger.expireDue(tx, systemContext(), now));
    return total;
  }

  async sweepDerivatives(now = new Date()): Promise<number> {
    let total = 0;
    for (const organizationId of await this.workerDb.activeOrganizations()) {
      total += await this.derivatives.sweepStuck(organizationId, now);
      total += await this.registrations.sweepStuck(organizationId, now);
      total += await this.exports.sweepStuck(organizationId, now);
    }
    return total;
  }

  /** Compares relayed audit rows with the WORM copy, day by day; logs an alert on a difference. */
  async reconcileAudit(days = 8, now = new Date()): Promise<ReconciliationDay[]> {
    const report: ReconciliationDay[] = [];
    for (let back = 0; back < days; back++) {
      const day = new Date(now.getTime() - back * 86_400_000).toISOString().slice(0, 10);
      const start = new Date(`${day}T00:00:00.000Z`);
      const end = new Date(start.getTime() + 86_400_000);
      const relayed = new Set(
        (
          await this.workerDb.client.$queryRaw<{ id: string }[]>`
            SELECT a.id FROM "AuditEvent" a JOIN "OutboxEvent" o ON o.id = a.id
             WHERE a."occurredAt" >= ${start} AND a."occurredAt" < ${end} AND o."publishedAt" IS NOT NULL`
        ).map((r) => r.id),
      );
      const archived = await this.archivedIds(day);
      const missing = [...relayed].filter((id) => !archived.has(id)).length;
      const unknown = [...archived].filter((id) => !relayed.has(id)).length;
      report.push({
        day,
        relayed: relayed.size,
        archived: archived.size,
        missingFromArchive: missing,
        unknownInArchive: unknown,
      });
      if (missing > 0 || unknown > 0)
        this.logger.error(
          { event: "audit_worm_divergence", day, missingFromArchive: missing, unknownInArchive: unknown },
          "the audit table and its WORM copy differ",
        );
    }
    return report;
  }

  private async archivedIds(day: string): Promise<Set<string>> {
    const ids = new Set<string>();
    let token: string | undefined;
    do {
      const page = await this.aws.s3.send(
        new ListObjectsV2Command({
          Bucket: this.config.AUDIT_ARCHIVE_BUCKET,
          Prefix: `${AUDIT_ARCHIVE_PREFIX}/${day.replaceAll("-", "/")}/`,
          ContinuationToken: token,
        }),
      );
      for (const object of page.Contents ?? []) {
        const out = await this.aws.s3.send(
          new GetObjectCommand({ Bucket: this.config.AUDIT_ARCHIVE_BUCKET, Key: object.Key }),
        );
        for (const line of (await out.Body?.transformToString())?.split("\n") ?? [])
          if (line.trim() !== "") ids.add(String((JSON.parse(line) as { id: unknown }).id));
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token !== undefined);
    return ids;
  }
}
