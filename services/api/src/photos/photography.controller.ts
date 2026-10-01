// Routes of the "Photography" group (spec §6.3; ADR-0023). Path parameters name
// the patient; the session or photo in a body must belong to that patient.
import type {
  AccessUrlRequest,
  BatchAccessUrlRequest,
  MediaReleaseCreate,
  MediaReleaseRevoke,
  PhotographyProtocolCreate,
  PhotographyProtocolUpdate,
  PhotoPermissionChange,
  PhotoSessionComplete,
  PhotoSessionCreate,
  PhotoTagsPut,
  PhotoUploadRequest,
} from "@aestara/api-contracts";
import { Controller } from "@nestjs/common";
import type { z } from "zod";
import type { RequestContext } from "../common/context.ts";
import { Ctx, Operation, type OperationResult } from "../common/operation.ts";
import { PermissionsService } from "./permissions.service.ts";
import { PhotosService } from "./photos.service.ts";
import { ProtocolsService } from "./protocols.service.ts";

const pid = (ctx: RequestContext) => ctx.params.patientId ?? "";
const body = <T extends z.ZodType>(ctx: RequestContext) => ctx.body as z.output<T>;

@Controller()
export class PhotographyController {
  constructor(
    private readonly protocols: ProtocolsService,
    private readonly photos: PhotosService,
    private readonly permissions: PermissionsService,
  ) {}

  // ---- Protocols ----
  @Operation("listPhotographyProtocols")
  listProtocols(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.protocols.list(ctx, ctx.query as Parameters<ProtocolsService["list"]>[1]);
  }

  @Operation("createPhotographyProtocol")
  createProtocol(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.protocols.create(ctx, body<typeof PhotographyProtocolCreate>(ctx));
  }

  @Operation("getPhotographyProtocol")
  getProtocol(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.protocols.get(ctx, ctx.params.id ?? "");
  }

  @Operation("updatePhotographyProtocol")
  updateProtocol(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.protocols.update(ctx, ctx.params.id ?? "", body<typeof PhotographyProtocolUpdate>(ctx));
  }

  @Operation("activatePhotographyProtocol")
  activateProtocol(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.protocols.activate(ctx, ctx.params.id ?? "");
  }

  @Operation("retirePhotographyProtocol")
  retireProtocol(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.protocols.retire(ctx, ctx.params.id ?? "");
  }

  // ---- Sessions ----
  @Operation("listPhotoSessions")
  listSessions(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.photos.listSessions(ctx, pid(ctx), ctx.query as Parameters<PhotosService["listSessions"]>[2]);
  }

  @Operation("createPhotoSession")
  createSession(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.photos.createSession(ctx, pid(ctx), body<typeof PhotoSessionCreate>(ctx));
  }

  @Operation("getPhotoSession")
  getSession(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.photos.getSession(ctx, pid(ctx), ctx.params.sessionId ?? "");
  }

  @Operation("completePhotoSession")
  completeSession(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.photos.completeSession(
      ctx,
      pid(ctx),
      ctx.params.sessionId ?? "",
      body<typeof PhotoSessionComplete>(ctx),
    );
  }

  // ---- Photos ----
  @Operation("listPhotos")
  listPhotos(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.photos.list(ctx, pid(ctx), ctx.query as Parameters<PhotosService["list"]>[2]);
  }

  @Operation("createPhotoUpload")
  createUpload(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.photos.createUpload(ctx, pid(ctx), body<typeof PhotoUploadRequest>(ctx));
  }

  @Operation("completePhotoUpload")
  completeUpload(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.photos.completeUpload(ctx, pid(ctx), ctx.params.photoId ?? "");
  }

  @Operation("getPhoto")
  getPhoto(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.photos.get(ctx, pid(ctx), ctx.params.photoId ?? "");
  }

  @Operation("createPhotoAccessUrl")
  accessUrl(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.photos.accessUrl(
      ctx,
      pid(ctx),
      ctx.params.photoId ?? "",
      body<typeof AccessUrlRequest>(ctx).variant,
    );
  }

  @Operation("createPhotoAccessUrls")
  accessUrls(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.photos.accessUrls(ctx, pid(ctx), body<typeof BatchAccessUrlRequest>(ctx));
  }

  @Operation("replacePhotoTags")
  replaceTags(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.photos.replaceTags(
      ctx,
      pid(ctx),
      ctx.params.photoId ?? "",
      body<typeof PhotoTagsPut>(ctx).tags,
    );
  }

  @Operation("archivePhoto")
  archive(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.photos.archive(ctx, pid(ctx), ctx.params.photoId ?? "");
  }

  // ---- Permissions and releases ----
  @Operation("getPhotoPermissions")
  permissionSummary(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.permissions.summary(ctx, pid(ctx));
  }

  @Operation("listPhotoPermissionHistory")
  permissionHistory(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.permissions.history(ctx, pid(ctx), ctx.query as Parameters<PermissionsService["history"]>[2]);
  }

  @Operation("recordPhotoPermission")
  recordPermission(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.permissions.record(ctx, pid(ctx), body<typeof PhotoPermissionChange>(ctx));
  }

  @Operation("listMediaReleases")
  listReleases(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.permissions.listReleases(
      ctx,
      pid(ctx),
      ctx.query as Parameters<PermissionsService["listReleases"]>[2],
    );
  }

  @Operation("createMediaRelease")
  createRelease(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.permissions.createRelease(ctx, pid(ctx), body<typeof MediaReleaseCreate>(ctx));
  }

  @Operation("revokeMediaRelease")
  revokeRelease(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.permissions.revokeRelease(
      ctx,
      pid(ctx),
      ctx.params.releaseId ?? "",
      body<typeof MediaReleaseRevoke>(ctx).reason,
    );
  }
}
