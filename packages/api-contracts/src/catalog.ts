// Treatment catalog (spec §6.3 "Treatment plans & estimates", §5.2; Bible §11.1,
// §17.1; ADR-0028 K4-03, ADR-0029). Organization-wide categories and treatments;
// retired, never deleted. Nothing is seeded: each organization builds its own.
import { OperationalStatus } from "@aestara/shared-types";
import { OperationalStatusSchema } from "./organizations.ts";
import { PageQuery } from "./pagination.ts";
import { Currency, Timestamp, Uuid } from "./primitives.ts";
import { z } from "./zod.ts";

/** A price is never negative; at most 10 digits before the point (Decimal(12, 2)). */
const price = () =>
  z
    .strictObject({
      amount: z
        .string()
        .regex(
          /^(0|[1-9]\d{0,9})\.\d{2}$/,
          "Zero or more, two fraction digits, at most 10 digits before the point.",
        )
        .meta({ example: "450.00" }),
      currency: Currency,
    })
    .meta({ description: "A default unit price in USD, never negative." });
export const CatalogPrice = price().meta({ id: "CatalogPrice" });

export const TreatmentCategory = z
  .strictObject({
    id: Uuid,
    name: z.string(),
    parentId: Uuid.optional().meta({ description: "Absent for a top-level category." }),
    sortOrder: z.int().min(0),
    status: OperationalStatusSchema,
    createdAt: Timestamp,
    updatedAt: Timestamp,
    version: z.int().min(1),
  })
  .meta({ id: "TreatmentCategory" });

const CategoryName = z.string().trim().min(1).max(100);
const SortOrder = z.int().min(0).max(10_000);

export const TreatmentCategoryCreate = z
  .strictObject({
    name: CategoryName,
    parentId: Uuid.optional().meta({ description: "An active category of the organization." }),
    sortOrder: SortOrder.optional().meta({ description: "Default 0; lower first." }),
  })
  .meta({ id: "TreatmentCategoryCreate", description: "Creates an ACTIVE category." });

export const TreatmentCategoryUpdate = z
  .strictObject({
    name: CategoryName.optional(),
    // A plain uuid: a nullable reference renders as allOf, which would refuse null.
    parentId: z.uuid().nullable().optional().meta({ description: "null makes the category top-level." }),
    sortOrder: SortOrder.optional(),
    status: z.enum(OperationalStatus).optional().meta({
      description:
        "INACTIVE retires the category: refused while it has active treatments or subcategories. ACTIVE reactivates it under an active parent.",
    }),
  })
  .refine((u) => Object.keys(u).length > 0, { message: "Change at least one field." })
  .meta({ id: "TreatmentCategoryUpdate" });

export const TreatmentCategoryListQuery = PageQuery.extend({
  status: OperationalStatusSchema.optional(),
}).meta({ id: "TreatmentCategoryListQuery" });

export const Treatment = z
  .strictObject({
    id: Uuid,
    categoryId: Uuid,
    name: z.string(),
    code: z.string().optional().meta({ description: "Unique in the organization when present." }),
    description: z.string().optional(),
    unitLabel: z.string().optional().meta({ description: 'The pricing unit, such as "syringe" or "area".' }),
    defaultUnitPrice: CatalogPrice.optional().meta({
      description: "Prefills a plan item, which can change it (ADR-0028 K4-03).",
    }),
    status: OperationalStatusSchema,
    createdAt: Timestamp,
    updatedAt: Timestamp,
    version: z.int().min(1),
  })
  .meta({ id: "Treatment" });

const TreatmentName = z.string().trim().min(1).max(120);
const TreatmentCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/, "Letters, digits, '.', '_' or '-', at most 40.");
const Description = z.string().trim().min(1).max(1000);
const UnitLabel = z.string().trim().min(1).max(40);

export const TreatmentCreate = z
  .strictObject({
    categoryId: Uuid.meta({ description: "An active category of the organization." }),
    name: TreatmentName,
    code: TreatmentCode.optional(),
    description: Description.optional(),
    unitLabel: UnitLabel.optional(),
    defaultUnitPrice: CatalogPrice.optional(),
  })
  .meta({ id: "TreatmentCreate", description: "Creates an ACTIVE treatment." });

export const TreatmentUpdate = z
  .strictObject({
    categoryId: z.uuid().optional().meta({ description: "Moves the treatment to another active category." }),
    name: TreatmentName.optional(),
    code: TreatmentCode.nullable().optional(),
    description: Description.nullable().optional(),
    unitLabel: UnitLabel.nullable().optional(),
    // Inline, not the CatalogPrice reference: a nullable reference renders as allOf, which would refuse null.
    defaultUnitPrice: price().nullable().optional(),
    status: z.enum(OperationalStatus).optional().meta({
      description:
        "INACTIVE retires the treatment; plans and procedures keep pointing at it. ACTIVE reactivates it in an active category.",
    }),
  })
  .refine((u) => Object.keys(u).length > 0, { message: "Change at least one field." })
  .meta({ id: "TreatmentUpdate" });

export const TreatmentListQuery = PageQuery.extend({
  categoryId: Uuid.optional(),
  status: OperationalStatusSchema.optional(),
}).meta({ id: "TreatmentListQuery" });
