// The patient timeline (spec §6.3 `/timeline`; Bible §4.3; ADR-0026 K3-18;
// ADR-0027). Built from the domain tables, not the audit log: each source
// yields items of one kind, newest first, ordered by time, then kind, then
// source ID, so the cursor is exact across sources. A domain's items appear
// only to a caller holding its read permission. Items are metadata: a kind, a
// time, an actor where the table records one, and a link; never record text.
import type { TimelineDomain, TimelineItem } from "@aestara/api-contracts";
import { Injectable } from "@nestjs/common";
import type { z } from "zod";
import { iso } from "../common/concurrency.ts";
import { type RequestContext, requireAuth, requireTx } from "../common/context.ts";
import { CursorCodec } from "../common/cursor.ts";
import { notFound } from "../common/errors.ts";
import type { OperationResult } from "../common/operation.ts";
import type { Tx } from "../db/database.ts";

type Item = z.input<typeof TimelineItem>;
type Domain = z.output<typeof TimelineDomain>;
type Kind = Item["kind"];

/** The permission that lets a caller read a domain's items (spec §6.3 read permissions). */
const DOMAIN_PERMISSION: Record<Domain, string> = {
  PATIENT: "patient.read",
  CONSULTATION: "consultation.create",
  PHOTOGRAPHY: "photo.view",
  DOCUMENT: "document.read",
  MEDIA_PERMISSION: "photo.permission.read",
};

/** Rows a source returns: the event's time, the source row's ID, its actor and its link. */
type Row = { at: Date; id: string; actor: string | null; resourceId: string };
type Window = { at?: Date; idBefore?: string; atOrBefore?: Date };

interface Source {
  readonly kind: Kind;
  readonly domain: Domain;
  readonly resource: Item["resource"]["type"];
  /** Up to `take` rows of the patient after the cursor, newest first. */
  fetch(tx: Tx, patientId: string, window: Window, take: number): Promise<Row[]>;
}

const END_OF_TIME = new Date("9999-12-31T23:59:59.999Z");

/** The time filter of one source: strictly older, or as old with a smaller ID, or as old in a later kind. */
function timeFilter(column: string, window: Window): Record<string, unknown> {
  if (window.atOrBefore !== undefined) return { [column]: { lte: window.atOrBefore } };
  // Without a cursor: every row with the event (an upper bound also leaves out nulls).
  if (window.at === undefined) return { [column]: { lte: END_OF_TIME } };
  if (window.idBefore === undefined) return { [column]: { lt: window.at } };
  return { OR: [{ [column]: { lt: window.at } }, { [column]: window.at, id: { lt: window.idBefore } }] };
}

const by = (column: string) => [{ [column]: "desc" }, { id: "desc" }];

function source(
  kind: Kind,
  domain: Domain,
  resource: Item["resource"]["type"],
  fetch: Source["fetch"],
): Source {
  return { kind, domain, resource, fetch };
}

const consultation = (kind: Kind, column: string, actor: string | null) =>
  source(kind, "CONSULTATION", "Consultation", async (tx, patientId, window, take) =>
    (
      await tx.consultation.findMany({
        where: { patientId, ...timeFilter(column, window) },
        orderBy: by(column) as never,
        take,
      })
    ).map((r) => {
      const row = r as unknown as Record<string, unknown>;
      return {
        at: row[column] as Date,
        id: r.id,
        actor: actor === null ? null : ((row[actor] as string | null) ?? null),
        resourceId: r.id,
      };
    }),
  );

/** Every source, in kind order (the tie-break after time). */
const SOURCES: readonly Source[] = [
  consultation("CONSULTATION_ARCHIVED", "archivedAt", null),
  consultation("CONSULTATION_CANCELLED", "cancelledAt", "cancelledById"),
  consultation("CONSULTATION_COMPLETED", "completedAt", "completedById"),
  consultation("CONSULTATION_CREATED", "createdAt", "createdById"),
  consultation("CONSULTATION_STARTED", "startedAt", null),
  consultation("CONSULTATION_SUBMITTED_FOR_REVIEW", "readyForReviewAt", null),
  source("BEFORE_AFTER_CREATED", "PHOTOGRAPHY", "BeforeAfterSet", async (tx, patientId, window, take) =>
    (
      await tx.beforeAfterSet.findMany({
        where: { patientId, ...timeFilter("createdAt", window) },
        orderBy: by("createdAt") as never,
        take,
        select: { id: true, createdAt: true, createdById: true },
      })
    ).map((r) => ({ at: r.createdAt, id: r.id, actor: r.createdById, resourceId: r.id })),
  ),
  source("DOCUMENT_ADDED", "DOCUMENT", "Document", async (tx, patientId, window, take) =>
    (
      await tx.documentVersion.findMany({
        where: { patientId, ...timeFilter("createdAt", window) },
        orderBy: by("createdAt") as never,
        take,
        select: { id: true, createdAt: true, createdById: true, documentId: true },
      })
    ).map((r) => ({ at: r.createdAt, id: r.id, actor: r.createdById, resourceId: r.documentId })),
  ),
  source(
    "MEDIA_PERMISSION_CHANGED",
    "MEDIA_PERMISSION",
    "PhotoPermission",
    async (tx, patientId, window, take) =>
      (
        await tx.photoPermission.findMany({
          where: { patientId, ...timeFilter("createdAt", window) },
          orderBy: by("createdAt") as never,
          take,
          select: { id: true, createdAt: true, recordedById: true },
        })
      ).map((r) => ({ at: r.createdAt, id: r.id, actor: r.recordedById, resourceId: r.id })),
  ),
  source("MEDIA_RELEASED", "MEDIA_PERMISSION", "MediaRelease", async (tx, patientId, window, take) =>
    (
      await tx.mediaRelease.findMany({
        where: { patientId, ...timeFilter("releasedAt", window) },
        orderBy: by("releasedAt") as never,
        take,
        select: { id: true, releasedAt: true, releasedById: true },
      })
    ).map((r) => ({ at: r.releasedAt, id: r.id, actor: r.releasedById, resourceId: r.id })),
  ),
  source("MEDIA_RELEASE_REVOKED", "MEDIA_PERMISSION", "MediaRelease", async (tx, patientId, window, take) =>
    (
      await tx.mediaRelease.findMany({
        where: { patientId, ...timeFilter("revokedAt", window) },
        orderBy: by("revokedAt") as never,
        take,
        select: { id: true, revokedAt: true, revokedById: true },
      })
    ).map((r) => ({ at: r.revokedAt as Date, id: r.id, actor: r.revokedById, resourceId: r.id })),
  ),
  source("PATIENT_ARCHIVED", "PATIENT", "Patient", async (tx, patientId, window, take) =>
    (
      await tx.patient.findMany({
        where: { id: patientId, ...timeFilter("archivedAt", window) },
        take,
        select: { id: true, archivedAt: true, archivedById: true },
      })
    ).map((r) => ({ at: r.archivedAt as Date, id: r.id, actor: r.archivedById, resourceId: r.id })),
  ),
  source("PATIENT_CREATED", "PATIENT", "Patient", async (tx, patientId, window, take) =>
    (
      await tx.patient.findMany({
        where: { id: patientId, ...timeFilter("createdAt", window) },
        take,
        select: { id: true, createdAt: true, createdById: true },
      })
    ).map((r) => ({ at: r.createdAt, id: r.id, actor: r.createdById, resourceId: r.id })),
  ),
  source("PHOTO_SESSION_COMPLETED", "PHOTOGRAPHY", "PhotoSession", async (tx, patientId, window, take) =>
    (
      await tx.photoSession.findMany({
        where: { patientId, ...timeFilter("completedAt", window) },
        orderBy: by("completedAt") as never,
        take,
        select: { id: true, completedAt: true, capturedByUserId: true },
      })
    ).map((r) => ({ at: r.completedAt as Date, id: r.id, actor: r.capturedByUserId, resourceId: r.id })),
  ),
];

/** Order: newest first, then kind descending, then source ID descending. */
function before(
  a: { at: Date; kind: string; id: string },
  b: { at: Date; kind: string; id: string },
): number {
  if (a.at.getTime() !== b.at.getTime()) return b.at.getTime() - a.at.getTime();
  if (a.kind !== b.kind) return a.kind < b.kind ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

@Injectable()
export class TimelineService {
  constructor(private readonly cursors: CursorCodec) {}

  async list(
    ctx: RequestContext,
    patientId: string,
    query: { limit: number; cursor?: string; domain?: Domain },
  ): Promise<OperationResult> {
    const tx = requireTx(ctx);
    if ((await tx.patient.count({ where: { id: patientId } })) === 0) throw notFound("PATIENT_NOT_FOUND");
    const permissions = requireAuth(ctx).permissions;
    const after = this.cursors.decode("timeline", query.cursor);
    // The cursor's key is "<ISO time>|<kind>"; its ID is the source row's.
    const [atText, cursorKind] = (after?.k ?? "").split("|");
    const at = after !== undefined && atText ? new Date(atText) : undefined;
    const sources = SOURCES.filter(
      (s) =>
        (query.domain === undefined || s.domain === query.domain) &&
        permissions.has(DOMAIN_PERMISSION[s.domain]),
    );
    const take = query.limit + 1;
    const batches = await Promise.all(
      sources.map(async (s) => {
        // Items as old as the cursor come after it when their kind sorts lower, or when it is the cursor's kind with a lower ID.
        const window: Window =
          at === undefined
            ? {}
            : s.kind > (cursorKind ?? "")
              ? { at }
              : s.kind < (cursorKind ?? "")
                ? { atOrBefore: at }
                : { at, idBefore: after?.id ?? "" };
        const rows = await s.fetch(tx, patientId, window, take);
        return rows.map((r) => ({ ...r, kind: s.kind, source: s }));
      }),
    );
    const merged = batches.flat().sort(before);
    const items = merged.slice(0, query.limit);
    const hasMore = merged.length > query.limit;
    const last = items.at(-1);
    const data: Item[] = items.map((r) => ({
      id: `${r.kind}:${r.id}`,
      kind: r.kind,
      domain: r.source.domain,
      occurredAt: iso(r.at),
      ...(r.actor !== null ? { actorUserId: r.actor } : {}),
      resource: { type: r.source.resource, id: r.resourceId },
    }));
    return {
      data,
      page:
        hasMore && last !== undefined
          ? {
              hasMore: true,
              nextCursor: this.cursors.encode("timeline", {
                k: `${last.at.toISOString()}|${last.kind}`,
                id: last.id,
              }),
            }
          : { hasMore: false },
    };
  }
}
