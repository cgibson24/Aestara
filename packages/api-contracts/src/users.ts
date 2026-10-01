// Users, memberships, role assignments, profiles, roles and the permission
// catalog (spec §6.3 "Users, roles, permissions"; §4.3–§4.5; ADR-0018 K-05,
// K-07, K-12). A "user" here is a person's membership in the caller's
// organization; the person's identity (User) is platform-level.
import { MembershipStatus, RoleAssignmentScope as ScopeValues } from "@aestara/shared-types";
import { Email } from "./auth.ts";
import { PageQuery } from "./pagination.ts";
import { Timestamp, Uuid } from "./primitives.ts";
import { z } from "./zod.ts";

export const OrganizationScope = z
  .enum(ScopeValues.filter((s) => s !== "PLATFORM") as ["ORGANIZATION", "PRACTICE", "LOCATION"])
  .meta({ id: "OrganizationScope", description: "Where a role assignment applies inside the organization." });

export const RoleAssignmentScope = z.enum(ScopeValues).meta({ id: "RoleAssignmentScope" });

export const RoleAssignment = z
  .strictObject({
    id: Uuid,
    roleId: Uuid,
    roleKey: z.string(),
    scope: RoleAssignmentScope,
    practiceId: Uuid.optional(),
    locationId: Uuid.optional(),
    assignedAt: Timestamp,
    assignedById: Uuid.optional(),
  })
  .meta({ id: "RoleAssignment" });

export const RoleAssignmentCreate = z
  .strictObject({
    roleId: Uuid,
    scope: OrganizationScope,
    practiceId: Uuid.optional(),
    locationId: Uuid.optional(),
  })
  .superRefine((a, ctx) => {
    const needsPractice = a.scope !== "ORGANIZATION";
    if (needsPractice !== (a.practiceId !== undefined))
      ctx.addIssue({
        code: "custom",
        path: ["practiceId"],
        message: needsPractice
          ? "Required for PRACTICE and LOCATION scope."
          : "Only for PRACTICE and LOCATION scope.",
      });
    if ((a.scope === "LOCATION") !== (a.locationId !== undefined))
      ctx.addIssue({
        code: "custom",
        path: ["locationId"],
        message: a.scope === "LOCATION" ? "Required for LOCATION scope." : "Only for LOCATION scope.",
      });
  })
  .meta({ id: "RoleAssignmentCreate" });

export const MembershipStatusSchema = z.enum(MembershipStatus).meta({ id: "MembershipStatus" });

export const StaffUser = z
  .strictObject({
    id: Uuid.meta({ description: "The user's identifier (platform-wide)." }),
    email: Email,
    displayName: z.string().optional(),
    phone: z.string().optional(),
    status: MembershipStatusSchema.meta({ description: "Membership status in the caller's organization." }),
    invitedAt: Timestamp.optional(),
    activatedAt: Timestamp.optional(),
    disabledAt: Timestamp.optional(),
    lastLoginAt: Timestamp.optional(),
    mfaEnrolled: z.boolean().meta({ description: "At least one confirmed second factor." }),
    roleAssignments: z
      .array(RoleAssignment)
      .meta({ description: "Active assignments in this organization." }),
    hasProviderProfile: z.boolean(),
    hasStaffProfile: z.boolean(),
    createdAt: Timestamp,
    version: z.int().min(1).meta({ description: "Membership version." }),
  })
  .meta({ id: "StaffUser" });

export const UserCreate = z
  .strictObject({
    email: Email,
    displayName: z.string().trim().min(1).max(100),
    roleAssignments: z.array(RoleAssignmentCreate).max(20).default([]),
  })
  .meta({
    id: "UserCreate",
    description:
      "Invites a person to the organization. An existing account is reused; the invitation goes by email.",
  });

export const UserUpdate = z
  .strictObject({
    displayName: z.string().trim().min(1).max(100).optional(),
    phone: z
      .string()
      .regex(/^\+[1-9]\d{6,14}$/, "Use E.164 format, e.g. +15555550123.")
      .nullable()
      .optional(),
  })
  .refine((u) => Object.keys(u).length > 0, { message: "Send at least one field." })
  .meta({
    id: "UserUpdate",
    description:
      "Changes the person's account, so it is allowed only when the person belongs to no other organization.",
  });

export const UserListQuery = PageQuery.extend({
  status: MembershipStatusSchema.optional(),
  practiceId: Uuid.optional().meta({ description: "Users with an assignment in this practice." }),
  roleId: Uuid.optional(),
});

export const ProviderProfile = z
  .strictObject({
    userId: Uuid,
    displayName: z.string(),
    credentials: z.string().optional(),
    specialty: z.string().optional(),
    npi: z.string().optional(),
    bio: z.string().optional(),
    isBookable: z.boolean(),
    updatedAt: Timestamp,
    version: z.int().min(1),
  })
  .meta({ id: "ProviderProfile" });

/** National Provider Identifier: 10 digits with a Luhn check digit over the 80840 prefix (CMS). */
export const Npi = z
  .string()
  .regex(/^\d{10}$/, "Must be 10 digits.")
  .refine(
    (npi) => {
      const digits = `80840${npi}`.split("").map(Number);
      let sum = 0;
      for (let i = digits.length - 1, double = false; i >= 0; i--, double = !double) {
        let d = digits[i] ?? 0;
        if (double) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
        sum += d;
      }
      return sum % 10 === 0;
    },
    { message: "Not a valid NPI." },
  );

export const ProviderProfilePut = z
  .strictObject({
    displayName: z.string().trim().min(1).max(100),
    credentials: z.string().trim().min(1).max(100).optional(),
    specialty: z.string().trim().min(1).max(100).optional(),
    npi: Npi.optional(),
    bio: z.string().trim().min(1).max(2000).optional(),
    isBookable: z.boolean().default(true),
  })
  .meta({ id: "ProviderProfilePut" });

export const StaffProfile = z
  .strictObject({
    userId: Uuid,
    displayName: z.string(),
    jobTitle: z.string().optional(),
    department: z.string().optional(),
    updatedAt: Timestamp,
    version: z.int().min(1),
  })
  .meta({ id: "StaffProfile" });

export const StaffProfilePut = z
  .strictObject({
    displayName: z.string().trim().min(1).max(100),
    jobTitle: z.string().trim().min(1).max(100).optional(),
    department: z.string().trim().min(1).max(100).optional(),
  })
  .meta({ id: "StaffProfilePut" });

export const SessionsRevokeResult = z
  .strictObject({ revokedSessions: z.int().min(0) })
  .meta({ id: "SessionsRevokeResult" });

export const IdentityVerificationMethod = z.enum(["IN_PERSON", "VIDEO_CALL", "KNOWN_CALLBACK"]).meta({
  id: "IdentityVerificationMethod",
  description: "How the admin confirmed who asked for the reset.",
});

export const MfaResetRequest = z
  .strictObject({ identityVerificationMethod: IdentityVerificationMethod })
  .meta({ id: "MfaResetRequest" });

export const MfaResetResult = z
  .strictObject({ removedFactors: z.int().min(0), revokedSessions: z.int().min(0) })
  .meta({ id: "MfaResetResult" });

export const Role = z
  .strictObject({
    id: Uuid,
    key: z.string(),
    name: z.string(),
    description: z.string().optional(),
    system: z.boolean().meta({ description: "Platform-defined role (organizationId is not set)." }),
    permissions: z.array(z.string()),
  })
  .meta({ id: "Role" });

export const PermissionInfo = z
  .strictObject({ key: z.string(), description: z.string() })
  .meta({ id: "Permission" });
