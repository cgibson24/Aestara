// Malware scan results (spec §2.1; Bible §13.4, §14.4; ADR-0023 K2-04, K2-05).
// In AWS, GuardDuty Malware Protection for S3 scans each new object in the
// clinical-media bucket and publishes a result event; an EventBridge rule sends
// it to the scan-results queue. Locally and in CI, the local scanner below
// stands in for GuardDuty and sends the same event shape to the same queue.
// A result can arrive before the upload is completed; then it is only
// recorded, and completion applies it (photos.service completeUpload).
import { SendMessageCommand } from "@aws-sdk/client-sqs";
import { Inject, Injectable } from "@nestjs/common";
import type { Logger } from "pino";
import { lockRow } from "../common/concurrency.ts";
import { AwsClients } from "../aws/clients.ts";
import { CONFIG, type WorkerConfig } from "../config.ts";
import { Database } from "../db/database.ts";
import { ObjectStore } from "../media/object-store.ts";
import { PhotoIntake, type ScanOutcome } from "../photos/intake.ts";
import { WORKER_LOGGER } from "./logger.ts";
import { systemContext } from "./system-context.ts";
import { WorkerDb } from "./worker-db.ts";

export const SCAN_RESULT_DETAIL_TYPE = "GuardDuty Malware Protection Object Scan Result";

/** GuardDuty's result, reduced to what the ledger records. */
export function outcomeOf(detail: {
  scanStatus?: string;
  scanResultDetails?: { scanResultStatus?: string };
}): ScanOutcome {
  if (detail.scanStatus === "COMPLETED" && detail.scanResultDetails?.scanResultStatus === "NO_THREATS_FOUND") return "CLEAN";
  if (detail.scanResultDetails?.scanResultStatus === "THREATS_FOUND") return "INFECTED";
  // UNSUPPORTED, ACCESS_DENIED, FAILED or a skipped scan: never served (K2-04).
  return "ERROR";
}

type ScanEvent = {
  "detail-type"?: string;
  detail?: {
    scanStatus?: string;
    resourceType?: string;
    s3ObjectDetails?: { bucketName?: string; objectKey?: string };
    scanResultDetails?: { scanResultStatus?: string };
  };
};

@Injectable()
export class ScanResults {
  constructor(
    private readonly db: Database,
    private readonly workerDb: WorkerDb,
    private readonly intake: PhotoIntake,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
  ) {}

  async handle(raw: unknown): Promise<void> {
    const event = raw as ScanEvent;
    if (event?.["detail-type"] !== SCAN_RESULT_DETAIL_TYPE) return;
    const bucket = event.detail?.s3ObjectDetails?.bucketName;
    const key = event.detail?.s3ObjectDetails?.objectKey;
    if (bucket === undefined || key === undefined) return;
    const outcome = outcomeOf(event.detail ?? {});
    const target = await this.workerDb.organizationOfObject(bucket, key);
    // Not an object the ledger knows (it may belong to another environment's test): ignore.
    if (target === undefined) return;
    await this.db.tenant(target.organizationId, async (tx) => {
      await lockRow(tx, "StorageObject", target.id);
      const object = await tx.storageObject.findUniqueOrThrow({ where: { id: target.id } });
      // The first result counts; a repeat or a late duplicate changes nothing.
      if (object.scanStatus !== "PENDING") return;
      await tx.storageObject.update({
        where: { id: object.id },
        data: { scanStatus: outcome === "CLEAN" ? "CLEAN" : outcome === "INFECTED" ? "INFECTED" : "ERROR" },
      });
      if (object.verifiedAt === null) return;
      const photo = await tx.patientPhoto.findFirst({ where: { originalObjectId: object.id } });
      if (photo === null || photo.status !== "QUARANTINED") return;
      await this.intake.apply(tx, systemContext(), photo, outcome, this.logger);
    });
  }
}

/** The standard EICAR test string: the only thing the local scanner reports as malware. */
export const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const MAX_SCAN_BYTES = 64 * 1024 * 1024;

/**
 * Local and CI stand-in for GuardDuty (K2-04): reads each new original from the
 * S3 notification queue and reports EICAR as infected, everything else as
 * clean. Configuration refuses it in production (NODE_ENV=production).
 */
@Injectable()
export class LocalScanner {
  constructor(
    private readonly aws: AwsClients,
    private readonly store: ObjectStore,
    @Inject(CONFIG) private readonly config: Pick<WorkerConfig, "SCAN_RESULTS_QUEUE_URL" | "MALWARE_SCANNER" | "NODE_ENV">,
  ) {
    if (config.NODE_ENV === "production") throw new Error("The local scanner never runs in production");
  }

  async handle(raw: unknown): Promise<void> {
    const records = (raw as { Records?: { s3?: { bucket?: { name?: string }; object?: { key?: string } } }[] })?.Records;
    for (const record of records ?? []) {
      const bucket = record.s3?.bucket?.name;
      const encoded = record.s3?.object?.key;
      if (bucket === undefined || encoded === undefined || bucket !== this.store.bucket) continue;
      const key = decodeURIComponent(encoded.replaceAll("+", " "));
      let status: "NO_THREATS_FOUND" | "THREATS_FOUND" | "FAILED";
      try {
        const bytes = await this.store.read(key, MAX_SCAN_BYTES);
        status = bytes.includes(Buffer.from(EICAR)) ? "THREATS_FOUND" : "NO_THREATS_FOUND";
      } catch {
        status = "FAILED";
      }
      const event = {
        source: "aestara.local-scanner",
        "detail-type": SCAN_RESULT_DETAIL_TYPE,
        detail: {
          schemaVersion: "1.0",
          scanStatus: status === "FAILED" ? "FAILED" : "COMPLETED",
          resourceType: "S3_OBJECT",
          s3ObjectDetails: { bucketName: bucket, objectKey: key },
          scanResultDetails: { scanResultStatus: status, threats: null },
        },
      };
      await this.aws.sqs.send(
        new SendMessageCommand({ QueueUrl: this.config.SCAN_RESULTS_QUEUE_URL, MessageBody: JSON.stringify(event) }),
      );
    }
  }
}
