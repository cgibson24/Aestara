// What happens to a verified original once its malware scan is known (spec
// §5.4.10; ADR-0023 K2-04 to K2-06). Shared by the api (when the scan result
// arrived before the upload was completed) and the worker (when it arrives
// after). Both run inside the photo's tenant transaction.
//   clean              QUARANTINED → ACCEPTED; the object is AVAILABLE; a
//                      derivative job is queued
//   infected or failed QUARANTINED → REJECTED; the object is REJECTED and never
//                      served; PHOTO_REJECTED and a security log line
import { uuidv7 } from "@aestara/database";
import { Injectable } from "@nestjs/common";
import type { Logger } from "pino";
import { AuditWriter } from "../audit/audit-writer.ts";
import type { RequestContext } from "../common/context.ts";
import type { Tx } from "../db/database.ts";
import { Outbox } from "../outbox/outbox.ts";

export type ScanOutcome = "CLEAN" | "INFECTED" | "ERROR";

export interface QuarantinedPhoto {
  readonly id: string;
  readonly organizationId: string;
  readonly patientId: string;
  readonly originalObjectId: string;
  readonly source: "PROVIDER_CAPTURE" | "PATIENT_UPLOAD" | "IMPORT";
}

/** The derivative job's idempotency key: one job per photo, retries are attempts of it. */
export const derivativeJobKey = (photoId: string) => `derivatives:${photoId}`;

@Injectable()
export class PhotoIntake {
  constructor(
    private readonly audit: AuditWriter,
    private readonly outbox: Outbox,
  ) {}

  /** Applies a known scan outcome to a photo that is QUARANTINED. */
  async apply(
    tx: Tx,
    ctx: RequestContext,
    photo: QuarantinedPhoto,
    outcome: ScanOutcome,
    logger?: Logger,
  ): Promise<"ACCEPTED" | "PENDING_REVIEW" | "REJECTED"> {
    if (outcome === "CLEAN") {
      // Patient uploads wait for staff review (Layer 5); staff captures are accepted.
      const status = photo.source === "PATIENT_UPLOAD" ? "PENDING_REVIEW" : "ACCEPTED";
      await tx.storageObject.update({
        where: { id: photo.originalObjectId },
        data: { status: "AVAILABLE", scanStatus: "CLEAN" },
      });
      await tx.patientPhoto.update({ where: { id: photo.id }, data: { status } });
      if (status === "ACCEPTED") await this.queueDerivatives(tx, photo);
      return status;
    }
    await tx.storageObject.update({
      where: { id: photo.originalObjectId },
      data: { status: "REJECTED", scanStatus: outcome === "INFECTED" ? "INFECTED" : "ERROR" },
    });
    await tx.patientPhoto.update({ where: { id: photo.id }, data: { status: "REJECTED" } });
    const reason = outcome === "INFECTED" ? "MALWARE_DETECTED" : "SCAN_FAILED";
    await this.audit.write(tx, ctx, {
      action: "PHOTO_REJECTED",
      outcome: "FAILURE",
      resourceType: "PatientPhoto",
      resourceId: photo.id,
      patientId: photo.patientId,
      organizationId: photo.organizationId,
      actorUserId: null,
      metadata: { reason },
    });
    // A security event (Bible §26): identifiers and the reason only.
    logger?.warn(
      { event: "photo_rejected", photoId: photo.id, reason },
      "upload rejected by the malware scan",
    );
    return "REJECTED";
  }

  /** One IMAGE_DERIVATIVE job per photo, dispatched by the worker (K2-06). */
  async queueDerivatives(tx: Tx, photo: QuarantinedPhoto): Promise<string> {
    const jobId = uuidv7();
    await tx.aIJob.create({
      data: {
        id: jobId,
        organizationId: photo.organizationId,
        patientId: photo.patientId,
        jobType: "IMAGE_DERIVATIVE",
        status: "QUEUED",
        idempotencyKey: derivativeJobKey(photo.id),
        inputSummary: { photoId: photo.id },
      },
    });
    await this.outbox.add(tx, {
      organizationId: photo.organizationId,
      eventType: "image.derivative.requested",
      aggregateId: jobId,
      payload: { jobId, photoId: photo.id, attempt: 1 },
    });
    return jobId;
  }
}
