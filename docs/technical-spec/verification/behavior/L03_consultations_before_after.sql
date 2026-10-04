-- =============================================================================
-- LAYER 3 - Consultations, before/after, documents, image jobs (spec §5.8)
-- =============================================================================
-- =============================================================================
-- A. Tenant isolation (Bible 3.1, 21.2, 36 "Tenancy")
-- =============================================================================
SELECT pg_temp.expect_error($$
  INSERT INTO "Consultation" (id, "organizationId", "patientId", "practiceId", "createdById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0b000000-0000-7000-8000-fd76a7158ec0',
          '0a000000-0000-7000-8000-0000000000a1', '0a000000-0000-7000-8000-bda01469c352', now())$$,
  '23503', 'A1 consultation in org A cannot reference a patient of org B');

-- =============================================================================
-- C. Before/after (Bible 8, 34.1)
-- =============================================================================
-- Two photos of the same patient a month apart (the Layer 2 fixtures share one
-- capture time, and a capture time never changes).
INSERT INTO "StorageObject" (id, "organizationId", "objectClass", bucket, "objectKey", "contentType", sha256, status, "verifiedAt") VALUES
  ('0a000000-0000-7000-8000-3e10486dd301', '0a000000-0000-7000-8000-000000000001', 'CLINICAL_ORIGINAL', 'clinical', 'org-a/o31', 'image/jpeg', repeat('1', 64), 'AVAILABLE', now()),
  ('0a000000-0000-7000-8000-3e10486dd302', '0a000000-0000-7000-8000-000000000001', 'CLINICAL_ORIGINAL', 'clinical', 'org-a/o32', 'image/jpeg', repeat('2', 64), 'AVAILABLE', now());
INSERT INTO "PatientPhoto" (id, "organizationId", "patientId", source, status, "viewKey", "originalObjectId", "capturedAt", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-599a1cc8f301', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871', 'PROVIDER_CAPTURE', 'ACCEPTED', 'FRONT', '0a000000-0000-7000-8000-3e10486dd301', now() - interval '30 days', now()),
  ('0a000000-0000-7000-8000-599a1cc8f302', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871', 'PROVIDER_CAPTURE', 'ACCEPTED', 'FRONT', '0a000000-0000-7000-8000-3e10486dd302', now(), now());

SELECT pg_temp.expect_error($$
  INSERT INTO "BeforeAfterSet" (id, "organizationId", "patientId", "beforePhotoId", "afterPhotoId", "createdById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-599a1cc8f834', '0a000000-0000-7000-8000-6a18a0ed400f',
          '0a000000-0000-7000-8000-bda01469c352', now())$$,
  '23503', 'C5 before/after cannot mix photos of two patients (same tenant)');

SELECT pg_temp.expect_error($$
  INSERT INTO "BeforeAfterSet" (id, "organizationId", "patientId", "beforePhotoId", "afterPhotoId", "createdById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-599a1cc8f834', '0a000000-0000-7000-8000-599a1cc8f834',
          '0a000000-0000-7000-8000-bda01469c352', now())$$,
  '23514', 'C6 before/after requires exactly two different images');

SELECT pg_temp.expect_ok($$
  INSERT INTO "BeforeAfterSet" (id, "organizationId", "patientId", "beforePhotoId", "afterPhotoId", "createdById", "updatedAt")
  VALUES ('0a000000-0000-7000-8000-00000000ba01', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-599a1cc8f301', '0a000000-0000-7000-8000-599a1cc8f302',
          '0a000000-0000-7000-8000-bda01469c352', now())$$,
  'C7 valid same-patient before/after is accepted');

SELECT pg_temp.expect_error($$
  INSERT INTO "BeforeAfterSet" (id, "organizationId", "patientId", "beforePhotoId", "afterPhotoId", "createdById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-599a1cc8f302', '0a000000-0000-7000-8000-599a1cc8f301',
          '0a000000-0000-7000-8000-bda01469c352', now())$$,
  'AE001', 'C15 the before photo must be captured earlier than the after photo');

SELECT pg_temp.expect_error($$
  UPDATE "BeforeAfterSet" SET "afterPhotoId" = '0a000000-0000-7000-8000-0912bad80f96'
  WHERE id = '0a000000-0000-7000-8000-00000000ba01'$$,
  'AE001', 'C16 a before/after set keeps its photos');

SELECT pg_temp.expect_ok($$
  UPDATE "BeforeAfterSet" SET "registrationMode" = 'MANUAL',
         "registrationTransform" = '{"scale": 1.02, "rotationDeg": -1.5, "translateX": 0.01, "translateY": 0}'
  WHERE id = '0a000000-0000-7000-8000-00000000ba01'$$,
  'C17 alignment of a set can change; the photos cannot');

-- =============================================================================
-- D. Media releases
-- =============================================================================
SELECT pg_temp.expect_error($$
  INSERT INTO "MediaRelease" (id, "organizationId", "patientId", purpose, "photoId", "beforeAfterSetId", "releasedById")
  SELECT gen_random_uuid(), p."organizationId", p."patientId", 'WEBSITE', p.id, b.id, (SELECT id FROM "User" WHERE email = 'dr.a@example.test')
  FROM "PatientPhoto" p JOIN "BeforeAfterSet" b ON b."beforePhotoId" = p.id LIMIT 1$$,
  '23514', 'D10 a media release covers exactly one asset');

-- =============================================================================
-- H. Consultations and notes (spec 5.4.1; ADR-0026 K3-01 to K3-07)
-- =============================================================================
SELECT pg_temp.expect_error($$
  INSERT INTO "Consultation" (id, "organizationId", "patientId", "practiceId", status, "createdById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-0000000000a1', 'IN_PROGRESS', '0a000000-0000-7000-8000-bda01469c352', now())$$,
  'AE001', 'H7 a consultation is created DRAFT');

INSERT INTO "Consultation" (id, "organizationId", "patientId", "practiceId", "createdById", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-e60f6eb6f3af', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-0000000000a1', '0a000000-0000-7000-8000-bda01469c352', now());
INSERT INTO "PatientConcern" (id, "organizationId", "patientId", area, description, "updatedAt") VALUES
  ('0a000000-0000-7000-8000-c0c0e7a10001', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   'LIPS', 'Volume', now());

SELECT pg_temp.expect_error($$
  UPDATE "Consultation" SET status = 'COMPLETED', "completedAt" = now(),
         "completedById" = '0a000000-0000-7000-8000-bda01469c352'
  WHERE id = '0a000000-0000-7000-8000-e60f6eb6f3af'$$,
  'AE001', 'H8 a DRAFT consultation cannot jump to COMPLETED');

SELECT pg_temp.expect_error($$
  INSERT INTO "ConsultationNote" (id, "organizationId", "patientId", "consultationId", "authorUserId", body, "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-e60f6eb6f3af', '0a000000-0000-7000-8000-bda01469c352', 'Too early', now())$$,
  'AE001', 'H9 notes are written once the consultation has started');

INSERT INTO "ConsultationConcern" ("organizationId", "patientId", "consultationId", "patientConcernId") VALUES
  ('0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-e60f6eb6f3af', '0a000000-0000-7000-8000-c0c0e7a10001');
UPDATE "Consultation" SET status = 'IN_PROGRESS', "startedAt" = now()
  WHERE id = '0a000000-0000-7000-8000-e60f6eb6f3af';
INSERT INTO "ConsultationNote" (id, "organizationId", "patientId", "consultationId", "authorUserId", status, body, "finalizedAt", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-c10f3290d1af', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-e60f6eb6f3af', '0a000000-0000-7000-8000-bda01469c352', 'FINAL', 'Discussed options.', now(), now()),
  ('0a000000-0000-7000-8000-c10f3290d1b0', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-e60f6eb6f3af', '0a000000-0000-7000-8000-bda01469c352', 'DRAFT', 'Draft to finish.', NULL, now());

SELECT pg_temp.expect_error($$
  UPDATE "ConsultationNote" SET body = 'Rewritten' WHERE id = '0a000000-0000-7000-8000-c10f3290d1af'$$,
  'AE001', 'H2 a FINAL consultation note is immutable');

SELECT pg_temp.expect_error($$
  DELETE FROM "ConsultationNote" WHERE id = '0a000000-0000-7000-8000-c10f3290d1af'$$,
  'AE001', 'H10 a FINAL consultation note is never deleted');

SELECT pg_temp.expect_error($$
  INSERT INTO "ConsultationNote" (id, "organizationId", "patientId", "consultationId", "authorUserId", body, "correctsNoteId", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-e60f6eb6f3af', '0a000000-0000-7000-8000-bda01469c352', 'Correction',
          '0a000000-0000-7000-8000-c10f3290d1b0', now())$$,
  'AE001', 'H11 an addendum corrects a FINAL note, not a draft');

SELECT pg_temp.expect_error($$
  UPDATE "Consultation" SET status = 'READY_FOR_REVIEW', "readyForReviewAt" = now()
  WHERE id = '0a000000-0000-7000-8000-e60f6eb6f3af'$$,
  'AE001', 'H12 a consultation with a draft note cannot go to review');

UPDATE "ConsultationNote" SET status = 'FINAL', "finalizedAt" = now()
  WHERE id = '0a000000-0000-7000-8000-c10f3290d1b0';

SELECT pg_temp.expect_ok($$
  UPDATE "Consultation" SET status = 'READY_FOR_REVIEW', "readyForReviewAt" = now()
  WHERE id = '0a000000-0000-7000-8000-e60f6eb6f3af'$$,
  'H13 IN_PROGRESS may go straight to READY_FOR_REVIEW (UD-28)');

SELECT pg_temp.expect_error($$
  UPDATE "Consultation" SET reason = 'Changed under review'
  WHERE id = '0a000000-0000-7000-8000-e60f6eb6f3af'$$,
  'AE001', 'H14 the reviewed content is frozen in READY_FOR_REVIEW');

SELECT pg_temp.expect_error($$
  DELETE FROM "ConsultationConcern" WHERE "consultationId" = '0a000000-0000-7000-8000-e60f6eb6f3af'$$,
  'AE001', 'H15 the concerns of a consultation under review are frozen');

SELECT pg_temp.expect_error($$
  INSERT INTO "ConsultationNote" (id, "organizationId", "patientId", "consultationId", "authorUserId", body, "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-e60f6eb6f3af', '0a000000-0000-7000-8000-bda01469c352', 'Late note', now())$$,
  'AE001', 'H16 no new note while the consultation is under review');

SELECT pg_temp.expect_error($$
  UPDATE "Consultation" SET status = 'COMPLETED' WHERE id = '0a000000-0000-7000-8000-e60f6eb6f3af'$$,
  '23514', 'H3 COMPLETED requires completion time and actor');

SELECT pg_temp.expect_error($$
  UPDATE "Consultation" SET status = 'COMPLETED', "completedAt" = now(),
         "completedById" = '0a000000-0000-7000-8000-bda01469c352'
  WHERE id = '0a000000-0000-7000-8000-e60f6eb6f3af'$$,
  '23514', 'H17 COMPLETED requires a recorded release decision');

SELECT pg_temp.expect_error($$
  UPDATE "Consultation" SET "releaseDecision" = 'NOTHING_TO_RELEASE'
  WHERE id = '0a000000-0000-7000-8000-e60f6eb6f3af'$$,
  '23514', 'H18 a release decision records when and by whom');

SELECT pg_temp.expect_ok($$
  UPDATE "Consultation" SET status = 'COMPLETED', "completedAt" = now(),
         "completedById" = '0a000000-0000-7000-8000-bda01469c352',
         "releaseDecision" = 'NOTHING_TO_RELEASE', "releaseDecidedAt" = now(),
         "releaseDecidedById" = '0a000000-0000-7000-8000-bda01469c352'
  WHERE id = '0a000000-0000-7000-8000-e60f6eb6f3af'$$,
  'H19 a reviewed consultation completes with its release decision');

SELECT pg_temp.expect_error($$
  UPDATE "Consultation" SET "primaryProviderUserId" = NULL, reason = 'After the fact'
  WHERE id = '0a000000-0000-7000-8000-e60f6eb6f3af'$$,
  'AE001', 'H20 a completed consultation is frozen');

SELECT pg_temp.expect_error($$
  INSERT INTO "ConsultationNote" (id, "organizationId", "patientId", "consultationId", "authorUserId", body, "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-e60f6eb6f3af', '0a000000-0000-7000-8000-bda01469c352', 'Not an addendum', now())$$,
  'AE001', 'H21 after completion only addenda are written');

SELECT pg_temp.expect_ok($$
  INSERT INTO "ConsultationNote" (id, "organizationId", "patientId", "consultationId", "authorUserId", body, "correctsNoteId", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-e60f6eb6f3af', '0a000000-0000-7000-8000-bda01469c352', 'Correction: left side.',
          '0a000000-0000-7000-8000-c10f3290d1af', now())$$,
  'H22 an addendum corrects a FINAL note after completion (UD-15)');

SELECT pg_temp.expect_ok($$
  UPDATE "Consultation" SET status = 'ARCHIVED', "archivedAt" = now()
  WHERE id = '0a000000-0000-7000-8000-e60f6eb6f3af'$$,
  'H23 a completed consultation can be archived');

SELECT pg_temp.expect_error($$
  UPDATE "Consultation" SET status = 'COMPLETED' WHERE id = '0a000000-0000-7000-8000-e60f6eb6f3af'$$,
  'AE001', 'H24 an archived consultation never changes');

INSERT INTO "Consultation" (id, "organizationId", "patientId", "practiceId", "createdById", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-e60f6eb6f3b0', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-0000000000a1', '0a000000-0000-7000-8000-bda01469c352', now());

SELECT pg_temp.expect_error($$
  UPDATE "Consultation" SET status = 'CANCELLED', "cancelledAt" = now(),
         "cancelledById" = '0a000000-0000-7000-8000-bda01469c352'
  WHERE id = '0a000000-0000-7000-8000-e60f6eb6f3b0'$$,
  '23514', 'H25 cancelling records its actor and a reason');

SELECT pg_temp.expect_ok($$
  UPDATE "Consultation" SET status = 'CANCELLED', "cancelledAt" = now(),
         "cancelledById" = '0a000000-0000-7000-8000-bda01469c352', "cancellationReason" = 'Patient rescheduled'
  WHERE id = '0a000000-0000-7000-8000-e60f6eb6f3b0'$$,
  'H26 a non-final consultation can be cancelled with a reason');

SELECT pg_temp.expect_error($$
  UPDATE "Consultation" SET status = 'IN_PROGRESS' WHERE id = '0a000000-0000-7000-8000-e60f6eb6f3b0'$$,
  'AE001', 'H27 a cancelled consultation is never reopened');

SELECT pg_temp.expect_error($$
  DELETE FROM "Consultation" WHERE id = '0a000000-0000-7000-8000-e60f6eb6f3b0'$$,
  'AE001', 'H28 consultations are never deleted');
