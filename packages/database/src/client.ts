import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

/**
 * A Prisma client over node-postgres. Connect the api as a login user that is a
 * member of aestara_app (or aestara_platform for platform routes), never as the
 * migration user or a superuser: Row-Level Security does not apply to a
 * superuser. The tenant-scoped transaction helper arrives with M1.4.
 */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export { Prisma, PrismaClient } from "../generated/prisma/client.ts";
