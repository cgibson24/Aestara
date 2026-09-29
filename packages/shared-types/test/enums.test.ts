import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuditAction, LoginEventType, PatientStatus, UserTokenPurpose } from "../generated/enums.ts";
import { parseEnums, renderEnums } from "../scripts/generate-enums.ts";

const schema = readFileSync(join(import.meta.dirname, "../../database/prisma/schema.prisma"), "utf8");

describe("generated enums", () => {
  it("are up to date with the Prisma schema", () => {
    const committed = readFileSync(join(import.meta.dirname, "../generated/enums.ts"), "utf8");
    expect(committed).toBe(renderEnums(parseEnums(schema)));
  });

  it("carry the Layer 1 values", () => {
    expect(PatientStatus).toEqual(["ACTIVE", "INACTIVE", "ARCHIVED", "DECEASED"]);
    expect(LoginEventType).toContain("MFA_CHALLENGE_ISSUED");
    expect(UserTokenPurpose).toContain("PASSWORD_RESET");
    expect(AuditAction).toContain("SECURITY_CREDENTIAL_CHANGED");
    expect(AuditAction).toContain("ORGANIZATION_SWITCHED");
  });
});
