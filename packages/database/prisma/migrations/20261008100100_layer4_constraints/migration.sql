-- Layer 4 constraints beyond Prisma: the plan, procedure, consent and export
-- machines; frozen plan content and line totals; estimates; consent preparation,
-- supersession, voiding and the snapshot hash; the in-clinic hand-off; the
-- SIGNED_CONSENT evidence check; published-only assignments (ADR-0028). Copied
-- verbatim from the LAYER 4 fragment of docs/technical-spec/constraints.sql;
-- scripts/check-migrations.ts fails CI if the two ever differ.

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
