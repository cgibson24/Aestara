-- =============================================================================
-- Aesthetic Platform - DRAFT database constraints beyond Prisma
-- Companion to docs/TECHNICAL_SPECIFICATION.md (section 5.5) and schema.prisma
--
-- Prisma cannot express partial / NULLS NOT DISTINCT unique indexes, CHECK
-- constraints, operator-class indexes or triggers.
--
-- LAYER FRAGMENTS. Tables are created by the layer that uses them (spec 5.8).
-- This file is therefore a sequence of per-layer fragments, in order. Each
-- layer's migration (prisma migrate dev --create-only, then append) carries
-- exactly the fragment for that layer. When a later layer adds columns that an
-- earlier CHECK must cover, that layer DROPs and re-creates the CHECK; the
-- statement is marked "re-created". Running the whole file top to bottom
-- against the full schema reproduces the final state; this is how
-- verification/ exercises it.
--
-- Requires PostgreSQL 15+ (NULLS NOT DISTINCT). Target: PostgreSQL 18 (spec 2).
-- Error code AE001 = IMMUTABLE_RECORD; the API maps it to 409 IMMUTABLE_RECORD.
-- Items marked [P] implement a proposed rule pending approval (spec section 10).
-- =============================================================================


-- #############################################################################
-- LAYER 1 - Identity, tenancy, patients, audit
-- #############################################################################

-- Accent folding for patient search keys (ADR-0020); a trusted extension.
CREATE EXTENSION IF NOT EXISTS unaccent;

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

-- Patient search under Row-Level Security (ADR-0020). LIKE, lower() and the
-- trigram operators are not leakproof, so under a tenant policy PostgreSQL may
-- not use them in an index condition. Search therefore runs on keys the
-- database derives here, with leakproof operators only. Name keys hold only
-- a-z and 0-9, whose order is the same in every collation, so a name prefix is
-- the range "key >= k AND key < k'" (k' = k with its last character advanced);
-- email, phone, MRN and date of birth are equalities. The B-tree indexes on
-- (organizationId, key) are declared in schema.prisma.
CREATE OR REPLACE FUNCTION app_name_search_key(value text) RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE
SET search_path = pg_catalog, public AS $$
  SELECT NULLIF(regexp_replace(lower(public.unaccent('public.unaccent'::regdictionary, value)),
                               '[^a-z0-9]+', '', 'g'), '')
$$;

-- Runs on every insert and update, so a key can never disagree with its source.
CREATE OR REPLACE FUNCTION app_patient_search_keys() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public AS $$
BEGIN
  NEW."firstNameKey"     := coalesce(app_name_search_key(NEW."firstName"), '');
  NEW."lastNameKey"      := coalesce(app_name_search_key(NEW."lastName"), '');
  NEW."preferredNameKey" := app_name_search_key(NEW."preferredName");
  NEW."emailKey"         := NULLIF(lower(btrim(NEW.email)), '');
  NEW."phoneKey"         := NULLIF(regexp_replace(NEW.phone, '[^0-9]+', '', 'g'), '');
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Patient_search_keys"
  BEFORE INSERT OR UPDATE ON "Patient"
  FOR EACH ROW EXECUTE FUNCTION app_patient_search_keys();

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


-- #############################################################################
-- LAYER 2 - Photography core, storage, media permissions, configuration
-- #############################################################################

ALTER TABLE "StorageObject" ADD CONSTRAINT "StorageObject_sha256_chk"
  CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$');

-- Storage objects are write-once: after verification only lifecycle columns move.
CREATE TRIGGER "StorageObject_write_once"
  BEFORE UPDATE ON "StorageObject"
  FOR EACH ROW WHEN (OLD."verifiedAt" IS NOT NULL)
  EXECUTE FUNCTION app_enforce_frozen_columns('status,scanStatus,purgedAt');

CREATE TRIGGER "StorageObject_identity_immutable"
  BEFORE UPDATE ON "StorageObject"
  FOR EACH ROW WHEN (
       OLD."organizationId" IS DISTINCT FROM NEW."organizationId"
    OR OLD."objectClass"    IS DISTINCT FROM NEW."objectClass"
    OR OLD."bucket"         IS DISTINCT FROM NEW."bucket"
    OR OLD."objectKey"      IS DISTINCT FROM NEW."objectKey")
  EXECUTE FUNCTION app_reject_mutation();

-- A location implies its practice, so the (organizationId, practiceId) FK is
-- always evaluated (closes the MATCH SIMPLE gap on nullable composite FKs).
ALTER TABLE "PhotoSession" ADD CONSTRAINT "PhotoSession_location_needs_practice_chk"
  CHECK ("locationId" IS NULL OR "practiceId" IS NOT NULL);

-- A session belongs to its capturing user (Bible 6.1); only imports have none.
ALTER TABLE "PhotoSession" ADD CONSTRAINT "PhotoSession_capturer_chk"
  CHECK ("source" = 'IMPORT' OR "capturedByUserId" IS NOT NULL);

-- ORIGINAL protection (Bible 6.6): identity of a clinical photo and its
-- original object can never change.
CREATE TRIGGER "PatientPhoto_original_immutable"
  BEFORE UPDATE ON "PatientPhoto"
  FOR EACH ROW WHEN (
       OLD."originalObjectId" IS DISTINCT FROM NEW."originalObjectId"
    OR OLD."organizationId"   IS DISTINCT FROM NEW."organizationId"
    OR OLD."patientId"        IS DISTINCT FROM NEW."patientId"
    OR OLD."source"           IS DISTINCT FROM NEW."source"
    OR OLD."capturedAt"       IS DISTINCT FROM NEW."capturedAt")
  EXECUTE FUNCTION app_reject_mutation();

-- Photo status follows the spec 5.4.10 machine (ADR-0023 K2-05). Every upload
-- is scanned in QUARANTINED; a clean staff capture is accepted, a clean patient
-- upload waits for staff review, and a failed scan rejects the photo.
ALTER TABLE "PatientPhoto" ADD CONSTRAINT "PatientPhoto_archived_chk"
  CHECK ("status" <> 'ARCHIVED' OR "archivedAt" IS NOT NULL);

CREATE TRIGGER "PatientPhoto_status_edges_staff"
  BEFORE UPDATE OF "status" ON "PatientPhoto"
  FOR EACH ROW WHEN (NEW."source" <> 'PATIENT_UPLOAD')
  EXECUTE FUNCTION app_enforce_status_edges(
    'UPLOAD_PENDING>QUARANTINED,QUARANTINED>ACCEPTED,QUARANTINED>REJECTED,ACCEPTED>ARCHIVED');
CREATE TRIGGER "PatientPhoto_status_edges_patient"
  BEFORE UPDATE OF "status" ON "PatientPhoto"
  FOR EACH ROW WHEN (NEW."source" = 'PATIENT_UPLOAD')
  EXECUTE FUNCTION app_enforce_status_edges(
    'UPLOAD_PENDING>QUARANTINED,QUARANTINED>PENDING_REVIEW,QUARANTINED>REJECTED,PENDING_REVIEW>ACCEPTED,PENDING_REVIEW>RETAKE_REQUESTED,PENDING_REVIEW>REJECTED,ACCEPTED>ARCHIVED');

-- Protocols (ADR-0023 K2-10): forward-only status, never deleted, and frozen
-- with their views once they leave DRAFT. Changes are a superseding protocol.
CREATE TRIGGER "PhotographyProtocol_status_edges"
  BEFORE UPDATE OF "status" ON "PhotographyProtocol"
  FOR EACH ROW EXECUTE FUNCTION app_enforce_status_edges('DRAFT>ACTIVE,ACTIVE>RETIRED,DRAFT>RETIRED');
CREATE TRIGGER "PhotographyProtocol_frozen"
  BEFORE UPDATE ON "PhotographyProtocol"
  FOR EACH ROW WHEN (OLD."status" <> 'DRAFT')
  EXECUTE FUNCTION app_enforce_frozen_columns('status,updatedAt,version');
CREATE TRIGGER "PhotographyProtocol_no_delete"
  BEFORE DELETE ON "PhotographyProtocol"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

CREATE OR REPLACE FUNCTION app_protocol_view_draft_only() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  view_row "PhotographyProtocolView" := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."protocolId" IS DISTINCT FROM NEW."protocolId" THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: a view cannot move to another protocol'
      USING ERRCODE = 'AE001';
  END IF;
  IF EXISTS (SELECT 1 FROM "PhotographyProtocol"
             WHERE id = view_row."protocolId" AND status <> 'DRAFT') THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: views of a protocol that is not DRAFT are frozen'
      USING ERRCODE = 'AE001';
  END IF;
  RETURN view_row;
END;
$$;
CREATE TRIGGER "PhotographyProtocolView_draft_only"
  BEFORE INSERT OR UPDATE OR DELETE ON "PhotographyProtocolView"
  FOR EACH ROW EXECUTE FUNCTION app_protocol_view_draft_only();

-- Every audit row feeds the WORM copy (spec 7.3 (3); ADR-0023 K2-07): an outbox
-- row in the same transaction, keyed by the audit event's own ID, so the relay
-- archives exactly what committed and a replay is recognisable.
CREATE OR REPLACE FUNCTION app_audit_event_to_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "OutboxEvent" (id, "organizationId", "eventType", "aggregateType", "aggregateId", payload)
  VALUES (NEW.id, NEW."organizationId", 'audit.recorded', 'AuditEvent', NEW.id, '{}'::jsonb);
  RETURN NULL;
END;
$$;
CREATE TRIGGER "AuditEvent_feed_worm_copy"
  AFTER INSERT ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION app_audit_event_to_outbox();

-- Derivatives are immutable; regeneration creates a new row.
CREATE TRIGGER "PhotoDerivative_immutable"
  BEFORE UPDATE ON "PhotoDerivative"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

ALTER TABLE "PhotoPermission" ADD CONSTRAINT "PhotoPermission_scope_shape_chk" CHECK (
  ("scope" = 'PATIENT_WIDE'  AND "photoSessionId" IS NULL     AND "photoId" IS NULL) OR
  ("scope" = 'PHOTO_SESSION' AND "photoSessionId" IS NOT NULL AND "photoId" IS NULL) OR
  ("scope" = 'PHOTO'         AND "photoSessionId" IS NULL     AND "photoId" IS NOT NULL)
);

-- Until Layer 4 there is no e-consent to point at, so SIGNED_CONSENT evidence is
-- unavailable (re-created in Layer 4).
ALTER TABLE "PhotoPermission" ADD CONSTRAINT "PhotoPermission_evidence_chk"
  CHECK ("evidence" IS DISTINCT FROM 'SIGNED_CONSENT');

ALTER TABLE "PhotoPermission" ADD CONSTRAINT "PhotoPermission_version_chk"
  CHECK ("versionNumber" >= 1 AND (("versionNumber" = 1) = ("previousVersionId" IS NULL)));

-- Exactly one CURRENT permission per (patient, category, scope target).
CREATE UNIQUE INDEX "PhotoPermission_current_unique"
  ON "PhotoPermission" ("organizationId", "patientId", "category", "scope", "photoSessionId", "photoId")
  NULLS NOT DISTINCT
  WHERE "supersededAt" IS NULL;

-- Versioned + audited (Bible 7.2): rows are append-only; the only permitted
-- update is stamping supersededAt once.
CREATE TRIGGER "PhotoPermission_superseded_frozen"
  BEFORE UPDATE ON "PhotoPermission"
  FOR EACH ROW WHEN (OLD."supersededAt" IS NOT NULL)
  EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER "PhotoPermission_append_only"
  BEFORE UPDATE ON "PhotoPermission"
  FOR EACH ROW WHEN (OLD."supersededAt" IS NULL)
  EXECUTE FUNCTION app_enforce_frozen_columns('supersededAt');
CREATE TRIGGER "PhotoPermission_no_delete"
  BEFORE DELETE ON "PhotoPermission"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- Exactly one released asset (re-created in Layers 3 and 8 as subjects are added).
ALTER TABLE "MediaRelease" ADD CONSTRAINT "MediaRelease_single_subject_chk"
  CHECK (num_nonnulls("photoId", "derivativeId") = 1);

CREATE TRIGGER "MediaRelease_revoked_frozen"
  BEFORE UPDATE ON "MediaRelease"
  FOR EACH ROW WHEN (OLD."revokedAt" IS NOT NULL)
  EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER "MediaRelease_only_revocation"
  BEFORE UPDATE ON "MediaRelease"
  FOR EACH ROW WHEN (OLD."revokedAt" IS NULL)
  EXECUTE FUNCTION app_enforce_frozen_columns('revokedAt,revokedById,revocationReason');

-- Every release pins at least one permission version, checked at commit so the
-- release and its pins can be inserted in one transaction (Bible 7.3).
CREATE OR REPLACE FUNCTION app_media_release_has_permission() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "MediaReleasePermission" WHERE "mediaReleaseId" = NEW.id) THEN
    RAISE EXCEPTION 'MediaRelease % pins no PhotoPermission version', NEW.id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "MediaRelease_requires_permission"
  AFTER INSERT ON "MediaRelease"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_media_release_has_permission();

CREATE TRIGGER "MediaReleasePermission_append_only"
  BEFORE UPDATE OR DELETE ON "MediaReleasePermission"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- One row per flag and scope. The predicate is always true ("key" is NOT NULL);
-- it marks the index as one Prisma does not manage, so its drift check leaves it.
CREATE UNIQUE INDEX "FeatureFlag_scope_unique"
  ON "FeatureFlag" ("key", "organizationId", "practiceId") NULLS NOT DISTINCT
  WHERE "key" IS NOT NULL;

-- A practice-level flag must name its organization (closes MATCH SIMPLE gap).
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_practice_needs_org_chk"
  CHECK ("practiceId" IS NULL OR "organizationId" IS NOT NULL);

ALTER TABLE "RetentionPolicy" ADD CONSTRAINT "RetentionPolicy_period_chk"
  CHECK (("retentionDays" IS NULL OR "retentionDays" > 0)
         AND ("action" <> 'DELETE' OR "retentionDays" IS NOT NULL));


-- #############################################################################
-- LAYER 3 - Consultations, before/after, documents
-- #############################################################################

-- Consultation machine (spec 5.4.1; UD-28, ADR-0026 K3-01). A consultation is
-- created DRAFT; any non-final state may be cancelled.
CREATE TRIGGER "Consultation_created_draft"
  BEFORE INSERT ON "Consultation"
  FOR EACH ROW WHEN (NEW."status" <> 'DRAFT')
  EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER "Consultation_status_edges"
  BEFORE UPDATE OF "status" ON "Consultation"
  FOR EACH ROW EXECUTE FUNCTION app_enforce_status_edges(
    'DRAFT>IN_PROGRESS,IN_PROGRESS>AWAITING_INFORMATION,AWAITING_INFORMATION>READY_FOR_REVIEW,AWAITING_INFORMATION>IN_PROGRESS,IN_PROGRESS>READY_FOR_REVIEW,READY_FOR_REVIEW>IN_PROGRESS,READY_FOR_REVIEW>COMPLETED,COMPLETED>ARCHIVED,DRAFT>CANCELLED,IN_PROGRESS>CANCELLED,AWAITING_INFORMATION>CANCELLED,READY_FOR_REVIEW>CANCELLED,CANCELLED>ARCHIVED');

-- What each state allows (ADR-0026 K3-02): in review the reviewed content is
-- frozen; a completed or cancelled consultation may only be archived; an
-- archived one never changes.
CREATE TRIGGER "Consultation_frozen_in_review"
  BEFORE UPDATE ON "Consultation"
  FOR EACH ROW WHEN (OLD."status" = 'READY_FOR_REVIEW')
  EXECUTE FUNCTION app_enforce_frozen_columns(
    'status,completedAt,completedById,cancelledAt,cancelledById,cancellationReason,releaseDecision,releaseDecidedAt,releaseDecidedById,updatedAt,version');
CREATE TRIGGER "Consultation_frozen_when_closed"
  BEFORE UPDATE ON "Consultation"
  FOR EACH ROW WHEN (OLD."status" IN ('COMPLETED', 'CANCELLED'))
  EXECUTE FUNCTION app_enforce_frozen_columns('status,archivedAt,updatedAt,version');
CREATE TRIGGER "Consultation_frozen_when_archived"
  BEFORE UPDATE ON "Consultation"
  FOR EACH ROW WHEN (OLD."status" = 'ARCHIVED')
  EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER "Consultation_no_delete"
  BEFORE DELETE ON "Consultation"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- Completion records who completed the consultation, when, and the release
-- decision (ADR-0026 K3-04).
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_completed_chk"
  CHECK ("status" <> 'COMPLETED' OR ("completedAt" IS NOT NULL AND "completedById" IS NOT NULL
                                     AND "releaseDecision" IS NOT NULL));

ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_release_decision_chk"
  CHECK (num_nonnulls("releaseDecision", "releaseDecidedAt", "releaseDecidedById") IN (0, 3));

ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_archived_chk"
  CHECK ("status" <> 'ARCHIVED' OR "archivedAt" IS NOT NULL);

-- Cancelling needs its actor and a reason (ADR-0026 K3-05).
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_cancelled_chk"
  CHECK ("status" <> 'CANCELLED' OR ("cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL
                                     AND "cancellationReason" IS NOT NULL));

-- Review and completion never leave a draft note behind (ADR-0026 K3-03).
CREATE OR REPLACE FUNCTION app_consultation_no_draft_notes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ConsultationNote"
             WHERE "consultationId" = NEW.id AND status = 'DRAFT') THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: a consultation with a draft note cannot become %', NEW.status
      USING ERRCODE = 'AE001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Consultation_no_draft_notes"
  BEFORE UPDATE OF "status" ON "Consultation"
  FOR EACH ROW WHEN (NEW."status" IN ('READY_FOR_REVIEW', 'COMPLETED') AND NEW."status" <> OLD."status")
  EXECUTE FUNCTION app_consultation_no_draft_notes();

-- The concerns of a consultation change only while its content is open.
CREATE OR REPLACE FUNCTION app_consultation_concerns_open() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  link "ConsultationConcern" := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Consultation" WHERE id = link."consultationId"
                 AND status IN ('DRAFT', 'IN_PROGRESS', 'AWAITING_INFORMATION')) THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: the concerns of this consultation are frozen'
      USING ERRCODE = 'AE001';
  END IF;
  RETURN link;
END;
$$;
CREATE TRIGGER "ConsultationConcern_open_only"
  BEFORE INSERT OR UPDATE OR DELETE ON "ConsultationConcern"
  FOR EACH ROW EXECUTE FUNCTION app_consultation_concerns_open();

ALTER TABLE "ConsultationNote" ADD CONSTRAINT "ConsultationNote_final_chk"
  CHECK (("status" = 'FINAL') = ("finalizedAt" IS NOT NULL));

ALTER TABLE "ConsultationNote" ADD CONSTRAINT "ConsultationNote_not_self_chk"
  CHECK ("correctsNoteId" IS NULL OR "correctsNoteId" <> "id");

-- A FINAL note is immutable and never deleted; corrections are addenda (UD-15;
-- ADR-0026 K3-07).
CREATE TRIGGER "ConsultationNote_final_immutable"
  BEFORE UPDATE OR DELETE ON "ConsultationNote"
  FOR EACH ROW WHEN (OLD."status" = 'FINAL')
  EXECUTE FUNCTION app_reject_mutation();

-- Notes are written while the consultation is open; after completion only
-- addenda, which correct a FINAL note of the same consultation (the composite
-- FK keeps it in the same consultation).
CREATE OR REPLACE FUNCTION app_consultation_note_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  note "ConsultationNote" := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  consultation_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD."consultationId", OLD."authorUserId", OLD."correctsNoteId")
       IS DISTINCT FROM (NEW."consultationId", NEW."authorUserId", NEW."correctsNoteId") THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: a note keeps its consultation, author and corrected note'
      USING ERRCODE = 'AE001';
  END IF;
  SELECT status::text INTO consultation_status FROM "Consultation" WHERE id = note."consultationId";
  IF NOT (consultation_status IN ('IN_PROGRESS', 'AWAITING_INFORMATION')
          OR (consultation_status = 'COMPLETED' AND note."correctsNoteId" IS NOT NULL)) THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: the notes of a % consultation cannot change this way', consultation_status
      USING ERRCODE = 'AE001';
  END IF;
  IF TG_OP <> 'DELETE' AND note."correctsNoteId" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "ConsultationNote"
                     WHERE id = note."correctsNoteId" AND status = 'FINAL') THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: an addendum corrects a FINAL note'
      USING ERRCODE = 'AE001';
  END IF;
  RETURN note;
END;
$$;
CREATE TRIGGER "ConsultationNote_rules"
  BEFORE INSERT OR UPDATE OR DELETE ON "ConsultationNote"
  FOR EACH ROW EXECUTE FUNCTION app_consultation_note_rules();

ALTER TABLE "BeforeAfterSet" ADD CONSTRAINT "BeforeAfterSet_distinct_photos_chk"
  CHECK ("beforePhotoId" <> "afterPhotoId");

ALTER TABLE "BeforeAfterSet" ADD CONSTRAINT "BeforeAfterSet_registration_chk"
  CHECK ("registrationMode" <> 'NONE' OR "registrationTransform" IS NULL);

-- The before photo was captured earlier than the after photo, and a set keeps
-- its photos (ADR-0026 K3-11). The compatible-view rule is checked by the api.
-- Photos of another patient or tenant, or the same photo twice, are left to
-- the composite FKs and the CHECK above.
CREATE OR REPLACE FUNCTION app_before_after_order() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  before_at timestamptz;
  after_at timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD."patientId", OLD."beforePhotoId", OLD."afterPhotoId")
       IS DISTINCT FROM (NEW."patientId", NEW."beforePhotoId", NEW."afterPhotoId") THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: a before/after set keeps its photos'
      USING ERRCODE = 'AE001';
  END IF;
  SELECT "capturedAt" INTO before_at FROM "PatientPhoto"
    WHERE id = NEW."beforePhotoId" AND "organizationId" = NEW."organizationId" AND "patientId" = NEW."patientId";
  SELECT "capturedAt" INTO after_at FROM "PatientPhoto"
    WHERE id = NEW."afterPhotoId" AND "organizationId" = NEW."organizationId" AND "patientId" = NEW."patientId";
  IF NEW."beforePhotoId" <> NEW."afterPhotoId" AND before_at >= after_at THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: the before photo must be captured earlier than the after photo'
      USING ERRCODE = 'AE001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "BeforeAfterSet_order"
  BEFORE INSERT OR UPDATE ON "BeforeAfterSet"
  FOR EACH ROW EXECUTE FUNCTION app_before_after_order();

-- re-created: before/after sets become releasable subjects.
ALTER TABLE "MediaRelease" DROP CONSTRAINT "MediaRelease_single_subject_chk";
ALTER TABLE "MediaRelease" ADD CONSTRAINT "MediaRelease_single_subject_chk"
  CHECK (num_nonnulls("photoId", "derivativeId", "beforeAfterSetId") = 1);

CREATE TRIGGER "DocumentVersion_immutable"
  BEFORE UPDATE ON "DocumentVersion"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_sha256_chk"
  CHECK ("sha256" ~ '^[0-9a-f]{64}$');


-- #############################################################################
-- LAYER 4 - Plans, consents, content, instructions, exports
-- #############################################################################

-- Catalog (ADR-0028 K4-03): retired (INACTIVE), never deleted.
ALTER TABLE "Treatment" ADD CONSTRAINT "Treatment_price_chk"
  CHECK ("defaultUnitPrice" IS NULL OR "defaultUnitPrice" >= 0);
CREATE TRIGGER "TreatmentCategory_no_delete"
  BEFORE DELETE ON "TreatmentCategory"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER "Treatment_no_delete"
  BEFORE DELETE ON "Treatment"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- Plan amounts (ADR-0028 K4-04): USD only; a line is quantity x unit price,
-- rounded half-up to cents, less a discount that never exceeds it.
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_amounts_chk"
  CHECK ("subtotal" >= 0 AND "discountTotal" >= 0 AND "estimatedTotal" >= 0 AND "currency" = 'USD');

ALTER TABLE "TreatmentPlanItem" ADD CONSTRAINT "TreatmentPlanItem_amounts_chk"
  CHECK ("unitPrice" >= 0 AND "discountAmount" >= 0 AND "quantity" > 0
         AND "discountAmount" <= round("quantity" * "unitPrice", 2)
         AND "lineTotal" = round("quantity" * "unitPrice", 2) - "discountAmount");

-- Plan machine (spec 5.4.3; UD-14, ADR-0028 K4-05 to K4-08): the Layer 4 rows;
-- Layer 5 re-creates the edges with the patient-app rows. A plan is created
-- DRAFT and never deleted.
CREATE TRIGGER "TreatmentPlan_created_draft"
  BEFORE INSERT ON "TreatmentPlan"
  FOR EACH ROW WHEN (NEW."status" <> 'DRAFT')
  EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER "TreatmentPlan_status_edges"
  BEFORE UPDATE OF "status" ON "TreatmentPlan"
  FOR EACH ROW EXECUTE FUNCTION app_enforce_status_edges(
    'DRAFT>PROPOSED,PROPOSED>DRAFT,DRAFT>CANCELLED,PROPOSED>ACCEPTED,PROPOSED>DECLINED,ACCEPTED>SCHEDULED,SCHEDULED>COMPLETED,SCHEDULED>CANCELLED');
CREATE TRIGGER "TreatmentPlan_no_delete"
  BEFORE DELETE ON "TreatmentPlan"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- Only a DRAFT plan's content changes (K4-05); a recorded response never
-- changes; a closed plan never changes.
CREATE TRIGGER "TreatmentPlan_frozen_unless_draft"
  BEFORE UPDATE ON "TreatmentPlan"
  FOR EACH ROW WHEN (OLD."status" <> 'DRAFT' AND OLD."respondedAt" IS NULL)
  EXECUTE FUNCTION app_enforce_frozen_columns(
    'status,sentAt,viewedAt,respondedAt,responseSource,responseHandoffId,responseAttestation,responseSignerName,acceptedSiblingId,expiresAt,cancelledAt,cancelledById,cancellationReason,updatedAt,version');
CREATE TRIGGER "TreatmentPlan_frozen_after_response"
  BEFORE UPDATE ON "TreatmentPlan"
  FOR EACH ROW WHEN (OLD."respondedAt" IS NOT NULL)
  EXECUTE FUNCTION app_enforce_frozen_columns('status,cancelledAt,cancelledById,cancellationReason,updatedAt,version');
CREATE TRIGGER "TreatmentPlan_frozen_when_closed"
  BEFORE UPDATE ON "TreatmentPlan"
  FOR EACH ROW WHEN (OLD."status" IN ('DECLINED', 'EXPIRED', 'COMPLETED', 'CANCELLED'))
  EXECUTE FUNCTION app_reject_mutation();

-- A response records its source (K4-06, K4-07): in clinic, the hand-off, the
-- attestation shown and the typed name; a sibling's decline, the accepted option.
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_response_chk"
  CHECK (CASE "responseSource"
           WHEN 'IN_CLINIC' THEN "respondedAt" IS NOT NULL AND "responseHandoffId" IS NOT NULL
                                 AND "responseAttestation" IS NOT NULL AND "responseSignerName" IS NOT NULL
                                 AND "acceptedSiblingId" IS NULL
           WHEN 'PATIENT_APP' THEN "respondedAt" IS NOT NULL AND "responseHandoffId" IS NULL
                                   AND "acceptedSiblingId" IS NULL
           WHEN 'SIBLING_ACCEPTED' THEN "respondedAt" IS NOT NULL AND "status" = 'DECLINED'
                                        AND "acceptedSiblingId" IS NOT NULL AND "acceptedSiblingId" <> "id"
                                        AND num_nonnulls("responseHandoffId", "responseAttestation", "responseSignerName") = 0
           ELSE num_nonnulls("respondedAt", "responseHandoffId", "responseAttestation", "responseSignerName",
                             "acceptedSiblingId") = 0
         END);
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_responded_chk"
  CHECK ("status" NOT IN ('ACCEPTED', 'DECLINED', 'SCHEDULED', 'COMPLETED') OR "responseSource" IS NOT NULL);
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_cancelled_chk"
  CHECK ("status" <> 'CANCELLED' OR ("cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL
                                     AND "cancellationReason" IS NOT NULL));

-- At most one option of a consultation is accepted (K4-07).
CREATE UNIQUE INDEX "TreatmentPlan_one_accepted_option"
  ON "TreatmentPlan" ("consultationId")
  WHERE "consultationId" IS NOT NULL AND "status" IN ('ACCEPTED', 'SCHEDULED', 'COMPLETED');

-- An in-clinic response names a hand-off of this plan; a sibling's decline names
-- an accepted option of the same consultation; completion needs every linked
-- procedure closed, at least one done (K4-06 to K4-08).
CREATE OR REPLACE FUNCTION app_treatment_plan_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."responseHandoffId" IS NOT NULL AND OLD."responseHandoffId" IS NULL
     AND NOT EXISTS (SELECT 1 FROM "PatientHandoff"
                     WHERE id = NEW."responseHandoffId" AND "treatmentPlanId" = NEW.id) THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: an in-clinic response names a hand-off of this plan'
      USING ERRCODE = 'AE001';
  END IF;
  IF NEW."responseSource" = 'SIBLING_ACCEPTED' AND OLD."responseSource" IS NULL
     AND (NEW."consultationId" IS NULL OR NOT EXISTS (
           SELECT 1 FROM "TreatmentPlan"
           WHERE id = NEW."acceptedSiblingId" AND "consultationId" = NEW."consultationId" AND status = 'ACCEPTED')) THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: a sibling decline names an accepted option of the same consultation'
      USING ERRCODE = 'AE001';
  END IF;
  IF NEW.status = 'COMPLETED' AND OLD.status <> 'COMPLETED'
     AND (EXISTS (SELECT 1 FROM "Procedure" pr JOIN "TreatmentPlanItem" i ON i.id = pr."treatmentPlanItemId"
                  WHERE i."treatmentPlanId" = NEW.id AND pr.status IN ('PLANNED', 'SCHEDULED'))
          OR NOT EXISTS (SELECT 1 FROM "Procedure" pr JOIN "TreatmentPlanItem" i ON i.id = pr."treatmentPlanItemId"
                         WHERE i."treatmentPlanId" = NEW.id AND pr.status = 'COMPLETED')) THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: a plan completes when its procedures are closed and at least one is completed'
      USING ERRCODE = 'AE001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "TreatmentPlan_rules"
  BEFORE UPDATE ON "TreatmentPlan"
  FOR EACH ROW EXECUTE FUNCTION app_treatment_plan_rules();

-- Items change only while their plan is a DRAFT, and keep their plan (K4-05).
CREATE OR REPLACE FUNCTION app_treatment_plan_item_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  item "TreatmentPlanItem" := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."treatmentPlanId" <> NEW."treatmentPlanId" THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: a plan item keeps its plan' USING ERRCODE = 'AE001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "TreatmentPlan" WHERE id = item."treatmentPlanId" AND status = 'DRAFT') THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: the items of a plan change only while it is a DRAFT'
      USING ERRCODE = 'AE001';
  END IF;
  RETURN item;
END;
$$;
CREATE TRIGGER "TreatmentPlanItem_draft_only"
  BEFORE INSERT OR UPDATE OR DELETE ON "TreatmentPlanItem"
  FOR EACH ROW EXECUTE FUNCTION app_treatment_plan_item_rules();

-- Procedure machine (spec 5.4.10; ADR-0028 K4-09): created PLANNED, never
-- deleted, frozen once closed.
CREATE TRIGGER "Procedure_created_planned"
  BEFORE INSERT ON "Procedure"
  FOR EACH ROW WHEN (NEW."status" <> 'PLANNED')
  EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER "Procedure_status_edges"
  BEFORE UPDATE OF "status" ON "Procedure"
  FOR EACH ROW EXECUTE FUNCTION app_enforce_status_edges(
    'PLANNED>SCHEDULED,SCHEDULED>COMPLETED,PLANNED>CANCELLED,SCHEDULED>CANCELLED');
CREATE TRIGGER "Procedure_frozen_when_closed"
  BEFORE UPDATE ON "Procedure"
  FOR EACH ROW WHEN (OLD."status" IN ('COMPLETED', 'CANCELLED'))
  EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER "Procedure_no_delete"
  BEFORE DELETE ON "Procedure"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_scheduled_chk"
  CHECK ("status" NOT IN ('SCHEDULED', 'COMPLETED') OR "scheduledFor" IS NOT NULL);
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_completed_chk"
  CHECK ("status" <> 'COMPLETED' OR ("performedByUserId" IS NOT NULL AND "performedAt" IS NOT NULL));
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_cancelled_chk"
  CHECK ("status" <> 'CANCELLED' OR ("cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL
                                     AND "cancellationReason" IS NOT NULL));

ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_amounts_chk"
  CHECK ("subtotal" >= 0 AND "discountTotal" >= 0 AND "total" >= 0 AND "currency" = 'USD');

ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_issued_chk"
  CHECK ("status" = 'DRAFT' OR "issuedAt" IS NOT NULL);

-- Superseding and voiding are recorded; a void needs a reason (ADR-0028 K4-10).
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_superseded_chk"
  CHECK ("status" <> 'SUPERSEDED' OR "supersededAt" IS NOT NULL);
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_void_chk"
  CHECK ("status" <> 'VOID' OR ("voidedAt" IS NOT NULL AND "voidedById" IS NOT NULL AND "voidReason" IS NOT NULL));

-- An issued estimate is frozen and can only be superseded or voided.
CREATE TRIGGER "Estimate_issued_frozen"
  BEFORE UPDATE ON "Estimate"
  FOR EACH ROW WHEN (OLD."status" <> 'DRAFT')
  EXECUTE FUNCTION app_enforce_frozen_columns('status,supersededAt,voidedAt,voidedById,voidReason,updatedAt');
CREATE TRIGGER "Estimate_status_forward_only"
  BEFORE UPDATE ON "Estimate"
  FOR EACH ROW WHEN (OLD."status" <> 'DRAFT')
  EXECUTE FUNCTION app_enforce_status_edges('ISSUED>SUPERSEDED,ISSUED>VOID');
CREATE TRIGGER "Estimate_no_delete"
  BEFORE DELETE ON "Estimate"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- A plan has at most one current estimate, issued only while it is PROPOSED,
-- ACCEPTED or SCHEDULED (K4-10).
CREATE UNIQUE INDEX "Estimate_one_issued"
  ON "Estimate" ("treatmentPlanId") WHERE "status" = 'ISSUED';
CREATE OR REPLACE FUNCTION app_estimate_issued_for_live_plan() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR OLD.status <> 'ISSUED')
     AND NOT EXISTS (SELECT 1 FROM "TreatmentPlan" WHERE id = NEW."treatmentPlanId"
                     AND status IN ('PROPOSED', 'ACCEPTED', 'SCHEDULED')) THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: an estimate is issued for a PROPOSED, ACCEPTED or SCHEDULED plan'
      USING ERRCODE = 'AE001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Estimate_issued_for_live_plan"
  BEFORE INSERT OR UPDATE OF "status" ON "Estimate"
  FOR EACH ROW WHEN (NEW."status" = 'ISSUED')
  EXECUTE FUNCTION app_estimate_issued_for_live_plan();

-- re-created: SIGNED_CONSENT evidence, and only it, cites a consent (ADR-0028 K4-19).
ALTER TABLE "PhotoPermission" DROP CONSTRAINT "PhotoPermission_evidence_chk";
ALTER TABLE "PhotoPermission" ADD CONSTRAINT "PhotoPermission_evidence_chk"
  CHECK (("evidence" IS NOT DISTINCT FROM 'SIGNED_CONSENT') = ("evidenceConsentAssignmentId" IS NOT NULL));

-- The cited consent is COMPLETE (the composite FK keeps it the same patient's).
CREATE OR REPLACE FUNCTION app_permission_evidence_complete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ConsentAssignment"
                 WHERE id = NEW."evidenceConsentAssignmentId" AND status = 'COMPLETE') THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: SIGNED_CONSENT evidence cites a COMPLETE consent'
      USING ERRCODE = 'AE001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PhotoPermission_evidence_complete"
  BEFORE INSERT ON "PhotoPermission"
  FOR EACH ROW WHEN (NEW."evidenceConsentAssignmentId" IS NOT NULL)
  EXECUTE FUNCTION app_permission_evidence_complete();

ALTER TABLE "ConsentTemplateVersion" ADD CONSTRAINT "ConsentTemplateVersion_published_chk"
  CHECK ("status" = 'DRAFT'
         OR ("publishedAt" IS NOT NULL AND "publishedById" IS NOT NULL AND "contentHash" IS NOT NULL));

-- The hash is the hex SHA-256 of the RFC 8785 canonical content (ADR-0028 K4-11).
ALTER TABLE "ConsentTemplateVersion" ADD CONSTRAINT "ConsentTemplateVersion_hash_chk"
  CHECK ("contentHash" IS NULL OR "contentHash" ~ '^[0-9a-f]{64}$');

-- Only one editable draft per template at a time.
CREATE UNIQUE INDEX "ConsentTemplateVersion_one_draft"
  ON "ConsentTemplateVersion" ("templateId") WHERE "status" = 'DRAFT';

-- Publishing freezes content (Bible 12.2); only PUBLISHED -> RETIRED remains.
CREATE TRIGGER "ConsentTemplateVersion_published_frozen"
  BEFORE UPDATE ON "ConsentTemplateVersion"
  FOR EACH ROW WHEN (OLD."status" <> 'DRAFT')
  EXECUTE FUNCTION app_enforce_frozen_columns('status,updatedAt');
CREATE TRIGGER "ConsentTemplateVersion_status_forward_only"
  BEFORE UPDATE ON "ConsentTemplateVersion"
  FOR EACH ROW WHEN (OLD."status" <> 'DRAFT')
  EXECUTE FUNCTION app_enforce_status_edges('PUBLISHED>RETIRED');
CREATE TRIGGER "ConsentTemplate_no_delete"
  BEFORE DELETE ON "ConsentTemplate"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

ALTER TABLE "ConsentAssignment" ADD CONSTRAINT "ConsentAssignment_complete_chk"
  CHECK ("status" <> 'COMPLETE'
         OR ("completedAt" IS NOT NULL AND "signedDocumentVersionId" IS NOT NULL AND "signedSnapshotHash" IS NOT NULL));

-- A void needs its actor and a reason of at most 500 characters (ADR-0028 K4-16).
ALTER TABLE "ConsentAssignment" ADD CONSTRAINT "ConsentAssignment_voided_chk"
  CHECK ("status" <> 'VOIDED' OR ("voidedAt" IS NOT NULL AND "voidedById" IS NOT NULL AND "voidReason" IS NOT NULL));
ALTER TABLE "ConsentAssignment" ADD CONSTRAINT "ConsentAssignment_void_reason_chk"
  CHECK ("voidReason" IS NULL OR char_length("voidReason") <= 500);

ALTER TABLE "ConsentAssignment" ADD CONSTRAINT "ConsentAssignment_superseded_chk"
  CHECK ("status" <> 'SUPERSEDED' OR ("supersededAt" IS NOT NULL AND "supersededByAssignmentId" IS NOT NULL));

ALTER TABLE "ConsentAssignment" ADD CONSTRAINT "ConsentAssignment_hash_chk"
  CHECK ("signedSnapshotHash" IS NULL OR "signedSnapshotHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "ConsentAssignment" ADD CONSTRAINT "ConsentAssignment_not_self_chk"
  CHECK ("replacesAssignmentId" IS DISTINCT FROM "id" AND "supersededByAssignmentId" IS DISTINCT FROM "id");

-- Consent machine (spec 5.4.4; UD-23, ADR-0028 K4-12): created DRAFT, the whole
-- transition table, never deleted.
CREATE TRIGGER "ConsentAssignment_created_draft"
  BEFORE INSERT ON "ConsentAssignment"
  FOR EACH ROW WHEN (NEW."status" <> 'DRAFT')
  EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER "ConsentAssignment_status_edges"
  BEFORE UPDATE OF "status" ON "ConsentAssignment"
  FOR EACH ROW EXECUTE FUNCTION app_enforce_status_edges(
    'DRAFT>ASSIGNED,DRAFT>VOIDED,ASSIGNED>VIEWED,VIEWED>IN_PROGRESS,IN_PROGRESS>SIGNED_BY_PATIENT,SIGNED_BY_PATIENT>SIGNED_BY_PROVIDER,SIGNED_BY_PROVIDER>COMPLETE,SIGNED_BY_PATIENT>COMPLETE,COMPLETE>VOIDED,COMPLETE>SUPERSEDED,ASSIGNED>VOIDED,VIEWED>VOIDED,IN_PROGRESS>VOIDED,SIGNED_BY_PATIENT>VOIDED,SIGNED_BY_PROVIDER>VOIDED');
CREATE TRIGGER "ConsentAssignment_no_delete"
  BEFORE DELETE ON "ConsentAssignment"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- Once the patient has signed, the responses are frozen.
CREATE TRIGGER "ConsentAssignment_signed_frozen"
  BEFORE UPDATE ON "ConsentAssignment"
  FOR EACH ROW WHEN (OLD."status" IN ('SIGNED_BY_PATIENT', 'SIGNED_BY_PROVIDER'))
  EXECUTE FUNCTION app_enforce_frozen_columns(
    'status,providerSignedAt,completedAt,signedDocumentVersionId,signedSnapshotHash,voidedAt,voidedById,voidReason,updatedAt,version');

-- Executed consents never change (Bible 12.2 / 12.3): content is frozen and the
-- status can only move COMPLETE -> VOIDED | SUPERSEDED (both terminal), so a
-- signed consent can never be reopened, edited and re-completed.
CREATE TRIGGER "ConsentAssignment_executed_frozen"
  BEFORE UPDATE ON "ConsentAssignment"
  FOR EACH ROW WHEN (OLD."status" IN ('COMPLETE', 'VOIDED', 'SUPERSEDED'))
  EXECUTE FUNCTION app_enforce_frozen_columns(
    'status,voidedAt,voidedById,voidReason,supersededAt,supersededByAssignmentId,updatedAt,version');

-- A consent is prepared from a PUBLISHED version of a template that is not
-- retired, keeps its patient, version and the consent it replaces, and a
-- replacement uses the same template as the COMPLETE consent it replaces
-- (ADR-0028 K4-11, K4-12, K4-16).
CREATE OR REPLACE FUNCTION app_consent_assignment_origin() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (OLD."patientId", OLD."templateVersionId", OLD."replacesAssignmentId")
       IS DISTINCT FROM (NEW."patientId", NEW."templateVersionId", NEW."replacesAssignmentId") THEN
      RAISE EXCEPTION 'IMMUTABLE_RECORD: a consent keeps its patient, template version and the consent it replaces'
        USING ERRCODE = 'AE001';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "ConsentTemplateVersion" v JOIN "ConsentTemplate" t ON t.id = v."templateId"
                 WHERE v.id = NEW."templateVersionId" AND v.status = 'PUBLISHED' AND t."retiredAt" IS NULL) THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: a consent is prepared from a PUBLISHED version of a current template'
      USING ERRCODE = 'AE001';
  END IF;
  IF NEW."replacesAssignmentId" IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM "ConsentAssignment" replaced
       JOIN "ConsentTemplateVersion" rv ON rv.id = replaced."templateVersionId"
       JOIN "ConsentTemplateVersion" nv ON nv.id = NEW."templateVersionId"
       WHERE replaced.id = NEW."replacesAssignmentId" AND replaced.status = 'COMPLETE' AND rv."templateId" = nv."templateId") THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: a replacement replaces a COMPLETE consent of the same template'
      USING ERRCODE = 'AE001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ConsentAssignment_origin"
  BEFORE INSERT OR UPDATE ON "ConsentAssignment"
  FOR EACH ROW EXECUTE FUNCTION app_consent_assignment_origin();

-- One open replacement per consent.
CREATE UNIQUE INDEX "ConsentAssignment_one_replacement"
  ON "ConsentAssignment" ("replacesAssignmentId")
  WHERE "replacesAssignmentId" IS NOT NULL AND "status" <> 'VOIDED';

-- Completion, supersession and voiding (ADR-0028 K4-15, K4-16, K4-19): the
-- snapshot is a SIGNED_CONSENT version whose SHA-256 is the stored hash; a
-- consent is superseded by the COMPLETE replacement that names it; a consent
-- that a current grant cites as evidence is not voided.
CREATE OR REPLACE FUNCTION app_consent_assignment_execution() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."signedDocumentVersionId" IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD."signedDocumentVersionId" IS NULL
          OR NEW."signedSnapshotHash" IS DISTINCT FROM OLD."signedSnapshotHash")
     AND NOT EXISTS (SELECT 1 FROM "DocumentVersion" dv JOIN "Document" d ON d.id = dv."documentId"
                     WHERE dv.id = NEW."signedDocumentVersionId" AND d.type = 'SIGNED_CONSENT'
                       AND dv.sha256 = NEW."signedSnapshotHash") THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: the signed snapshot is a SIGNED_CONSENT document version with the stored hash'
      USING ERRCODE = 'AE001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'SUPERSEDED' AND OLD.status <> 'SUPERSEDED'
     AND NOT EXISTS (SELECT 1 FROM "ConsentAssignment"
                     WHERE id = NEW."supersededByAssignmentId" AND "replacesAssignmentId" = NEW.id
                       AND status = 'COMPLETE') THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: a consent is superseded by the completed replacement that names it'
      USING ERRCODE = 'AE001';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'VOIDED' AND OLD.status = 'COMPLETE'
     AND EXISTS (SELECT 1 FROM "PhotoPermission"
                 WHERE "evidenceConsentAssignmentId" = NEW.id AND "supersededAt" IS NULL AND state = 'GRANTED') THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: a consent cited by a current media-permission grant cannot be voided'
      USING ERRCODE = 'AE001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ConsentAssignment_execution"
  BEFORE INSERT OR UPDATE ON "ConsentAssignment"
  FOR EACH ROW EXECUTE FUNCTION app_consent_assignment_execution();

CREATE TRIGGER "ConsentSignature_append_only"
  BEFORE UPDATE OR DELETE ON "ConsentSignature"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- A signature given in a hand-off names a hand-off of that consent (UD-31).
CREATE OR REPLACE FUNCTION app_consent_signature_handoff() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "PatientHandoff"
                 WHERE id = NEW."handoffId" AND "consentAssignmentId" = NEW."consentAssignmentId") THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: a signature names a hand-off of its own consent'
      USING ERRCODE = 'AE001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ConsentSignature_handoff_scope"
  BEFORE INSERT ON "ConsentSignature"
  FOR EACH ROW WHEN (NEW."handoffId" IS NOT NULL)
  EXECUTE FUNCTION app_consent_signature_handoff();

-- In-clinic hand-off (UD-31; ADR-0028 K4-13): one target matching its purpose,
-- at most 60 minutes, bound to the opener's session and device, ended once.
ALTER TABLE "PatientHandoff" ADD CONSTRAINT "PatientHandoff_target_chk"
  CHECK (("purpose" = 'CONSENT_SIGNING' AND "consentAssignmentId" IS NOT NULL AND "treatmentPlanId" IS NULL)
      OR ("purpose" = 'PLAN_RESPONSE' AND "treatmentPlanId" IS NOT NULL AND "consentAssignmentId" IS NULL));
ALTER TABLE "PatientHandoff" ADD CONSTRAINT "PatientHandoff_lifetime_chk"
  CHECK ("absoluteExpiresAt" > "openedAt" AND "absoluteExpiresAt" <= "openedAt" + interval '60 minutes'
         AND "identityConfirmedAt" <= "openedAt" AND "lastActivityAt" >= "openedAt");
ALTER TABLE "PatientHandoff" ADD CONSTRAINT "PatientHandoff_ended_chk"
  CHECK (("endedAt" IS NULL) = ("endReason" IS NULL));
ALTER TABLE "PatientHandoff" ADD CONSTRAINT "PatientHandoff_token_chk"
  CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION app_patient_handoff_session() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Session"
                 WHERE id = NEW."sessionId" AND "userId" = NEW."openedById" AND "deviceId" = NEW."deviceId") THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: a hand-off is bound to the opener''s session and device'
      USING ERRCODE = 'AE001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PatientHandoff_bound_to_session"
  BEFORE INSERT ON "PatientHandoff"
  FOR EACH ROW EXECUTE FUNCTION app_patient_handoff_session();
CREATE TRIGGER "PatientHandoff_open_changes"
  BEFORE UPDATE ON "PatientHandoff"
  FOR EACH ROW WHEN (OLD."endedAt" IS NULL)
  EXECUTE FUNCTION app_enforce_frozen_columns('lastActivityAt,endedAt,endReason');
CREATE TRIGGER "PatientHandoff_ended_frozen"
  BEFORE UPDATE ON "PatientHandoff"
  FOR EACH ROW WHEN (OLD."endedAt" IS NOT NULL)
  EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER "PatientHandoff_no_delete"
  BEFORE DELETE ON "PatientHandoff"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

CREATE UNIQUE INDEX "EducationContentVersion_one_draft"
  ON "EducationContentVersion" ("contentId") WHERE "status" = 'DRAFT';

-- Publishing records who and when, and the content's source and licence
-- (Bible 0.1; ADR-0028 K4-17).
ALTER TABLE "EducationContentVersion" ADD CONSTRAINT "EducationContentVersion_published_chk"
  CHECK ("status" = 'DRAFT'
         OR ("publishedAt" IS NOT NULL AND "publishedById" IS NOT NULL
             AND "source" IS NOT NULL AND "license" IS NOT NULL));

CREATE TRIGGER "EducationContentVersion_published_frozen"
  BEFORE UPDATE ON "EducationContentVersion"
  FOR EACH ROW WHEN (OLD."status" <> 'DRAFT')
  EXECUTE FUNCTION app_enforce_frozen_columns('status,updatedAt');
CREATE TRIGGER "EducationContentVersion_status_forward_only"
  BEFORE UPDATE ON "EducationContentVersion"
  FOR EACH ROW WHEN (OLD."status" <> 'DRAFT')
  EXECUTE FUNCTION app_enforce_status_edges('PUBLISHED>RETIRED');
CREATE TRIGGER "EducationContent_no_delete"
  BEFORE DELETE ON "EducationContent"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- Assignments and instructions point at PUBLISHED versions (F-65; ADR-0028
-- K4-18); an instruction at pre-op or post-op instruction content.
CREATE OR REPLACE FUNCTION app_content_version_published() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "EducationContentVersion" v JOIN "EducationContent" c ON c.id = v."contentId"
                 WHERE v.id = NEW."contentVersionId" AND v.status = 'PUBLISHED'
                   AND (TG_ARGV[0] IS DISTINCT FROM 'instruction'
                        OR c."contentType" IN ('PRE_OP_INSTRUCTION', 'POST_OP_INSTRUCTION'))) THEN
    RAISE EXCEPTION 'IMMUTABLE_RECORD: % points at a PUBLISHED version of suitable content', TG_TABLE_NAME
      USING ERRCODE = 'AE001';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ContentAssignment_published_only"
  BEFORE INSERT OR UPDATE OF "contentVersionId" ON "ContentAssignment"
  FOR EACH ROW EXECUTE FUNCTION app_content_version_published('assignment');
CREATE TRIGGER "PatientInstruction_published_only"
  BEFORE INSERT OR UPDATE OF "contentVersionId" ON "PatientInstruction"
  FOR EACH ROW EXECUTE FUNCTION app_content_version_published('instruction');

-- "Assigned by procedure or consultation" (Bible 12.6).
ALTER TABLE "PatientInstruction" ADD CONSTRAINT "PatientInstruction_context_chk"
  CHECK (num_nonnulls("procedureId", "consultationId") >= 1);

-- Clinical completion records who and when (Bible 12.6).
ALTER TABLE "PatientInstruction" ADD CONSTRAINT "PatientInstruction_completed_chk"
  CHECK (("clinicalCompletedAt" IS NULL) = ("clinicalCompletedById" IS NULL));

-- Patient exports (ADR-0028 K4-21): one patient in Layer 4 (re-created if an
-- organization-wide export is approved); OTHER needs a note; the 5.4.10 machine.
ALTER TABLE "DataExportJob" ADD CONSTRAINT "DataExportJob_completed_chk"
  CHECK ("status" <> 'COMPLETED' OR ("resultObjectId" IS NOT NULL AND "completedAt" IS NOT NULL AND "expiresAt" IS NOT NULL));
ALTER TABLE "DataExportJob" ADD CONSTRAINT "DataExportJob_patient_chk"
  CHECK ("patientId" IS NOT NULL);
ALTER TABLE "DataExportJob" ADD CONSTRAINT "DataExportJob_purpose_chk"
  CHECK ("purpose" <> 'OTHER' OR btrim(coalesce("purposeNote", '')) <> '');
CREATE TRIGGER "DataExportJob_created_requested"
  BEFORE INSERT ON "DataExportJob"
  FOR EACH ROW WHEN (NEW."status" <> 'REQUESTED')
  EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER "DataExportJob_status_edges"
  BEFORE UPDATE OF "status" ON "DataExportJob"
  FOR EACH ROW EXECUTE FUNCTION app_enforce_status_edges(
    'REQUESTED>RUNNING,RUNNING>COMPLETED,RUNNING>FAILED,COMPLETED>EXPIRED,REQUESTED>CANCELLED');


-- #############################################################################
-- LAYER 5 - Patient app & messaging
-- #############################################################################

-- re-created: the plan machine gains the patient-app rows of spec 5.4.3 (/send,
-- viewing, the patient's response, expiry) and sibling declines from them
-- (ADR-0028 K4-05, K4-07).
DROP TRIGGER "TreatmentPlan_status_edges" ON "TreatmentPlan";
CREATE TRIGGER "TreatmentPlan_status_edges"
  BEFORE UPDATE OF "status" ON "TreatmentPlan"
  FOR EACH ROW EXECUTE FUNCTION app_enforce_status_edges(
    'DRAFT>PROPOSED,PROPOSED>DRAFT,DRAFT>CANCELLED,PROPOSED>ACCEPTED,PROPOSED>DECLINED,ACCEPTED>SCHEDULED,SCHEDULED>COMPLETED,SCHEDULED>CANCELLED,PROPOSED>SENT_TO_PATIENT,SENT_TO_PATIENT>VIEWED,VIEWED>ACCEPTED,VIEWED>DECLINED,VIEWED>EXPIRED,SENT_TO_PATIENT>EXPIRED,SENT_TO_PATIENT>DECLINED');

-- FAILED follows SENT (Bible 14.2), so every non-draft message has sentAt.
ALTER TABLE "Message" ADD CONSTRAINT "Message_sent_chk"
  CHECK ("status" = 'DRAFT' OR "sentAt" IS NOT NULL);

ALTER TABLE "Message" ADD CONSTRAINT "Message_failed_chk"
  CHECK ("status" <> 'FAILED' OR "failedAt" IS NOT NULL);


-- #############################################################################
-- LAYER 6 - Scheduling & telehealth
-- #############################################################################

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_time_range_chk"
  CHECK ("endsAt" > "startsAt");

ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_cancelled_chk"
  CHECK ("status" <> 'CANCELLED' OR "cancelledAt" IS NOT NULL);

-- No integrations exist before Layer 10 (re-created there).
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_integration_source_chk"
  CHECK ("sourceSystem" <> 'INTEGRATION');


-- #############################################################################
-- LAYER 7 - AI infrastructure
-- #############################################################################

-- A production model is never silently replaced (Bible 9.7): registry identity
-- and version content are immutable; only lifecycle columns move.
CREATE TRIGGER "AIModel_identity_immutable"
  BEFORE UPDATE ON "AIModel"
  FOR EACH ROW EXECUTE FUNCTION app_enforce_frozen_columns('name,description,updatedAt');

CREATE TRIGGER "AIModelVersion_immutable"
  BEFORE UPDATE ON "AIModelVersion"
  FOR EACH ROW EXECUTE FUNCTION app_enforce_frozen_columns('status,validationSummary,validatedAt,retiredAt');

CREATE UNIQUE INDEX "AIModelRollout_one_active"
  ON "AIModelRollout" ("modelId", "organizationId") NULLS NOT DISTINCT
  WHERE "state" = 'ACTIVE';

ALTER TABLE "AIModelRollout" ADD CONSTRAINT "AIModelRollout_state_chk"
  CHECK (("state" = 'INACTIVE') = ("deactivatedAt" IS NOT NULL));

-- Rollout history is never rewritten: an ACTIVE row may only be deactivated
-- (ACTIVE -> INACTIVE, one way); re-activation or rollback inserts a new row.
CREATE TRIGGER "AIModelRollout_history_frozen"
  BEFORE UPDATE ON "AIModelRollout"
  FOR EACH ROW EXECUTE FUNCTION app_enforce_frozen_columns('state,deactivatedAt');
CREATE TRIGGER "AIModelRollout_deactivate_only"
  BEFORE UPDATE ON "AIModelRollout"
  FOR EACH ROW WHEN (NOT (OLD."state" = 'ACTIVE' AND NEW."state" = 'INACTIVE'))
  EXECUTE FUNCTION app_reject_mutation();
CREATE TRIGGER "AIModelRollout_no_delete"
  BEFORE DELETE ON "AIModelRollout"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- Simulation outputs are validated from Layer 8 (re-created there).
ALTER TABLE "AIValidationRecord" ADD CONSTRAINT "AIValidationRecord_subject_chk"
  CHECK (num_nonnulls("aiJobId", "modelVersionId") >= 1);

-- Job validations are tenant data; closes the MATCH SIMPLE gap.
ALTER TABLE "AIValidationRecord" ADD CONSTRAINT "AIValidationRecord_tenant_chk"
  CHECK ("aiJobId" IS NULL OR "organizationId" IS NOT NULL);


-- #############################################################################
-- LAYER 8 - Outcome simulation
-- #############################################################################

-- Provenance core of a generation never changes; after completion nothing does.
CREATE TRIGGER "SimulationVersion_provenance_immutable"
  BEFORE UPDATE ON "SimulationVersion"
  FOR EACH ROW WHEN (OLD."completedAt" IS NULL)
  EXECUTE FUNCTION app_enforce_frozen_columns('aiJobId,outputDerivativeId,maskObjectId,completedAt');
CREATE TRIGGER "SimulationVersion_completed_immutable"
  BEFORE UPDATE ON "SimulationVersion"
  FOR EACH ROW WHEN (OLD."completedAt" IS NOT NULL)
  EXECUTE FUNCTION app_reject_mutation();

ALTER TABLE "SimulationParameter" ADD CONSTRAINT "SimulationParameter_single_value_chk"
  CHECK (num_nonnulls("numericValue", "optionValue") = 1);

-- Parameters are provenance (Bible 9.4): written once at /generate, never edited.
CREATE TRIGGER "SimulationParameter_append_only"
  BEFORE UPDATE OR DELETE ON "SimulationParameter"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

ALTER TABLE "Simulation" ADD CONSTRAINT "Simulation_released_chk"
  CHECK ("status" <> 'RELEASED_TO_PATIENT'
         OR ("releasedVersionId" IS NOT NULL AND "releasedAt" IS NOT NULL AND "releasedById" IS NOT NULL));

-- Review decisions are an append-only ledger.
CREATE TRIGGER "SimulationApproval_append_only"
  BEFORE UPDATE OR DELETE ON "SimulationApproval"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

-- re-created: simulations become releasable subjects.
ALTER TABLE "MediaRelease" DROP CONSTRAINT "MediaRelease_single_subject_chk";
ALTER TABLE "MediaRelease" ADD CONSTRAINT "MediaRelease_single_subject_chk"
  CHECK (num_nonnulls("photoId", "derivativeId", "beforeAfterSetId", "simulationId") = 1);

-- re-created: simulation outputs are validation subjects too.
ALTER TABLE "AIValidationRecord" DROP CONSTRAINT "AIValidationRecord_subject_chk";
ALTER TABLE "AIValidationRecord" ADD CONSTRAINT "AIValidationRecord_subject_chk"
  CHECK (num_nonnulls("aiJobId", "simulationVersionId", "modelVersionId") >= 1);
ALTER TABLE "AIValidationRecord" DROP CONSTRAINT "AIValidationRecord_tenant_chk";
ALTER TABLE "AIValidationRecord" ADD CONSTRAINT "AIValidationRecord_tenant_chk"
  CHECK (("aiJobId" IS NULL AND "simulationVersionId" IS NULL) OR "organizationId" IS NOT NULL);


-- #############################################################################
-- LAYER 9 - Similar cases & outcome analysis
-- #############################################################################
-- (No constraints beyond schema.prisma; library scope and authorization are
-- enforced by composite FKs to Practice and MediaRelease.)


-- #############################################################################
-- LAYER 10 - Integrations
-- #############################################################################

-- re-created: integration-sourced appointments must carry their mapping.
ALTER TABLE "Appointment" DROP CONSTRAINT "Appointment_integration_source_chk";
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_integration_source_chk"
  CHECK ("sourceSystem" <> 'INTEGRATION' OR ("integrationId" IS NOT NULL AND "externalId" IS NOT NULL));
