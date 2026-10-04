-- Layer 3 constraints beyond Prisma: the consultation machine and its frozen
-- states, final notes and addenda, frozen concern links, the before/after order
-- rule, immutable document versions (ADR-0026). Copied verbatim from the LAYER 3
-- fragment of docs/technical-spec/constraints.sql; scripts/check-migrations.ts
-- fails CI if the two ever differ.

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
