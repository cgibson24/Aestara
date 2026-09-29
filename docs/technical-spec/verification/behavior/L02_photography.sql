-- =============================================================================
-- LAYER 2 - Photography core, storage, media permissions, configuration (spec §5.8)
-- =============================================================================
INSERT INTO "StorageObject" (id, "organizationId", "objectClass", bucket, "objectKey", "contentType", sha256, status, "verifiedAt") VALUES
  ('0a000000-0000-7000-8000-3e10486dde69', '0a000000-0000-7000-8000-000000000001', 'CLINICAL_ORIGINAL',   'clinical', 'org-a/o1', 'image/heic', repeat('a', 64), 'AVAILABLE', now()),
  ('0a000000-0000-7000-8000-034875d585d2', '0a000000-0000-7000-8000-000000000001', 'CLINICAL_ORIGINAL',   'clinical', 'org-a/o2', 'image/heic', repeat('b', 64), 'AVAILABLE', now()),
  ('0a000000-0000-7000-8000-348c249d3d1c', '0a000000-0000-7000-8000-000000000001', 'CLINICAL_ORIGINAL',   'clinical', 'org-a/o3', 'image/heic', repeat('c', 64), 'AVAILABLE', now()),
  ('0a000000-0000-7000-8000-e672b9c054ef', '0a000000-0000-7000-8000-000000000001', 'CLINICAL_DERIVATIVE', 'clinical', 'org-a/d1', 'image/jpeg', repeat('d', 64), 'AVAILABLE', now()),
  ('0a000000-0000-7000-8000-9e6e6c5076ab', '0a000000-0000-7000-8000-000000000001', 'DOCUMENT',            'clinical', 'org-a/doc1', 'application/pdf', repeat('e', 64), 'AVAILABLE', now()),
  ('0a000000-0000-7000-8000-47609cd6f2f0', '0a000000-0000-7000-8000-000000000001', 'CLINICAL_ORIGINAL',   'clinical', 'org-a/pending', 'image/heic', NULL, 'PENDING_UPLOAD', NULL);

INSERT INTO "PatientPhoto" (id, "organizationId", "patientId", source, status, "originalObjectId", "capturedAt", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-599a1cc8f834', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871', 'PROVIDER_CAPTURE', 'ACCEPTED', '0a000000-0000-7000-8000-3e10486dde69', now(), now()),
  ('0a000000-0000-7000-8000-0912bad80f96', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871', 'PROVIDER_CAPTURE', 'ACCEPTED', '0a000000-0000-7000-8000-034875d585d2', now(), now()),
  ('0a000000-0000-7000-8000-6a18a0ed400f', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-7b53c75b7213', 'PROVIDER_CAPTURE', 'ACCEPTED', '0a000000-0000-7000-8000-348c249d3d1c', now(), now());

-- =============================================================================
-- C. Clinical photography: original protection (Bible 6.6, 34.1)
-- =============================================================================
SELECT pg_temp.expect_error($$
  UPDATE "PatientPhoto" SET "originalObjectId" = '0a000000-0000-7000-8000-348c249d3d1c'
  WHERE id = '0a000000-0000-7000-8000-599a1cc8f834'$$,
  'AE001', 'C1 a photo can never be re-pointed to a different original');

SELECT pg_temp.expect_ok($$
  UPDATE "PatientPhoto" SET "reviewNote" = 'Lighting acceptable'
  WHERE id = '0a000000-0000-7000-8000-599a1cc8f834'$$,
  'C2 non-identity photo metadata can still be updated');

SELECT pg_temp.expect_error($$
  UPDATE "StorageObject" SET sha256 = repeat('f', 64)
  WHERE id = '0a000000-0000-7000-8000-3e10486dde69'$$,
  'AE001', 'C3 a verified storage object checksum can never change');

SELECT pg_temp.expect_error($$
  UPDATE "StorageObject" SET "objectKey" = 'org-a/moved'
  WHERE id = '0a000000-0000-7000-8000-47609cd6f2f0'$$,
  'AE001', 'C4 an object key can never change, even before verification');

SELECT pg_temp.expect_ok($$
  INSERT INTO "PhotoDerivative" (id, "organizationId", "patientId", "sourcePhotoId", kind, "storageObjectId", "generationMetadata")
  VALUES ('0a000000-0000-7000-8000-0e822b049d8c', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-599a1cc8f834', 'THUMBNAIL', '0a000000-0000-7000-8000-e672b9c054ef',
          '{"generator":"image-processing","version":"1.0.0","maxEdgePx":256}')$$,
  'C8 derivative referencing its source and generation metadata is accepted');

SELECT pg_temp.expect_error($$
  UPDATE "PhotoDerivative" SET kind = 'MARKETING_DERIVATIVE' WHERE id = '0a000000-0000-7000-8000-0e822b049d8c'$$,
  'AE001', 'C9 derivatives are immutable');

SELECT pg_temp.expect_ok($$
  UPDATE "StorageObject" SET status = 'PURGED', "purgedAt" = now()
  WHERE id = '0a000000-0000-7000-8000-e672b9c054ef'$$,
  'C10 lifecycle status of a verified object can still advance (retention purge)');

-- =============================================================================
-- D. Media permissions: independent, versioned, append-only (Bible 7)
-- =============================================================================
SELECT pg_temp.expect_ok($$
  INSERT INTO "PhotoPermission" (id, "organizationId", "patientId", category, scope, state, "versionNumber", "effectiveAt")
  VALUES ('0a000000-0000-7000-8000-d8331d633510', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          'WEBSITE', 'PATIENT_WIDE', 'GRANTED', 1, now())$$,
  'D1 first permission version is accepted');

SELECT pg_temp.expect_error($$
  INSERT INTO "PhotoPermission" (id, "organizationId", "patientId", category, scope, state, "versionNumber", "effectiveAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          'WEBSITE', 'PATIENT_WIDE', 'DECLINED', 1, now())$$,
  '23505', 'D2 only one current permission per patient/category/scope');

SELECT pg_temp.expect_ok($$
  INSERT INTO "PhotoPermission" (id, "organizationId", "patientId", category, scope, state, "versionNumber", "effectiveAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          'SOCIAL_MEDIA', 'PATIENT_WIDE', 'NOT_REQUESTED', 1, now())$$,
  'D3 a different category is independent (no permission implies another)');

SELECT pg_temp.expect_error($$
  UPDATE "PhotoPermission" SET state = 'REVOKED' WHERE id = '0a000000-0000-7000-8000-d8331d633510'$$,
  'AE001', 'D4 a permission version cannot be edited in place');

SELECT pg_temp.expect_ok($$
  WITH s AS (UPDATE "PhotoPermission" SET "supersededAt" = now()
             WHERE id = '0a000000-0000-7000-8000-d8331d633510' RETURNING id)
  INSERT INTO "PhotoPermission" (id, "organizationId", "patientId", category, scope, state, "versionNumber", "previousVersionId", "effectiveAt")
  SELECT '0a000000-0000-7000-8000-c4d89ad0e892', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
         'WEBSITE', 'PATIENT_WIDE', 'REVOKED', 2, s.id, now() FROM s$$,
  'D5 revocation = supersede v1 + append v2 in one statement');

SELECT pg_temp.expect_error($$
  UPDATE "PhotoPermission" SET "supersededAt" = now() WHERE id = '0a000000-0000-7000-8000-d8331d633510'$$,
  'AE001', 'D6 a superseded version is frozen');

SELECT pg_temp.expect_error($$
  DELETE FROM "PhotoPermission" WHERE id = '0a000000-0000-7000-8000-c4d89ad0e892'$$,
  'AE001', 'D7 permission history cannot be deleted');

SELECT pg_temp.expect_error($$
  INSERT INTO "PhotoPermission" (id, "organizationId", "patientId", category, scope, state, "versionNumber", "effectiveAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          'RESEARCH', 'PHOTO', 'GRANTED', 1, now())$$,
  '23514', 'D8 PHOTO-scope permission must name a photo');

SELECT pg_temp.expect_error($$
  INSERT INTO "PhotoPermission" (id, "organizationId", "patientId", category, scope, state, "versionNumber", "effectiveAt", "photoId")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          'RESEARCH', 'PHOTO', 'GRANTED', 1, now(), '0a000000-0000-7000-8000-6a18a0ed400f')$$,
  '23503', 'D9 a permission cannot target another patient''s photo');

-- =============================================================================
-- H. Configuration
-- =============================================================================
INSERT INTO "FeatureFlag" (id, key, enabled, "updatedAt") VALUES (gen_random_uuid(), 'ai.simulation', false, now());
SELECT pg_temp.expect_error($$
  INSERT INTO "FeatureFlag" (id, key, enabled, "updatedAt") VALUES (gen_random_uuid(), 'ai.simulation', true, now())$$,
  '23505', 'H4 one platform-default value per feature flag');
SELECT pg_temp.expect_error($$
  INSERT INTO "FeatureFlag" (id, key, enabled, "practiceId", "updatedAt")
  VALUES (gen_random_uuid(), 'ai.simulation', true, '0a000000-0000-7000-8000-0000000000a1', now())$$,
  '23514', 'H5 a practice-level flag must name its organization');

SELECT pg_temp.expect_error($$
  INSERT INTO "RetentionPolicy" (id, "organizationId", "recordCategory", action, basis, "effectiveFrom", "createdById")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', 'MESSAGE', 'DELETE', 'Customer policy 4.2', now(),
          '0a000000-0000-7000-8000-bda01469c352')$$,
  '23514', 'H6 a DELETE retention action requires an explicit period');

-- =============================================================================
-- R. Regression tests for defects found by the independent review (spec 11.3)
-- =============================================================================
INSERT INTO "PhotographyProtocol" (id, "organizationId", name, "bodyRegion", status, "updatedAt")
VALUES (gen_random_uuid(), (SELECT id FROM "Organization" WHERE slug = 'org-a'), 'Face standard', 'FACE', 'ACTIVE', now());

SELECT pg_temp.expect_error($$
  INSERT INTO "PhotoSession" (id, "organizationId", "patientId", "protocolId", source, "capturedByUserId", "practiceId", "startedAt", "updatedAt")
  VALUES (gen_random_uuid(), (SELECT id FROM "Organization" WHERE slug = 'org-a'), (SELECT id FROM "Patient" WHERE mrn = 'MRN-1' AND "organizationId" = (SELECT id FROM "Organization" WHERE slug = 'org-a')), (SELECT id FROM "PhotographyProtocol" WHERE name = 'Face standard'),
          'PROVIDER_CAPTURE', (SELECT id FROM "User" WHERE email = 'dr.a@example.test'), (SELECT id FROM "Practice" WHERE name = 'Practice B1'), now(), now())$$,
  '23503', 'R1 a photo session in org A cannot name a practice of org B (no location)');

SELECT pg_temp.expect_error($$
  INSERT INTO "PhotoSession" (id, "organizationId", "patientId", "protocolId", source, "capturedByUserId", "locationId", "startedAt", "updatedAt")
  VALUES (gen_random_uuid(), (SELECT id FROM "Organization" WHERE slug = 'org-a'), (SELECT id FROM "Patient" WHERE mrn = 'MRN-1' AND "organizationId" = (SELECT id FROM "Organization" WHERE slug = 'org-a')), (SELECT id FROM "PhotographyProtocol" WHERE name = 'Face standard'),
          'PROVIDER_CAPTURE', (SELECT id FROM "User" WHERE email = 'dr.a@example.test'), (SELECT id FROM "Location" WHERE name = 'Loc A2'), now(), now())$$,
  '23514', 'R2 a photo session location requires its practice (FK always evaluated)');

SELECT pg_temp.expect_error($$
  INSERT INTO "PhotoSession" (id, "organizationId", "patientId", "protocolId", source, "startedAt", "updatedAt")
  VALUES (gen_random_uuid(), (SELECT id FROM "Organization" WHERE slug = 'org-a'), (SELECT id FROM "Patient" WHERE mrn = 'MRN-1' AND "organizationId" = (SELECT id FROM "Organization" WHERE slug = 'org-a')), (SELECT id FROM "PhotographyProtocol" WHERE name = 'Face standard'),
          'PROVIDER_CAPTURE', now(), now())$$,
  '23514', 'R3 a captured session records its capturing user (Bible 6.1)');

INSERT INTO "PhotoPermission" (id, "organizationId", "patientId", category, scope, state, "versionNumber", "effectiveAt")
VALUES (gen_random_uuid(), (SELECT id FROM "Organization" WHERE slug = 'org-a'), (SELECT id FROM "Patient" WHERE mrn = 'MRN-1' AND "organizationId" = (SELECT id FROM "Organization" WHERE slug = 'org-a')), 'PATIENT_APP', 'PATIENT_WIDE', 'GRANTED', 1, now());

BEGIN;
SET CONSTRAINTS "MediaRelease_requires_permission" IMMEDIATE;
SELECT pg_temp.expect_error($$
  INSERT INTO "MediaRelease" (id, "organizationId", "patientId", purpose, "photoId", "releasedById")
  SELECT gen_random_uuid(), p."organizationId", p."patientId", 'PATIENT_APP', p.id, (SELECT id FROM "User" WHERE email = 'dr.a@example.test')
  FROM "PatientPhoto" p WHERE p."patientId" = (SELECT id FROM "Patient" WHERE mrn = 'MRN-1' AND "organizationId" = (SELECT id FROM "Organization" WHERE slug = 'org-a')) LIMIT 1$$,
  '23514', 'R15 a media release must pin at least one permission version');
COMMIT;

SELECT pg_temp.expect_ok($$
  WITH r AS (
    INSERT INTO "MediaRelease" (id, "organizationId", "patientId", purpose, "photoId", "releasedById")
    SELECT gen_random_uuid(), p."organizationId", p."patientId", 'PATIENT_APP', p.id, (SELECT id FROM "User" WHERE email = 'dr.a@example.test')
    FROM "PatientPhoto" p WHERE p."patientId" = (SELECT id FROM "Patient" WHERE mrn = 'MRN-1' AND "organizationId" = (SELECT id FROM "Organization" WHERE slug = 'org-a')) LIMIT 1
    RETURNING id, "organizationId", "patientId")
  INSERT INTO "MediaReleasePermission" ("organizationId", "patientId", "mediaReleaseId", "permissionId")
  SELECT r."organizationId", r."patientId", r.id, pp.id FROM r
  JOIN "PhotoPermission" pp ON pp."patientId" = r."patientId" AND pp.category = 'PATIENT_APP' AND pp."supersededAt" IS NULL$$,
  'R16 a release with its pinned permission version is accepted');

SELECT pg_temp.expect_error($$
  DELETE FROM "MediaReleasePermission"$$,
  'AE001', 'R17 pinned permission versions cannot be removed');
