// 403 or 404 for a refused request (spec §4.6, §6.1.10): 403 PERMISSION_DENIED
// only when the caller can already see the resource; otherwise the generic
// 404, the same for a resource that does not exist, belongs to another tenant
// or is out of scope. Lookups run inside the request transaction, under the
// tenant policy.
import type { EndpointDefinition } from "@aestara/api-contracts";
import { isFeatureFlagKey, isOrganizationSettingKey, isPracticeSettingKey } from "@aestara/api-contracts";
import type { Catalog } from "../auth/catalog.ts";
import type { Tx } from "../db/database.ts";
import type { AuthContext } from "./context.ts";

/** The permissions that let a caller see the resources under a path (spec §6.3 read permissions). */
const READ_PERMISSION: Record<string, readonly string[]> = {
  patients: ["patient.read"],
  users: ["user.read"],
  practices: ["practice.read"],
  locations: ["practice.read"],
  organizations: ["organization.read"],
  roles: ["role.read"],
  audit: ["audit.read"],
  settings: ["configuration.manage"],
  "feature-flags": ["configuration.manage"],
  "photography-protocols": ["photo.view", "photo.capture", "practice.manage"],
};

/**
 * A patient's photo, session or release is seen with photo permissions, not
 * patient.read. The collections themselves hang off a visible patient, so a
 * caller who can see the patient but lacks the permission gets 403.
 */
const PATIENT_SUBRESOURCE_READ: Record<string, readonly string[]> = {
  "photo-sessions": ["photo.view"],
  photos: ["photo.view"],
  "photo-permissions": ["photo.permission.read"],
  "media-releases": ["photo.view"],
  consultations: ["consultation.create"],
};

function segment(op: EndpointDefinition): string {
  return op.path.split("/")[1] ?? "";
}

export function readPermissionsFor(op: EndpointDefinition): readonly string[] {
  if (segment(op) === "patients" && /\{(photoId|sessionId|releaseId|consultationId)\}/.test(op.path)) {
    const sub = op.path.split("/")[3];
    if (sub !== undefined && PATIENT_SUBRESOURCE_READ[sub] !== undefined)
      return PATIENT_SUBRESOURCE_READ[sub];
  }
  return READ_PERMISSION[segment(op)] ?? [];
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
      if (params.photoId !== undefined)
        return (
          (await tx.patientPhoto.count({
            where: {
              id: params.photoId,
              patientId: params.patientId ?? "",
              status: { not: "UPLOAD_PENDING" },
            },
          })) > 0
        );
      if (params.sessionId !== undefined)
        return (
          (await tx.photoSession.count({
            where: { id: params.sessionId, patientId: params.patientId ?? "" },
          })) > 0
        );
      if (params.consultationId !== undefined)
        return (
          (await tx.consultation.count({
            where: { id: params.consultationId, patientId: params.patientId ?? "" },
          })) > 0
        );
      if (params.releaseId !== undefined)
        return (
          (await tx.mediaRelease.count({
            where: { id: params.releaseId, patientId: params.patientId ?? "" },
          })) > 0
        );
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
      if (params.practiceId !== undefined)
        return (
          isPracticeSettingKey(params.key ?? "") &&
          (await tx.practice.count({ where: { id: params.practiceId } })) > 0
        );
      return isOrganizationSettingKey(params.key ?? "");
    case "feature-flags":
      return isFeatureFlagKey(params.key ?? "");
    case "photography-protocols":
      return (await tx.photographyProtocol.count({ where: { id } })) > 0;
    default:
      return false;
  }
}
