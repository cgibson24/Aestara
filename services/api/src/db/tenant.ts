// Runs part of a transaction in another tenant context and restores the
// previous one afterwards, so a request never continues in the wrong tenant.
// Used where one action writes to several organizations' records (revoking a
// user's sessions everywhere, reading a session's organization at sign-in).
import type { Tx } from "./database.ts";

export async function inTenant<T>(tx: Tx, organizationId: string | null, fn: () => Promise<T>): Promise<T> {
  const rows = await tx.$queryRaw<{ current: string | null }[]>`
    SELECT current_setting('app.organization_id', true) AS current`;
  const previous = rows[0]?.current ?? "";
  await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId ?? ""}, true)`;
  // On failure the transaction is aborted and rolls back, so there is nothing to restore.
  const result = await fn();
  await tx.$executeRaw`SELECT set_config('app.organization_id', ${previous}, true)`;
  return result;
}
