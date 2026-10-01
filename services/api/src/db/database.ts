// Database access (spec §3.5; ADR-0004; ADR-0021 "Tenant transactions").
// Two connection pools: the application role, subject to Row-Level Security,
// and the platform role for platform routes. Every tenant request runs in one
// interactive transaction whose first statement sets the tenant with
// set_config(…, true), so the setting ends with the transaction and cannot leak
// through a pooled connection.
import { createPrismaClient, type Prisma, type PrismaClient } from "@aestara/database";
import { Inject, Injectable, type OnModuleDestroy } from "@nestjs/common";
import { CONFIG, type Config } from "../config.ts";

export type Tx = Prisma.TransactionClient;

const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

@Injectable()
export class Database implements OnModuleDestroy {
  readonly app: PrismaClient;
  readonly platform: PrismaClient;

  constructor(@Inject(CONFIG) config: Config) {
    this.app = createPrismaClient(config.DATABASE_URL, { poolSize: config.DATABASE_POOL_SIZE });
    this.platform = createPrismaClient(config.PLATFORM_DATABASE_URL, {
      poolSize: Math.max(2, Math.floor(config.DATABASE_POOL_SIZE / 4)),
    });
  }

  /** A transaction in one organization: every tenant table shows only its rows. */
  tenant<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  /**
   * A transaction with no tenant: identity tables (users, credentials, sessions,
   * tokens, the login ledger) only. Every tenant table returns no rows.
   */
  identity<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.app.$transaction(fn, TX_OPTIONS);
  }

  /** A transaction on the platform role: organization metadata across tenants, never patient data. */
  platformTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.platform.$transaction(fn, TX_OPTIONS);
  }

  async ping(): Promise<boolean> {
    try {
      await this.app.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.app.$disconnect(), this.platform.$disconnect()]);
  }
}
