// Audit event query (spec §6.3 "/audit/events", §7.3; Bible §22). Events are
// tenant-scoped; the platform scope reads only platform-level events (no
// organization), never patient activity (spec §4.5 note 4).
import { ActorType, AuditAction as AuditActionValues, AuditOutcome } from "@aestara/shared-types";
import { PageQuery } from "./pagination.ts";
import { Timestamp, Uuid } from "./primitives.ts";
import { z } from "./zod.ts";

export const AuditAction = z.enum(AuditActionValues).meta({ id: "AuditAction" });

export const AuditEvent = z
  .strictObject({
    id: Uuid,
    occurredAt: Timestamp,
    action: AuditAction,
    outcome: z.enum(AuditOutcome),
    actorType: z.enum(ActorType),
    actorUserId: Uuid.optional(),
    actorServiceId: z.string().optional(),
    resourceType: z.string(),
    resourceId: Uuid.optional(),
    patientId: Uuid.optional(),
    requestId: z.string(),
    sessionId: Uuid.optional(),
    deviceId: Uuid.optional(),
    ipAddress: z.string().optional(),
    userAgent: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional().meta({
      description: "Identifiers, codes and counts only; never PHI.",
    }),
  })
  .meta({ id: "AuditEvent" });

export const AuditEventQuery = PageQuery.extend({
  actorUserId: Uuid.optional(),
  patientId: Uuid.optional().meta({
    description: "Per-patient access report: every event about this patient.",
  }),
  action: AuditAction.optional(),
  resourceType: z
    .string()
    .regex(/^[A-Za-z]{1,64}$/)
    .optional(),
  resourceId: Uuid.optional(),
  from: Timestamp.optional().meta({ description: "Inclusive." }),
  to: Timestamp.optional().meta({ description: "Exclusive." }),
});
