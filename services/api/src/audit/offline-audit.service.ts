// Offline view replay (spec §8 rule 8, §6.3 "/audit/offline-events"; ADR-0023
// K2-17). Views of cached patients and photos made offline are recorded on the
// device with a UUIDv7 and their time, and replayed first on reconnect. The
// device's ID becomes the audit event's ID, so a replay is recognised and never
// recorded twice. A caller replays only its own views, of records it may read.
import type { OfflineAuditBatch } from "@aestara/api-contracts";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { z } from "zod";
import { type RequestContext, requireAuth, requireOrganization, requireTx } from "../common/context.ts";
import { ApiError } from "../common/errors.ts";
import { Idempotency } from "../common/idempotency.ts";
import type { OperationResult } from "../common/operation.ts";
import { AuditWriter } from "./audit-writer.ts";

/** Offline use ends with the session's absolute lifetime, at most 7 days (K2-17). */
const MAX_AGE_MS = 7 * 24 * 60 * 60_000 + 60 * 60_000;
const SKEW_MS = 5 * 60_000;

function invalid(path: string, code: string, message: string): ApiError {
  return new ApiError("VALIDATION_FAILED", undefined, { fieldErrors: [{ path, code, message }] });
}

@Injectable()
export class OfflineAuditService implements OnModuleInit {
  constructor(
    private readonly audit: AuditWriter,
    private readonly idempotency: Idempotency,
  ) {}

  onModuleInit(): void {
    this.idempotency.register("recordOfflineAuditEvents", async (ctx, id) => {
      const body = ctx.body as z.output<typeof OfflineAuditBatch>;
      return {
        data: { recorded: 0, alreadyRecorded: body.events.length },
        resource: { type: "AuditEvent", id },
      };
    });
  }

  async replay(ctx: RequestContext, body: z.output<typeof OfflineAuditBatch>): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const auth = requireAuth(ctx);
    requireOrganization(ctx);
    const now = Date.now();
    const needs = new Set(
      body.events.map((e) => (e.action === "PATIENT_VIEWED" ? "patient.read" : "photo.view")),
    );
    for (const permission of needs)
      if (!auth.permissions.has(permission))
        throw new ApiError("PERMISSION_DENIED", `Replaying these views needs the ${permission} permission.`);
    body.events.forEach((e, i) => {
      const at = new Date(e.occurredAt).getTime();
      if (at > now + SKEW_MS || at < now - MAX_AGE_MS)
        throw invalid(`events.${i}.occurredAt`, "OUT_OF_RANGE", "Offline views are replayed within 7 days.");
      if (at < auth.sessionCreatedAt.getTime() - MAX_AGE_MS)
        throw invalid(`events.${i}.occurredAt`, "OUT_OF_RANGE", "The view predates this device's sign-in.");
    });
    const patientIds = [...new Set(body.events.map((e) => e.patientId))];
    const known = new Set(
      (await tx.patient.findMany({ where: { id: { in: patientIds } }, select: { id: true } })).map(
        (p) => p.id,
      ),
    );
    const photoIds = [...new Set(body.events.flatMap((e) => (e.photoId ? [e.photoId] : [])))];
    const photos = new Map(
      (
        await tx.patientPhoto.findMany({
          where: { id: { in: photoIds } },
          select: { id: true, patientId: true },
        })
      ).map((p) => [p.id, p.patientId]),
    );
    body.events.forEach((e, i) => {
      if (!known.has(e.patientId))
        throw invalid(`events.${i}.patientId`, "UNKNOWN_PATIENT", "Unknown patient.");
      if (e.photoId !== undefined && photos.get(e.photoId) !== e.patientId)
        throw invalid(`events.${i}.photoId`, "UNKNOWN_PHOTO", "Unknown photo of this patient.");
    });
    const recorded = await this.audit.writeOnce(
      tx,
      ctx,
      body.events.map((e) => ({
        id: e.id,
        occurredAt: new Date(e.occurredAt),
        action: e.action,
        resourceType: e.action === "PATIENT_VIEWED" ? "Patient" : "PatientPhoto",
        resourceId: e.photoId ?? e.patientId,
        patientId: e.patientId,
        metadata: { offline: true, ...(e.variant ? { variant: e.variant } : {}) },
      })),
    );
    return {
      data: { recorded, alreadyRecorded: body.events.length - recorded },
      resource: { type: "AuditEvent", id: body.events[0]?.id ?? "" },
    };
  }
}
