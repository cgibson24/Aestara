// Routes of the "Patients" group. Search terms travel in the body, never in a
// URL (spec §6.1.10).
import type {
  DuplicateCheckRequest,
  PatientContactCreate,
  PatientContactUpdate,
  PatientCreate,
  PatientSearchRequest,
  PatientUpdate,
} from "@aestara/api-contracts";
import { Controller } from "@nestjs/common";
import type { z } from "zod";
import type { RequestContext } from "../common/context.ts";
import { Ctx, Operation, type OperationResult } from "../common/operation.ts";
import { PatientsService } from "./patients.service.ts";

const pid = (ctx: RequestContext) => ctx.params.patientId ?? "";

@Controller()
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Operation("searchPatients")
  search(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.patients.search(ctx, ctx.body as z.output<typeof PatientSearchRequest>);
  }

  @Operation("listPatients")
  list(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.patients.list(ctx, ctx.query as Parameters<PatientsService["list"]>[1]);
  }

  @Operation("checkPatientDuplicates")
  duplicates(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.patients.duplicateCheck(ctx, ctx.body as z.output<typeof DuplicateCheckRequest>);
  }

  @Operation("createPatient")
  create(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.patients.create(ctx, ctx.body as z.output<typeof PatientCreate>);
  }

  @Operation("getPatient")
  get(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.patients.profile(ctx, pid(ctx));
  }

  @Operation("updatePatient")
  update(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.patients.update(ctx, pid(ctx), ctx.body as z.output<typeof PatientUpdate>);
  }

  @Operation("archivePatient")
  archive(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.patients.archive(ctx, pid(ctx));
  }

  @Operation("listPatientContacts")
  contacts(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.patients.listContacts(ctx, pid(ctx), ctx.query as { limit: number; cursor?: string });
  }

  @Operation("createPatientContact")
  createContact(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.patients.createContact(ctx, pid(ctx), ctx.body as z.output<typeof PatientContactCreate>);
  }

  @Operation("updatePatientContact")
  updateContact(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.patients.updateContact(
      ctx,
      pid(ctx),
      ctx.params.contactId ?? "",
      ctx.body as z.output<typeof PatientContactUpdate>,
    );
  }

  @Operation("deletePatientContact")
  deleteContact(@Ctx() ctx: RequestContext): Promise<OperationResult> {
    return this.patients.deleteContact(ctx, pid(ctx), ctx.params.contactId ?? "");
  }
}
