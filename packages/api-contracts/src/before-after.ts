// Before/after sets (spec §6.3 "Before / after"; Bible §8, §34.1 #12–21;
// ADR-0026 K3-11 to K3-13). Comparison is client rendering of display previews
// and the registration transform; the original is never modified.
import { RegistrationMode as RegistrationModeValues } from "@aestara/shared-types";
import { PageQuery } from "./pagination.ts";
import { Timestamp, Uuid } from "./primitives.ts";
import { z } from "./zod.ts";

export const RegistrationMode = z.enum(RegistrationModeValues).meta({
  id: "RegistrationMode",
  description: "NONE: no transform. AUTOMATIC: estimated by the registration job. MANUAL: set by a user.",
});

/**
 * A similarity transform (ADR-0026 K3-13): uniform scale, rotation and
 * translation only, so alignment can never reshape anatomy. It places the
 * after image over the before image. Units are the before image's height, the
 * origin is its centre, x runs right and y down; the after image is first
 * scaled to the before image's height and centred, then scaled by `scale`,
 * rotated by `rotationDeg` (clockwise on screen) and moved by
 * (`translateX`, `translateY`).
 */
export const RegistrationTransform = z
  .strictObject({
    scale: z.number().min(0.25).max(4),
    rotationDeg: z.number().min(-180).max(180),
    translateX: z.number().min(-2).max(2),
    translateY: z.number().min(-2).max(2),
  })
  .meta({ id: "RegistrationTransform" });

export const RegistrationJobStatus = z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"]).meta({
  id: "RegistrationJobStatus",
});

export const BeforeAfterSet = z
  .strictObject({
    id: Uuid,
    patientId: Uuid,
    beforePhotoId: Uuid,
    afterPhotoId: Uuid,
    consultationId: Uuid.optional(),
    viewKey: z.string().optional(),
    title: z.string().optional(),
    registrationMode: RegistrationMode,
    registrationTransform: RegistrationTransform.optional(),
    registrationJob: z
      .strictObject({
        status: RegistrationJobStatus,
        failure: z
          .enum(["NO_RELIABLE_ALIGNMENT", "PROCESSING_FAILED"])
          .optional()
          .meta({ description: "Why automatic registration found nothing; the set is unchanged." }),
      })
      .optional()
      .meta({ description: "The latest automatic registration requested for this set." }),
    createdById: Uuid,
    createdAt: Timestamp,
    updatedAt: Timestamp,
    version: z.number().int().positive(),
  })
  .meta({ id: "BeforeAfterSet" });

export const BeforeAfterSetCreate = z
  .strictObject({
    beforePhotoId: Uuid,
    afterPhotoId: Uuid,
    consultationId: Uuid.optional().meta({ description: "A consultation of the same patient." }),
    title: z.string().trim().min(1).max(120).optional(),
  })
  .refine((v) => v.beforePhotoId !== v.afterPhotoId, {
    message: "Choose two different photos.",
    path: ["afterPhotoId"],
  })
  .meta({
    id: "BeforeAfterSetCreate",
    description:
      "Exactly two accepted, unarchived photos of this patient with the same view, the before one captured earlier.",
  });

export const BeforeAfterSetUpdate = z
  .strictObject({
    title: z.string().trim().min(1).max(120).nullable().optional(),
    registration: z
      .discriminatedUnion("mode", [
        z.strictObject({ mode: z.literal("MANUAL"), transform: RegistrationTransform }),
        z.strictObject({ mode: z.literal("NONE") }),
      ])
      .optional()
      .meta({ description: "Align by hand, or reset to no transform." }),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Change at least one field." })
  .meta({ id: "BeforeAfterSetUpdate" });

export const BeforeAfterSetListQuery = PageQuery.extend({
  consultationId: Uuid.optional(),
}).meta({ id: "BeforeAfterSetListQuery" });
