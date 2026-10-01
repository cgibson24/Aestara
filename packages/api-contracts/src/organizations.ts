// Organizations, practices and locations (spec §6.3 "Organizations, practices,
// locations"; §4.1 tenant hierarchy; §4.5 rule 2 for the admin bootstrap).
import { OperationalStatus, OrganizationStatus as OrganizationStatusValues } from "@aestara/shared-types";
import { Email } from "./auth.ts";
import { PageQuery } from "./pagination.ts";
import { Timestamp, Uuid } from "./primitives.ts";
import { z } from "./zod.ts";

export const Slug = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, "Use 1–63 lower-case letters, digits and inner hyphens.")
  .meta({
    description: "URL-safe, unique organization handle. It never carries PHI.",
    example: "lumen-aesthetics",
  });

/** An IANA time zone name the server can resolve, e.g. `America/New_York`. */
export const TimeZone = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (zone) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Must be an IANA time zone name, e.g. America/New_York." },
  )
  .meta({ description: "IANA time zone name.", example: "America/New_York" });

const Name = z.string().trim().min(1).max(200);

export const OrganizationStatus = z.enum(OrganizationStatusValues).meta({ id: "OrganizationStatus" });
export const OperationalStatusSchema = z.enum(OperationalStatus).meta({ id: "OperationalStatus" });

export const Organization = z
  .strictObject({
    id: Uuid,
    name: z.string(),
    slug: Slug,
    status: OrganizationStatus,
    createdAt: Timestamp,
    updatedAt: Timestamp,
    version: z.int().min(1),
  })
  .meta({ id: "Organization" });

export const FirstAdmin = z
  .strictObject({ email: Email, displayName: z.string().trim().min(1).max(100) })
  .meta({ id: "FirstAdmin", description: "Invited as the organization's first ORGANIZATION_ADMIN." });

export const OrganizationCreate = z
  .strictObject({ name: Name, slug: Slug, firstAdmin: FirstAdmin })
  .meta({ id: "OrganizationCreate" });

export const OrganizationUpdate = z
  .strictObject({
    name: Name.optional(),
    status: OrganizationStatus.optional().meta({
      description: "Platform scope only. An organization cannot change its own status.",
    }),
  })
  .refine((u) => Object.keys(u).length > 0, { message: "Send at least one field." })
  .meta({ id: "OrganizationUpdate" });

export const AdminBootstrapResult = z
  .strictObject({
    userId: Uuid,
    membershipStatus: z.enum(["INVITED", "ACTIVE", "DISABLED"]),
    invitationExpiresAt: Timestamp.meta({ description: "The invitation is sent by email, never returned." }),
  })
  .meta({ id: "AdminBootstrapResult" });

export const OrganizationCreated = z
  .strictObject({ organization: Organization, firstAdmin: AdminBootstrapResult })
  .meta({ id: "OrganizationCreated" });

export const Practice = z
  .strictObject({
    id: Uuid,
    name: z.string(),
    timezone: TimeZone,
    status: OperationalStatusSchema,
    createdAt: Timestamp,
    updatedAt: Timestamp,
    version: z.int().min(1),
  })
  .meta({ id: "Practice" });

export const PracticeCreate = z
  .strictObject({ name: Name, timezone: TimeZone })
  .meta({ id: "PracticeCreate" });

export const PracticeUpdate = z
  .strictObject({
    name: Name.optional(),
    timezone: TimeZone.optional(),
    status: OperationalStatusSchema.optional(),
  })
  .refine((u) => Object.keys(u).length > 0, { message: "Send at least one field." })
  .meta({ id: "PracticeUpdate" });

const AddressFields = {
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().min(1).max(200),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().min(1).max(20),
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/, "Must be an ISO 3166-1 alpha-2 code.")
    .meta({ example: "US" }),
};

export const Location = z
  .strictObject({
    id: Uuid,
    practiceId: Uuid,
    name: z.string(),
    timezone: TimeZone,
    addressLine1: z.string().optional(),
    addressLine2: z.string().optional(),
    city: z.string().optional(),
    region: z.string().optional(),
    postalCode: z.string().optional(),
    countryCode: z.string().optional(),
    status: OperationalStatusSchema,
    createdAt: Timestamp,
    updatedAt: Timestamp,
    version: z.int().min(1),
  })
  .meta({ id: "Location" });

export const LocationCreate = z
  .strictObject({
    practiceId: Uuid,
    name: Name,
    timezone: TimeZone,
    addressLine1: AddressFields.addressLine1.optional(),
    addressLine2: AddressFields.addressLine2.optional(),
    city: AddressFields.city.optional(),
    region: AddressFields.region.optional(),
    postalCode: AddressFields.postalCode.optional(),
    countryCode: AddressFields.countryCode.optional(),
  })
  .meta({ id: "LocationCreate" });

export const LocationUpdate = z
  .strictObject({
    name: Name.optional(),
    timezone: TimeZone.optional(),
    addressLine1: AddressFields.addressLine1.nullable().optional(),
    addressLine2: AddressFields.addressLine2.nullable().optional(),
    city: AddressFields.city.nullable().optional(),
    region: AddressFields.region.nullable().optional(),
    postalCode: AddressFields.postalCode.nullable().optional(),
    countryCode: AddressFields.countryCode.nullable().optional(),
    status: OperationalStatusSchema.optional(),
  })
  .refine((u) => Object.keys(u).length > 0, { message: "Send at least one field." })
  .meta({ id: "LocationUpdate", description: "null clears an address field." });

export const LocationListQuery = PageQuery.extend({
  practiceId: Uuid.optional().meta({ description: "Only this practice's locations." }),
});
