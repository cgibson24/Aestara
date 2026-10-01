// 403 or 404 for a refused request (spec §4.6, §6.1.10): 403 PERMISSION_DENIED
// only when the caller can already see the resource; otherwise the generic
// 404, the same for a resource that does not exist, belongs to another tenant
// or is out of scope. Lookups run inside the request transaction, under the
// tenant policy.
import type { EndpointDefinition } from "@aestara/api-contracts";
import { isOrganizationSettingKey } from "@aestara/api-contracts";
import type { Catalog } from "../auth/catalog.ts";
import type { Tx } from "../db/database.ts";
import type { AuthContext } from "./context.ts";

/** The permission that lets a caller see the resources under a path (spec §6.3 read permissions). */
const READ_PERMISSION: Record<string, string> = {
  patients: "patient.read",
  users: "user.read",
  practices: "practice.read",
  locations: "practice.read",
  organizations: "organization.read",
  roles: "role.read",
  audit: "audit.read",
  settings: "configuration.manage",
};

function segment(op: EndpointDefinition): string {
  return op.path.split("/")[1] ?? "";
}

export function readPermissionFor(op: EndpointDefinition): string | undefined {
  return READ_PERMISSION[segment(op)];
}

/** Whether the path resource exists for this caller. Only called once the read permission is held. */
export async function resourceVisible(
  op: EndpointDefinition,
  params: Record<string, string>,
  auth: AuthContext,
  tx: Tx,
  catalog: Catalog,
): Promise<boolean> {
  const id = params.id ?? "";
  switch (segment(op)) {
    case "patients":
      if (params.contactId !== undefined)
        return (
          (await tx.patientContact.count({
            where: { id: params.contactId, patientId: params.patientId ?? "" },
          })) > 0
        );
      return (await tx.patient.count({ where: { id: params.patientId ?? "" } })) > 0;
    case "users":
      if (auth.scope === "platform") return (await tx.user.count({ where: { id, kind: "WORKFORCE" } })) > 0;
      return (await tx.membership.count({ where: { userId: id } })) > 0;
    case "practices":
      return (await tx.practice.count({ where: { id } })) > 0;
    case "locations":
      return (await tx.location.count({ where: { id } })) > 0;
    case "organizations":
      return (await tx.organization.count({ where: { id } })) > 0;
    case "roles":
      return catalog.role(id) !== undefined;
    case "audit":
      return (await tx.auditEvent.count({ where: { id } })) > 0;
    case "settings":
      return isOrganizationSettingKey(params.key ?? "");
    default:
      return false;
  }
}
