-- =============================================================================
-- LAYER 1 - Identity, tenancy, patients, audit (spec §5.8)
-- Fixtures: two tenants (A, B); tenant A has two practices and two patients.
-- The system roles are inserted only where the catalog migration has not
-- already seeded them (packages/database runs this fragment after it).
-- =============================================================================
-- -----------------------------------------------------------------------------
-- Fixtures: two tenants (A, B); tenant A has two practices and two patients.
-- -----------------------------------------------------------------------------
INSERT INTO "Organization" (id, name, slug, "updatedAt") VALUES
  ('0a000000-0000-7000-8000-000000000001', 'Org A', 'org-a', now()),
  ('0b000000-0000-7000-8000-000000000001', 'Org B', 'org-b', now());

INSERT INTO "Practice" (id, "organizationId", name, timezone, "updatedAt") VALUES
  ('0a000000-0000-7000-8000-0000000000a1', '0a000000-0000-7000-8000-000000000001', 'Practice A1', 'America/New_York', now()),
  ('0a000000-0000-7000-8000-0000000000a2', '0a000000-0000-7000-8000-000000000001', 'Practice A2', 'America/Chicago', now()),
  ('0b000000-0000-7000-8000-0000000000b1', '0b000000-0000-7000-8000-000000000001', 'Practice B1', 'America/Denver', now());

INSERT INTO "Location" (id, "organizationId", "practiceId", name, timezone, "updatedAt") VALUES
  ('0a000000-0000-7000-8000-00000000a1a1', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-0000000000a1', 'Loc A1', 'America/New_York', now()),
  ('0a000000-0000-7000-8000-00000000a2a2', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-0000000000a2', 'Loc A2', 'America/Chicago', now());

INSERT INTO "User" (id, kind, email, status, "updatedAt") VALUES
  ('0a000000-0000-7000-8000-bda01469c352', 'WORKFORCE', 'dr.a@example.test', 'ACTIVE', now()),
  ('0b000000-0000-7000-8000-bda01469c352', 'WORKFORCE', 'dr.b@example.test', 'ACTIVE', now());

INSERT INTO "Membership" (id, "organizationId", "userId", status, "updatedAt") VALUES
  ('0a000000-0000-7000-8000-7a64dc3548ad', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-bda01469c352', 'ACTIVE', now()),
  ('0b000000-0000-7000-8000-7a64dc3548ad', '0b000000-0000-7000-8000-000000000001', '0b000000-0000-7000-8000-bda01469c352', 'ACTIVE', now());

INSERT INTO "ProviderProfile" (id, "organizationId", "userId", "displayName", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-d4aca8b3cd42', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-bda01469c352', 'Dr A', now()),
  ('0b000000-0000-7000-8000-d4aca8b3cd42', '0b000000-0000-7000-8000-000000000001', '0b000000-0000-7000-8000-bda01469c352', 'Dr B', now());

INSERT INTO "Patient" (id, "organizationId", "firstName", "lastName", "dateOfBirth", mrn, "createdById", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-8f01aa50d871', '0a000000-0000-7000-8000-000000000001', 'Ann', 'Lee', '1990-01-01', 'MRN-1', '0a000000-0000-7000-8000-bda01469c352', now()),
  ('0a000000-0000-7000-8000-7b53c75b7213', '0a000000-0000-7000-8000-000000000001', 'Bea', 'Kim', '1985-02-02', 'MRN-2', '0a000000-0000-7000-8000-bda01469c352', now());

INSERT INTO _results VALUES ('same MRN in a different organization is allowed', true);
INSERT INTO "Patient" (id, "organizationId", "firstName", "lastName", "dateOfBirth", mrn, "createdById", "updatedAt") VALUES
  ('0b000000-0000-7000-8000-fd76a7158ec0', '0b000000-0000-7000-8000-000000000001', 'Cal', 'Ng', '1970-03-03', 'MRN-1', '0b000000-0000-7000-8000-bda01469c352', now());

-- System roles used below, looked up by key so the fragment also runs after
-- the catalog migration (which seeds them with fixed identifiers).
INSERT INTO "Role" (id, key, name, "updatedAt") VALUES
  (gen_random_uuid(), 'SUPER_ADMIN', 'Super admin', now()),
  (gen_random_uuid(), 'PRACTICE_ADMIN', 'Practice admin', now()),
  (gen_random_uuid(), 'SURGEON_PHYSICIAN', 'Surgeon / physician', now())
ON CONFLICT (key) WHERE "organizationId" IS NULL DO NOTHING;
-- =============================================================================
-- A. Tenant isolation (Bible 3.1, 21.2, 36 "Tenancy")
-- =============================================================================
SELECT pg_temp.expect_error($$
  INSERT INTO "Patient" (id, "organizationId", "primaryPracticeId", "firstName", "lastName", "dateOfBirth", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0b000000-0000-7000-8000-0000000000b1', 'X', 'Y', '2000-01-01', now())$$,
  '23503', 'A2 patient in org A cannot have a primary practice of org B');

SELECT pg_temp.expect_error($$
  INSERT INTO "UserRole" (id, "userId", "organizationId", "roleId", scope)
  VALUES (gen_random_uuid(), '0b000000-0000-7000-8000-bda01469c352', '0a000000-0000-7000-8000-000000000001',
          (SELECT id FROM "Role" WHERE key = 'PRACTICE_ADMIN' AND "organizationId" IS NULL), 'ORGANIZATION')$$,
  '23503', 'A5 a role in org A cannot be assigned to a user without an org A membership');

-- =============================================================================
-- B. Identity & RBAC shape
-- =============================================================================
SELECT pg_temp.expect_error($$
  INSERT INTO "Role" (id, key, name, "updatedAt") VALUES (gen_random_uuid(), 'SUPER_ADMIN', 'dup', now())$$,
  '23505', 'B1 system role keys are unique even though organizationId is NULL');

SELECT pg_temp.expect_error($$
  INSERT INTO "UserRole" (id, "userId", "organizationId", "roleId", scope)
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-bda01469c352', '0a000000-0000-7000-8000-000000000001',
          (SELECT id FROM "Role" WHERE key = 'SUPER_ADMIN' AND "organizationId" IS NULL), 'PLATFORM')$$,
  '23514', 'B2 PLATFORM-scope assignment cannot carry an organization');

SELECT pg_temp.expect_error($$
  INSERT INTO "UserRole" (id, "userId", "organizationId", "roleId", scope, "practiceId", "locationId")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-bda01469c352', '0a000000-0000-7000-8000-000000000001',
          (SELECT id FROM "Role" WHERE key = 'SURGEON_PHYSICIAN' AND "organizationId" IS NULL), 'LOCATION',
          '0a000000-0000-7000-8000-0000000000a1', '0a000000-0000-7000-8000-00000000a2a2')$$,
  '23503', 'B3 LOCATION-scope assignment must use a location of the named practice');

SELECT pg_temp.expect_ok($$
  INSERT INTO "UserRole" (id, "userId", "organizationId", "roleId", scope, "practiceId")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-bda01469c352', '0a000000-0000-7000-8000-000000000001',
          (SELECT id FROM "Role" WHERE key = 'SURGEON_PHYSICIAN' AND "organizationId" IS NULL), 'PRACTICE', '0a000000-0000-7000-8000-0000000000a1')$$,
  'B4 valid PRACTICE-scope assignment is accepted');

SELECT pg_temp.expect_error($$
  INSERT INTO "UserRole" (id, "userId", "organizationId", "roleId", scope, "practiceId")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-bda01469c352', '0a000000-0000-7000-8000-000000000001',
          (SELECT id FROM "Role" WHERE key = 'SURGEON_PHYSICIAN' AND "organizationId" IS NULL), 'PRACTICE', '0a000000-0000-7000-8000-0000000000a1')$$,
  '23505', 'B5 duplicate active assignment of the same role and scope is rejected');

SELECT pg_temp.expect_error($$
  INSERT INTO "Patient" (id, "organizationId", "firstName", "lastName", "dateOfBirth", mrn, "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', 'Dup', 'Mrn', '2000-01-01', 'MRN-1', now())$$,
  '23505', 'B6 MRN is unique within an organization');

INSERT INTO "LoginEvent" (id, "eventType", "userId", "requestId")
VALUES ('0a000000-0000-7000-8000-209c7faed83b', 'LOGIN_SUCCESS', '0a000000-0000-7000-8000-bda01469c352', 'req-login-1');

SELECT pg_temp.expect_error($$
  INSERT INTO "LoginEvent" (id, "eventType", "requestId") VALUES (gen_random_uuid(), 'LOGIN_FAILURE', 'req-2')$$,
  '23514', 'B7 LOGIN_FAILURE must carry a failure reason');

SELECT pg_temp.expect_error($$
  DELETE FROM "LoginEvent" WHERE id = '0a000000-0000-7000-8000-209c7faed83b'$$,
  'AE001', 'B8 login events are append-only');

SELECT pg_temp.expect_error($$
  INSERT INTO "LoginEvent" (id, "eventType", "userId", "failureReason", "requestId")
  VALUES (gen_random_uuid(), 'MFA_CHALLENGE_ISSUED', '0a000000-0000-7000-8000-bda01469c352', 'MFA_FAILED', 'req-3')$$,
  '23514', 'B9 an MFA challenge is a sign-in step, not a failure (ADR-0018 K-15)');

SELECT pg_temp.expect_error($$
  INSERT INTO "Patient" (id, "organizationId", "firstName", "lastName", "dateOfBirth", status, "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', 'No', 'Stamp', '2000-01-01', 'ARCHIVED', now())$$,
  '23514', 'B10 an ARCHIVED patient records when it was archived');

-- =============================================================================
-- K. Patient search keys (ADR-0020)
-- =============================================================================
INSERT INTO "Patient" (id, "organizationId", "firstName", "lastName", "preferredName", "dateOfBirth", email, phone, "updatedAt")
VALUES ('0a000000-0000-7000-8000-00000000c0de', '0a000000-0000-7000-8000-000000000001', 'José', 'O''Brien-Smith', 'Pepe',
        '1980-04-04', ' Jose.OB@Example.TEST ', '+1 (555) 010-0199', now());

DO $$
DECLARE p record;
BEGIN
  SELECT * INTO p FROM "Patient" WHERE id = '0a000000-0000-7000-8000-00000000c0de';
  IF (p."firstNameKey", p."lastNameKey", p."preferredNameKey", p."emailKey", p."phoneKey")
     IS DISTINCT FROM ('jose', 'obriensmith', 'pepe', 'jose.ob@example.test', '15550100199') THEN
    RAISE EXCEPTION 'FAIL  K1 search keys were %, %, %, %, %',
      p."firstNameKey", p."lastNameKey", p."preferredNameKey", p."emailKey", p."phoneKey";
  END IF;
  INSERT INTO _results VALUES ('K1 the database derives accent-free, punctuation-free search keys', true);
  RAISE NOTICE 'PASS  K1 the database derives accent-free, punctuation-free search keys';
END $$;

DO $$
DECLARE k text;
BEGIN
  UPDATE "Patient" SET "lastNameKey" = 'forged', "phoneKey" = '0' WHERE id = '0a000000-0000-7000-8000-00000000c0de';
  SELECT "lastNameKey" || '|' || "phoneKey" INTO k FROM "Patient" WHERE id = '0a000000-0000-7000-8000-00000000c0de';
  IF k <> 'obriensmith|15550100199' THEN
    RAISE EXCEPTION 'FAIL  K2 a written search key survived: %', k;
  END IF;
  UPDATE "Patient" SET "lastName" = 'Núñez', phone = NULL WHERE id = '0a000000-0000-7000-8000-00000000c0de';
  SELECT "lastNameKey" || '|' || coalesce("phoneKey", 'null') INTO k FROM "Patient" WHERE id = '0a000000-0000-7000-8000-00000000c0de';
  IF k <> 'nunez|null' THEN
    RAISE EXCEPTION 'FAIL  K2 search keys did not follow an update: %', k;
  END IF;
  INSERT INTO _results VALUES ('K2 search keys always follow their source columns and cannot be written', true);
  RAISE NOTICE 'PASS  K2 search keys always follow their source columns and cannot be written';
END $$;

-- =============================================================================
-- T. One-time tokens (ADR-0018 K-09, K-15)
-- =============================================================================
INSERT INTO "UserToken" (id, "userId", purpose, "tokenHash", "organizationId", "expiresAt")
VALUES ('0a000000-0000-7000-8000-00000000f001', '0a000000-0000-7000-8000-bda01469c352', 'INVITATION', repeat('1', 64),
        '0a000000-0000-7000-8000-000000000001', now() + interval '7 days');

SELECT pg_temp.expect_error($$
  INSERT INTO "UserToken" (id, "userId", purpose, "tokenHash", "expiresAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-bda01469c352', 'INVITATION', repeat('2', 64), now() + interval '7 days')$$,
  '23514', 'T1 an invitation names the organization it activates');

SELECT pg_temp.expect_error($$
  INSERT INTO "UserToken" (id, "userId", purpose, "tokenHash", "expiresAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-bda01469c352', 'MFA_CHALLENGE', repeat('3', 64), now() + interval '5 minutes')$$,
  '23514', 'T2 an MFA challenge names the client its session is issued to');

SELECT pg_temp.expect_error($$
  INSERT INTO "UserToken" (id, "userId", purpose, "tokenHash", "expiresAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-bda01469c352', 'PASSWORD_RESET', repeat('4', 64), now() - interval '1 minute')$$,
  '23514', 'T3 a token expires after it is created');

SELECT pg_temp.expect_error($$
  UPDATE "UserToken" SET "tokenHash" = repeat('5', 64) WHERE id = '0a000000-0000-7000-8000-00000000f001'$$,
  'AE001', 'T4 a token hash, owner and purpose never change');

SELECT pg_temp.expect_ok($$
  UPDATE "UserToken" SET "attemptCount" = 1, "consumedAt" = now() WHERE id = '0a000000-0000-7000-8000-00000000f001'$$,
  'T5 a failed attempt and the consumption are recorded');

SELECT pg_temp.expect_error($$
  UPDATE "UserToken" SET "consumedAt" = NULL WHERE id = '0a000000-0000-7000-8000-00000000f001'$$,
  'AE001', 'T6 a consumed token can never be reopened');

SELECT pg_temp.expect_error($$
  INSERT INTO "UserToken" (id, "userId", purpose, "tokenHash", "organizationId", "expiresAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-bda01469c352', 'INVITATION', repeat('1', 64),
          '0a000000-0000-7000-8000-000000000001', now() + interval '7 days')$$,
  '23505', 'T7 token hashes are unique');
-- =============================================================================
-- G. Audit trail (Bible 21.2, 22)
-- =============================================================================
INSERT INTO "AuditEvent" (id, "organizationId", "actorType", "actorUserId", action, "resourceType", "resourceId", "patientId", "requestId")
VALUES ('0a000000-0000-7000-8000-00000000ae01', '0a000000-0000-7000-8000-000000000001', 'USER', '0a000000-0000-7000-8000-bda01469c352',
        'PATIENT_VIEWED', 'Patient', '0a000000-0000-7000-8000-8f01aa50d871', '0a000000-0000-7000-8000-8f01aa50d871', 'req-audit-1');

SELECT pg_temp.expect_error($$
  UPDATE "AuditEvent" SET action = 'PATIENT_UPDATED' WHERE id = '0a000000-0000-7000-8000-00000000ae01'$$,
  'AE001', 'G1 audit events cannot be updated');
SELECT pg_temp.expect_error($$
  DELETE FROM "AuditEvent" WHERE id = '0a000000-0000-7000-8000-00000000ae01'$$,
  'AE001', 'G2 audit events cannot be deleted');
SELECT pg_temp.expect_error($$ TRUNCATE "AuditEvent" $$,
  'AE001', 'G3 the audit table cannot be truncated');
SELECT pg_temp.expect_error($$
  INSERT INTO "AuditEvent" (id, "actorType", action, "resourceType", "requestId")
  VALUES (gen_random_uuid(), 'USER', 'LOGOUT', 'Session', 'req-x')$$,
  '23514', 'G4 a USER-actor audit event must identify the user');

-- =============================================================================
-- R. Regression tests for defects found by the independent review (spec 11.3)
-- =============================================================================
SELECT pg_temp.expect_error($$
  INSERT INTO "UserRole" (id, "userId", "organizationId", "roleId", scope, "assignedById")
  VALUES (gen_random_uuid(), (SELECT id FROM "User" WHERE email = 'dr.a@example.test'), (SELECT id FROM "Organization" WHERE slug = 'org-a'), (SELECT id FROM "Role" WHERE key = 'SUPER_ADMIN' AND "organizationId" IS NULL),
          'ORGANIZATION', (SELECT id FROM "User" WHERE email = 'dr.a@example.test'))$$,
  '23514', 'R4 nobody can assign a role to themselves');
