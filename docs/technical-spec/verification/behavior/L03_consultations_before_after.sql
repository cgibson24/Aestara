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
          '0a000000-0000-7000-8000-599a1cc8f834', '0a000000-0000-7000-8000-0912bad80f96',
          '0a000000-0000-7000-8000-bda01469c352', now())$$,
  'C7 valid same-patient before/after is accepted');

-- =============================================================================
-- D. Media releases
-- =============================================================================
SELECT pg_temp.expect_error($$
  INSERT INTO "MediaRelease" (id, "organizationId", "patientId", purpose, "photoId", "beforeAfterSetId", "releasedById")
  SELECT gen_random_uuid(), p."organizationId", p."patientId", 'WEBSITE', p.id, b.id, (SELECT id FROM "User" WHERE email = 'dr.a@example.test')
  FROM "PatientPhoto" p JOIN "BeforeAfterSet" b ON b."beforePhotoId" = p.id LIMIT 1$$,
  '23514', 'D10 a media release covers exactly one asset');

-- =============================================================================
-- H. Consultations and notes
-- =============================================================================
INSERT INTO "Consultation" (id, "organizationId", "patientId", "practiceId", "createdById", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-e60f6eb6f3af', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-0000000000a1', '0a000000-0000-7000-8000-bda01469c352', now());
INSERT INTO "ConsultationNote" (id, "organizationId", "patientId", "consultationId", "authorUserId", status, body, "finalizedAt", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-c10f3290d1af', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-e60f6eb6f3af', '0a000000-0000-7000-8000-bda01469c352', 'FINAL', 'Discussed options.', now(), now());

SELECT pg_temp.expect_error($$
  UPDATE "ConsultationNote" SET body = 'Rewritten' WHERE id = '0a000000-0000-7000-8000-c10f3290d1af'$$,
  'AE001', 'H2 [P] a FINAL consultation note is immutable');

SELECT pg_temp.expect_error($$
  UPDATE "Consultation" SET status = 'COMPLETED' WHERE id = '0a000000-0000-7000-8000-e60f6eb6f3af'$$,
  '23514', 'H3 COMPLETED requires completion time and actor');
