import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

/**
 * A Prisma client over node-postgres. Connect the api as a login user that is a
 * member of aestara_app (or aestara_platform for platform routes), never as the
 * migration user or a superuser: Row-Level Security does not apply to a
 * superuser. The api sets the tenant at the start of each request transaction
 * (services/api/src/db/database.ts).
 */
export function createPrismaClient(
  connectionString: string,
  options: { poolSize?: number } = {},
): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, ...(options.poolSize ? { max: options.poolSize } : {}) }),
  });
}

export { Prisma, PrismaClient } from "../generated/prisma/client.ts";
