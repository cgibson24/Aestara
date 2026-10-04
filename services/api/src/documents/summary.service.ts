// Generating the consultation summary (spec §6.3 `POST …/{cid}/summary`;
// Bible §5.1; ADR-0026 K3-17, K3-20; ADR-0027). In READY_FOR_REVIEW, or after
// an addendum to a completed consultation, the api renders the PDF and adds it
// as the next version of the consultation's one CONSULTATION_SUMMARY document.
// The file is written once, by the platform, and is not scanned (K2-04 scans
// uploads). Generations are serialized by a lock on the consultation.
import { createHash } from "node:crypto";
import { uuidv7 } from "@aestara/database";
import { Injectable, type OnModuleInit } from "@nestjs/common";
import { AuditWriter } from "../audit/audit-writer.ts";
import { lockRow } from "../common/concurrency.ts";
import { type RequestContext, requireAuth, requireOrganization, requireTx } from "../common/context.ts";
import { ApiError } from "../common/errors.ts";
import { Idempotency } from "../common/idempotency.ts";
import type { OperationResult } from "../common/operation.ts";
import { ConsultationsService } from "../consultations/consultations.service.ts";
import type { Tx } from "../db/database.ts";
import { ObjectStore } from "../media/object-store.ts";
import { DOCUMENT_INCLUDE, type DocumentRow, DocumentsService, documentDto } from "./documents.service.ts";
import { renderSummary, type SummaryContent, type SummaryNote } from "./summary.ts";

const SUMMARY_TITLE = "Consultation summary";

@Injectable()
export class SummaryService implements OnModuleInit {
  constructor(
    private readonly audit: AuditWriter,
    private readonly consultations: ConsultationsService,
    private readonly documents: DocumentsService,
    private readonly idempotency: Idempotency,
    private readonly store: ObjectStore,
  ) {}

  onModuleInit(): void {
    this.idempotency.register("generateConsultationSummary", async (ctx, id) => ({
      data: documentDto(await this.documents.document(requireTx(ctx), ctx.params.patientId ?? "", id)),
      resource: { type: "Document", id },
    }));
  }

  /** Staff names as the record shows them: provider, then staff profile, then account name. */
  private async names(tx: Tx, userIds: readonly string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    const [providers, staff, users] = await Promise.all([
      tx.providerProfile.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, displayName: true, credentials: true },
      }),
      tx.staffProfile.findMany({
        where: { userId: { in: ids } },
        select: { userId: true, displayName: true },
      }),
      tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } }),
    ]);
    const names = new Map<string, string>();
    for (const u of users) if (u.displayName) names.set(u.id, u.displayName);
    for (const s of staff) names.set(s.userId, s.displayName);
    for (const p of providers)
      names.set(p.userId, p.credentials ? `${p.displayName}, ${p.credentials}` : p.displayName);
    return names;
  }

  async generate(ctx: RequestContext, patientId: string, consultationId: string): Promise<OperationResult> {
    const tx = requireTx(ctx);
    const organizationId = requireOrganization(ctx);
    const userId = requireAuth(ctx).userId;
    await lockRow(tx, "Consultation", consultationId);
    const c = await this.consultations.consultation(tx, patientId, consultationId);
    this.consultations.requireScope(ctx, "consultation.edit", c.practiceId, c.locationId);
    const existing = (await tx.document.findFirst({
      where: { consultationId, type: "CONSULTATION_SUMMARY" },
      include: DOCUMENT_INCLUDE,
    })) as DocumentRow | null;
    const latest = existing?.versions[0];
    if (c.status === "COMPLETED") {
      const addenda = await tx.consultationNote.count({
        where: {
          consultationId,
          status: "FINAL",
          correctsNoteId: { not: null },
          ...(latest !== undefined ? { finalizedAt: { gt: latest.createdAt } } : {}),
        },
      });
      if (addenda === 0)
        throw new ApiError(
          "INVALID_STATE_TRANSITION",
          "A completed consultation's summary is generated again only after a new addendum.",
        );
    } else if (c.status !== "READY_FOR_REVIEW")
      throw new ApiError(
        "INVALID_STATE_TRANSITION",
        "The summary is generated once the consultation is submitted for review.",
      );

    const versionNumber = (latest?.versionNumber ?? 0) + 1;
    const pdf = await renderSummary(await this.content(tx, c, versionNumber));
    const sha256 = createHash("sha256").update(pdf).digest("hex");
    const documentId = existing?.id ?? uuidv7();
    if (existing === null)
      await tx.document.create({
        data: {
          id: documentId,
          organizationId,
          patientId,
          type: "CONSULTATION_SUMMARY",
          title: SUMMARY_TITLE,
          consultationId,
          createdById: userId,
        },
      });
    const objectId = uuidv7();
    const objectKey = this.store.newKey("DOCUMENT");
    await tx.storageObject.create({
      data: {
        id: objectId,
        organizationId,
        objectClass: "DOCUMENT",
        bucket: this.store.bucket,
        objectKey,
        contentType: "application/pdf",
        byteSize: BigInt(pdf.length),
        sha256,
        status: "AVAILABLE",
        // Generated by the platform, not uploaded: nothing to scan (K3-17).
        scanStatus: "NOT_REQUIRED",
        kmsKeyAlias: this.store.kmsKeyId,
        uploadedById: userId,
        verifiedAt: new Date(),
      },
    });
    await tx.documentVersion.create({
      data: {
        id: uuidv7(),
        organizationId,
        patientId,
        documentId,
        versionNumber,
        storageObjectId: objectId,
        sha256,
        createdById: userId,
      },
    });
    await tx.document.update({ where: { id: documentId }, data: { updatedAt: new Date() } });
    await this.audit.write(tx, ctx, {
      action: "DOCUMENT_ADDED",
      resourceType: "Document",
      resourceId: documentId,
      patientId,
      metadata: { type: "CONSULTATION_SUMMARY", versionNumber, generated: true, consultationId },
    });
    // Last, so a failed write rolls the version back; a commit that fails after it leaves an unreferenced file.
    await this.store.writeNew(objectKey, pdf, "application/pdf");
    return {
      data: documentDto(await this.documents.document(tx, patientId, documentId)),
      resource: { type: "Document", id: documentId },
    };
  }

  private async content(
    tx: Tx,
    c: Awaited<ReturnType<ConsultationsService["consultation"]>>,
    versionNumber: number,
  ): Promise<SummaryContent> {
    const [practice, patient, concerns, notes, sessions] = await Promise.all([
      tx.practice.findUniqueOrThrow({ where: { id: c.practiceId }, select: { name: true, timezone: true } }),
      tx.patient.findUniqueOrThrow({
        where: { id: c.patientId },
        select: { firstName: true, middleName: true, lastName: true, dateOfBirth: true, mrn: true },
      }),
      tx.patientConcern.findMany({
        where: { id: { in: c.concerns.map((x) => x.patientConcernId) } },
        select: { area: true, description: true },
        orderBy: { createdAt: "asc" },
      }),
      tx.consultationNote.findMany({
        where: { consultationId: c.id, status: "FINAL" },
        select: { id: true, authorUserId: true, body: true, finalizedAt: true, correctsNoteId: true },
        orderBy: [{ finalizedAt: "asc" }, { id: "asc" }],
      }),
      tx.photoSession.findMany({
        where: { consultationId: c.id },
        select: {
          startedAt: true,
          protocol: {
            select: { name: true, views: { select: { viewKey: true, name: true, sortOrder: true } } },
          },
          photos: { where: { status: { in: ["ACCEPTED", "ARCHIVED"] } }, select: { viewKey: true } },
        },
        orderBy: { startedAt: "asc" },
      }),
    ]);
    const names = await this.names(tx, [
      ...notes.map((n) => n.authorUserId),
      ...(c.primaryProviderUserId ? [c.primaryProviderUserId] : []),
    ]);
    const author = (id: string) => names.get(id) ?? "Staff member";
    // Each addendum under the note it corrects, or under that note's own original.
    const root = new Map<string, string>();
    for (const n of notes)
      root.set(n.id, n.correctsNoteId === null ? n.id : (root.get(n.correctsNoteId) ?? n.correctsNoteId));
    const asNote = (n: (typeof notes)[number]): SummaryNote => ({
      author: author(n.authorUserId),
      finalizedAt: n.finalizedAt ?? new Date(0),
      body: n.body,
    });
    return {
      practice: { name: practice.name, timeZone: practice.timezone },
      patient: {
        name: [patient.firstName, patient.middleName, patient.lastName].filter((p) => p).join(" "),
        dateOfBirth: patient.dateOfBirth,
        mrn: patient.mrn,
      },
      consultation: {
        date: c.startedAt ?? c.createdAt,
        provider: c.primaryProviderUserId ? author(c.primaryProviderUserId) : null,
        reason: c.reason,
      },
      concerns,
      notes: notes
        .filter((n) => n.correctsNoteId === null)
        .map((n) => ({
          ...asNote(n),
          addenda: notes.filter((a) => a.correctsNoteId !== null && root.get(a.id) === n.id).map(asNote),
        })),
      photography: sessions.map((s) => ({
        startedAt: s.startedAt,
        protocol: s.protocol.name,
        // The protocol's views that have an accepted photo, in the protocol's order.
        views: s.protocol.views
          .filter((v) => s.photos.some((p) => p.viewKey === v.viewKey))
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((v) => v.name),
      })),
      versionNumber,
      generatedAt: new Date(),
    };
  }
}
