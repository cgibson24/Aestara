// The worker's cross-tenant connection (aestara_worker; ADR-0023 K2-07): it can
// relay the outbox, read audit rows for the WORM copy, list organizations and
// resolve an opaque storage key or job ID to its organization, and nothing
// else. All other work runs as aestara_app inside the organization's tenant.
import { createPrismaClient, type PrismaClient } from "@aestara/database";
import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { CONFIG, type WorkerConfig } from "../config.ts";

@Injectable()
export class WorkerDb implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(CONFIG) config: Pick<WorkerConfig, "WORKER_DATABASE_URL">) {
    this.client = createPrismaClient(config.WORKER_DATABASE_URL, { poolSize: 4 });
  }

  /** The organization an opaque object key belongs to; undefined when no ledger row has it. */
  async organizationOfObject(
    bucket: string,
    objectKey: string,
  ): Promise<{ organizationId: string; id: string } | undefined> {
    const rows = await this.client.$queryRaw<{ id: string; organizationId: string }[]>`
      SELECT id, "organizationId" FROM "StorageObject" WHERE "objectKey" = ${objectKey} AND bucket = ${bucket}`;
    return rows[0];
  }

  async organizationOfJob(jobId: string): Promise<string | undefined> {
    const rows = await this.client.$queryRaw<{ organizationId: string }[]>`
      SELECT "organizationId" FROM "AIJob" WHERE id = ${jobId}::uuid`;
    return rows[0]?.organizationId;
  }

  async activeOrganizations(): Promise<string[]> {
    const rows = await this.client.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Organization" WHERE status = 'ACTIVE'`;
    return rows.map((r) => r.id);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
