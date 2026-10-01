-- Layer 2 constraints beyond Prisma: the photo and protocol machines, write-once
-- storage objects, versioned media permissions, release pins, the audit feed to
-- the WORM copy (ADR-0023). Copied verbatim from the LAYER 2 fragment of
-- docs/technical-spec/constraints.sql; scripts/check-migrations.ts fails CI if
-- the two ever differ.

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
