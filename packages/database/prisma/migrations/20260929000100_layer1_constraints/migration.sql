-- Layer 1 constraints beyond Prisma: partial unique indexes, CHECKs, triggers,
-- trigram search indexes. Copied verbatim from the LAYER 1 fragment of
-- docs/technical-spec/constraints.sql; scripts/check-migrations.ts fails CI if
-- the two ever differ.

-- #############################################################################
-- LAYER 1 - Identity, tenancy, patients, audit
-- #############################################################################

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- Rejects the operation outright (append-only ledgers, immutable rows).
CREATE OR REPLACE FUNCTION app_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'IMMUTABLE_RECORD: % on "%" is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'AE001';
END;
$$;

-- Allows an UPDATE only if every column except those listed in TG_ARGV[0]
-- (comma-separated) is unchanged.
CREATE OR REPLACE FUNCTION app_enforce_frozen_columns() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  allowed text[] := CASE WHEN TG_NARGS > 0 AND TG_ARGV[0] <> ''
                         THEN string_to_array(TG_ARGV[0], ',')
                         ELSE ARRAY[]::text[] END;
BEGIN
  IF (to_jsonb(OLD) - allowed) IS DISTINCT FROM (to_jsonb(NEW) - allowed) THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: only [%] may change on "%" in its current state',
      array_to_string(allowed, ', '), TG_TABLE_NAME
      USING ERRCODE = 'AE001';
  END IF;
  RETURN NEW;
END;
$$;

-- Status may only move along an allowed edge once a row is frozen.
-- TG_ARGV[0] is a comma-separated list of "FROM>TO" edges; staying in the same
-- status is always allowed (other frozen-column triggers still apply).
CREATE OR REPLACE FUNCTION app_enforce_status_edges() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status::text <> OLD.status::text
     AND NOT (OLD.status::text || '>' || NEW.status::text) = ANY (string_to_array(TG_ARGV[0], ',')) THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: status % -> % is not permitted on "%"', OLD.status, NEW.status, TG_TABLE_NAME
      USING ERRCODE = 'AE001';
  END IF;
  RETURN NEW;
END;
$$;

-- System roles (organizationId NULL) have globally unique keys.
CREATE UNIQUE INDEX "Role_system_key_unique"
  ON "Role" ("key") WHERE "organizationId" IS NULL;

-- Assignment scope must match the populated tenant columns. This also closes
-- the MATCH SIMPLE gap: a composite FK is not checked when organizationId is NULL.
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_scope_shape_chk" CHECK (
  ("scope" = 'PLATFORM'     AND "organizationId" IS NULL     AND "practiceId" IS NULL     AND "locationId" IS NULL) OR
  ("scope" = 'ORGANIZATION' AND "organizationId" IS NOT NULL AND "practiceId" IS NULL     AND "locationId" IS NULL) OR
  ("scope" = 'PRACTICE'     AND "organizationId" IS NOT NULL AND "practiceId" IS NOT NULL AND "locationId" IS NULL) OR
  ("scope" = 'LOCATION'     AND "organizationId" IS NOT NULL AND "practiceId" IS NOT NULL AND "locationId" IS NOT NULL)
);

-- [P] Separation of duties (spec 4.5): nobody assigns a role to themselves.
-- assignedById is NULL only for migrations/bootstrap seeds.
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_no_self_assignment_chk"
  CHECK ("assignedById" IS NULL OR "assignedById" <> "userId");

-- At most one active assignment of the same role at the same scope.
CREATE UNIQUE INDEX "UserRole_active_unique"
  ON "UserRole" ("userId", "roleId", "organizationId", "practiceId", "locationId") NULLS NOT DISTINCT
  WHERE "revokedAt" IS NULL;

ALTER TABLE "UserCredential" ADD CONSTRAINT "UserCredential_shape_chk" CHECK (
  ("type" = 'PASSWORD' AND "passwordHash" IS NOT NULL AND "totpSecretCiphertext" IS NULL AND "webauthnCredentialId" IS NULL) OR
  ("type" = 'TOTP'     AND "totpSecretCiphertext" IS NOT NULL AND "passwordHash" IS NULL AND "webauthnCredentialId" IS NULL) OR
  ("type" = 'WEBAUTHN' AND "webauthnCredentialId" IS NOT NULL AND "webauthnPublicKey" IS NOT NULL
                       AND "passwordHash" IS NULL AND "totpSecretCiphertext" IS NULL)
);

CREATE UNIQUE INDEX "UserCredential_one_active_password"
  ON "UserCredential" ("userId") WHERE "type" = 'PASSWORD' AND "revokedAt" IS NULL;

ALTER TABLE "Session" ADD CONSTRAINT "Session_expiry_chk"
  CHECK ("idleExpiresAt" <= "absoluteExpiresAt");

ALTER TABLE "Session" ADD CONSTRAINT "Session_revocation_chk"
  CHECK (("revokedAt" IS NULL) = ("revokedReason" IS NULL));

ALTER TABLE "LoginEvent" ADD CONSTRAINT "LoginEvent_failure_reason_chk"
  CHECK (("eventType" = 'LOGIN_FAILURE') = ("failureReason" IS NOT NULL));

-- Security ledger: append-only.
CREATE TRIGGER "LoginEvent_append_only"
  BEFORE UPDATE OR DELETE ON "LoginEvent"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER "LoginEvent_no_truncate"
  BEFORE TRUNCATE ON "LoginEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION app_reject_mutation();

-- One-time tokens (ADR-0018 K-09, K-15). Each purpose carries exactly the
-- context it needs: an invitation names its organization, a sign-in challenge
-- names the client its session will be issued to.
ALTER TABLE "UserToken" ADD CONSTRAINT "UserToken_shape_chk" CHECK (
  ("purpose" = 'INVITATION'            AND "organizationId" IS NOT NULL AND "clientApp" IS NULL     AND "webauthnChallenge" IS NULL) OR
  ("purpose" = 'PASSWORD_RESET'        AND "organizationId" IS NULL     AND "clientApp" IS NULL     AND "webauthnChallenge" IS NULL) OR
  ("purpose" = 'MFA_CHALLENGE'         AND "organizationId" IS NULL     AND "clientApp" IS NOT NULL) OR
  ("purpose" = 'WEBAUTHN_REGISTRATION' AND "organizationId" IS NULL     AND "clientApp" IS NULL     AND "webauthnChallenge" IS NOT NULL)
);

ALTER TABLE "UserToken" ADD CONSTRAINT "UserToken_expiry_chk"
  CHECK ("expiresAt" > "createdAt" AND "attemptCount" >= 0);

-- Only the attempt counter and the consumption stamp move, and a consumed
-- token can never be used or reopened.
CREATE TRIGGER "UserToken_frozen"
  BEFORE UPDATE ON "UserToken"
  FOR EACH ROW EXECUTE FUNCTION app_enforce_frozen_columns('attemptCount,consumedAt');
CREATE TRIGGER "UserToken_consumed_final"
  BEFORE UPDATE ON "UserToken"
  FOR EACH ROW WHEN (OLD."consumedAt" IS NOT NULL) EXECUTE FUNCTION app_reject_mutation();

-- Tenant-scoped fuzzy name search (Layer 1 patient search).
CREATE INDEX "Patient_search_last_name_trgm"
  ON "Patient" USING gin ("organizationId", lower("lastName") gin_trgm_ops);
CREATE INDEX "Patient_search_first_name_trgm"
  ON "Patient" USING gin ("organizationId", lower("firstName") gin_trgm_ops);

ALTER TABLE "Patient" ADD CONSTRAINT "Patient_archived_chk"
  CHECK (("status" = 'ARCHIVED') = ("archivedAt" IS NOT NULL));

ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actor_chk" CHECK (
  ("actorType" = 'USER'    AND "actorUserId" IS NOT NULL) OR
  ("actorType" = 'SERVICE' AND "actorServiceId" IS NOT NULL) OR
  ("actorType" = 'SYSTEM')
);

-- Append-only audit (Bible 21.2 / 22). Retention detaches and archives whole
-- time partitions (spec 5.6); rows are never UPDATEd or DELETEd.
CREATE TRIGGER "AuditEvent_append_only"
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER "AuditEvent_no_truncate"
  BEFORE TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION app_reject_mutation();

ALTER TABLE "IdempotencyKey" ADD CONSTRAINT "IdempotencyKey_completed_chk"
  CHECK ("state" <> 'COMPLETED' OR "responseStatus" IS NOT NULL);
