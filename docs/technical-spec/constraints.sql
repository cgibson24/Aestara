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

ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_completed_chk"
  CHECK ("status" <> 'COMPLETED' OR ("completedAt" IS NOT NULL AND "completedById" IS NOT NULL));

ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_archived_chk"
  CHECK ("status" <> 'ARCHIVED' OR "archivedAt" IS NOT NULL);

ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_cancelled_chk"
  CHECK ("status" <> 'CANCELLED' OR "cancelledAt" IS NOT NULL);

ALTER TABLE "ConsultationNote" ADD CONSTRAINT "ConsultationNote_final_chk"
  CHECK (("status" = 'FINAL') = ("finalizedAt" IS NOT NULL));

-- [P] A FINAL note is immutable; corrections are new notes (UD-15).
CREATE TRIGGER "ConsultationNote_final_immutable"
  BEFORE UPDATE ON "ConsultationNote"
  FOR EACH ROW WHEN (OLD."status" = 'FINAL')
  EXECUTE FUNCTION app_reject_mutation();

ALTER TABLE "BeforeAfterSet" ADD CONSTRAINT "BeforeAfterSet_distinct_photos_chk"
  CHECK ("beforePhotoId" <> "afterPhotoId");

ALTER TABLE "BeforeAfterSet" ADD CONSTRAINT "BeforeAfterSet_registration_chk"
  CHECK ("registrationMode" <> 'NONE' OR "registrationTransform" IS NULL);

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

ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_amounts_chk"
  CHECK ("subtotal" >= 0 AND "discountTotal" >= 0 AND "estimatedTotal" >= 0);

ALTER TABLE "TreatmentPlanItem" ADD CONSTRAINT "TreatmentPlanItem_amounts_chk"
  CHECK ("unitPrice" >= 0 AND "discountAmount" >= 0 AND "lineTotal" >= 0
         AND ("quantity" IS NULL OR "quantity" > 0));

ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_amounts_chk"
  CHECK ("subtotal" >= 0 AND "discountTotal" >= 0 AND "total" >= 0);

ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_issued_chk"
  CHECK ("status" = 'DRAFT' OR "issuedAt" IS NOT NULL);

-- An issued estimate is frozen and can only be superseded or voided.
CREATE TRIGGER "Estimate_issued_frozen"
  BEFORE UPDATE ON "Estimate"
  FOR EACH ROW WHEN (OLD."status" <> 'DRAFT')
  EXECUTE FUNCTION app_enforce_frozen_columns('status,updatedAt');
CREATE TRIGGER "Estimate_status_forward_only"
  BEFORE UPDATE ON "Estimate"
  FOR EACH ROW WHEN (OLD."status" <> 'DRAFT')
  EXECUTE FUNCTION app_enforce_status_edges('ISSUED>SUPERSEDED,ISSUED>VOID');

-- re-created: SIGNED_CONSENT evidence now points at an executed consent.
ALTER TABLE "PhotoPermission" DROP CONSTRAINT "PhotoPermission_evidence_chk";
ALTER TABLE "PhotoPermission" ADD CONSTRAINT "PhotoPermission_evidence_chk"
  CHECK ("evidence" IS DISTINCT FROM 'SIGNED_CONSENT' OR "evidenceConsentAssignmentId" IS NOT NULL);

ALTER TABLE "ConsentTemplateVersion" ADD CONSTRAINT "ConsentTemplateVersion_published_chk"
  CHECK ("status" = 'DRAFT'
         OR ("publishedAt" IS NOT NULL AND "publishedById" IS NOT NULL AND "contentHash" IS NOT NULL));

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

ALTER TABLE "ConsentAssignment" ADD CONSTRAINT "ConsentAssignment_complete_chk"
  CHECK ("status" <> 'COMPLETE'
         OR ("completedAt" IS NOT NULL AND "signedDocumentVersionId" IS NOT NULL AND "signedSnapshotHash" IS NOT NULL));

ALTER TABLE "ConsentAssignment" ADD CONSTRAINT "ConsentAssignment_voided_chk"
  CHECK ("status" <> 'VOIDED' OR ("voidedAt" IS NOT NULL AND "voidedById" IS NOT NULL));

ALTER TABLE "ConsentAssignment" ADD CONSTRAINT "ConsentAssignment_superseded_chk"
  CHECK ("status" <> 'SUPERSEDED' OR "supersededAt" IS NOT NULL);

-- Executed consents never change (Bible 12.2 / 12.3): content is frozen and the
-- status can only move COMPLETE -> VOIDED | SUPERSEDED (both terminal), so a
-- signed consent can never be reopened, edited and re-completed.
CREATE TRIGGER "ConsentAssignment_executed_frozen"
  BEFORE UPDATE ON "ConsentAssignment"
  FOR EACH ROW WHEN (OLD."status" IN ('COMPLETE', 'VOIDED', 'SUPERSEDED'))
  EXECUTE FUNCTION app_enforce_frozen_columns(
    'status,voidedAt,voidedById,voidReason,supersededAt,supersededByAssignmentId,updatedAt,version');
CREATE TRIGGER "ConsentAssignment_executed_status_forward_only"
  BEFORE UPDATE ON "ConsentAssignment"
  FOR EACH ROW WHEN (OLD."status" IN ('COMPLETE', 'VOIDED', 'SUPERSEDED'))
  EXECUTE FUNCTION app_enforce_status_edges('COMPLETE>VOIDED,COMPLETE>SUPERSEDED');

CREATE TRIGGER "ConsentSignature_append_only"
  BEFORE UPDATE OR DELETE ON "ConsentSignature"
  FOR EACH ROW EXECUTE FUNCTION app_reject_mutation();

CREATE UNIQUE INDEX "EducationContentVersion_one_draft"
  ON "EducationContentVersion" ("contentId") WHERE "status" = 'DRAFT';

CREATE TRIGGER "EducationContentVersion_published_frozen"
  BEFORE UPDATE ON "EducationContentVersion"
  FOR EACH ROW WHEN (OLD."status" <> 'DRAFT')
  EXECUTE FUNCTION app_enforce_frozen_columns('status,updatedAt');
CREATE TRIGGER "EducationContentVersion_status_forward_only"
  BEFORE UPDATE ON "EducationContentVersion"
  FOR EACH ROW WHEN (OLD."status" <> 'DRAFT')
  EXECUTE FUNCTION app_enforce_status_edges('PUBLISHED>RETIRED');

-- "Assigned by procedure or consultation" (Bible 12.6).
ALTER TABLE "PatientInstruction" ADD CONSTRAINT "PatientInstruction_context_chk"
  CHECK (num_nonnulls("procedureId", "consultationId") >= 1);

ALTER TABLE "DataExportJob" ADD CONSTRAINT "DataExportJob_completed_chk"
  CHECK ("status" <> 'COMPLETED' OR ("resultObjectId" IS NOT NULL AND "completedAt" IS NOT NULL));


-- #############################################################################
-- LAYER 5 - Patient app & messaging
-- #############################################################################

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
