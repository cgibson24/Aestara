// What happens to a verified document version once its malware scan is known
// (ADR-0023 K2-04; ADR-0026 K3-16; ADR-0027). Shared by the api (the result
// arrived before completion) and the worker (it arrives after); both run in
// the document's tenant transaction.
//   clean              the object is AVAILABLE: the version can be downloaded
//   infected or failed the object is REJECTED and never served; the version
//                      stays in the history (the worker logs the security
//                      event when it records the result, worker/scans.ts)
import { Injectable } from "@nestjs/common";
import type { Tx } from "../db/database.ts";
import type { ScanOutcome } from "../photos/intake.ts";

@Injectable()
export class DocumentIntake {
  /** Applies a known scan outcome to a document version's QUARANTINED object. */
  async apply(tx: Tx, storageObjectId: string, outcome: ScanOutcome): Promise<void> {
    await tx.storageObject.update({
      where: { id: storageObjectId },
      data:
        outcome === "CLEAN"
          ? { status: "AVAILABLE", scanStatus: "CLEAN" }
          : { status: "REJECTED", scanStatus: outcome === "INFECTED" ? "INFECTED" : "ERROR" },
    });
  }
}
