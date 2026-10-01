// Pure media-permission rules (spec §5.4.5; ADR-0023 K2-15): the state a row
// stands for now, and which current row governs a photo.
import type { MediaPermissionCategory } from "@aestara/api-contracts";
import type { z } from "zod";

export type Category = z.output<typeof MediaPermissionCategory>;
export type State = "NOT_REQUESTED" | "REQUESTED" | "GRANTED" | "DECLINED" | "REVOKED" | "EXPIRED";

export type PermissionRow = {
  id: string;
  organizationId: string;
  patientId: string;
  category: Category;
  scope: "PATIENT_WIDE" | "PHOTO_SESSION" | "PHOTO";
  photoSessionId: string | null;
  photoId: string | null;
  state: State;
  versionNumber: number;
  effectiveAt: Date;
  expiresAt: Date | null;
  evidence: "SIGNED_CONSENT" | "PATIENT_APP_ACTION" | "STAFF_ATTESTATION" | "INTEGRATION_IMPORT" | null;
  reason: string | null;
  recordedById: string | null;
  createdAt: Date;
  supersededAt: Date | null;
};

/** Spec §5.4.5. NOT_REQUESTED → GRANTED needs SIGNED_CONSENT evidence, which arrives in Layer 4. */
export const TRANSITIONS: Record<State, readonly State[]> = {
  NOT_REQUESTED: ["REQUESTED"],
  REQUESTED: ["GRANTED", "DECLINED"],
  GRANTED: ["REVOKED"],
  DECLINED: ["REQUESTED"],
  REVOKED: ["REQUESTED"],
  EXPIRED: ["REQUESTED"],
};

/** Evidence that exists in Layer 2 (K2-15): signed consents arrive in Layer 4, patient-app actions in Layer 5. */
export const LAYER_2_EVIDENCE = new Set(["STAFF_ATTESTATION"]);

/** The state a row stands for now: a grant past its expiry is EXPIRED even before the job writes it. */
export function stateAt(row: Pick<PermissionRow, "state" | "expiresAt"> | undefined, now: Date): State {
  if (row === undefined) return "NOT_REQUESTED";
  if (row.state === "GRANTED" && row.expiresAt !== null && row.expiresAt <= now) return "EXPIRED";
  return row.state;
}

/** The current row that governs one photo for one category: photo, then session, then patient-wide. */
export function governing<T extends Pick<PermissionRow, "scope" | "photoId" | "photoSessionId">>(
  rows: readonly T[],
  photo: { id: string; photoSessionId: string | null },
): T | undefined {
  return (
    rows.find((r) => r.scope === "PHOTO" && r.photoId === photo.id) ??
    rows.find(
      (r) =>
        r.scope === "PHOTO_SESSION" &&
        photo.photoSessionId !== null &&
        r.photoSessionId === photo.photoSessionId,
    ) ??
    rows.find((r) => r.scope === "PATIENT_WIDE")
  );
}
