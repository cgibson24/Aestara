-- =============================================================================
-- Behavioural verification of the draft schema (schema.prisma + constraints.sql)
--
-- Proves that the database itself rejects the violations the Production Bible
-- forbids, independent of application code. Each check either PASSes or aborts
-- the run. Run instructions: docs/technical-spec/verification/README.md
--
-- SQLSTATE legend: 23503 foreign_key_violation  23505 unique_violation
--                  23514 check_violation        AE001 IMMUTABLE_RECORD (trigger)
-- =============================================================================
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
SET client_min_messages = notice;

CREATE TEMP TABLE _results (label text, passed boolean);

CREATE FUNCTION pg_temp.expect_error(stmt text, expected text, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = expected THEN
      INSERT INTO _results VALUES (label, true);
      RAISE NOTICE 'PASS  %', label;
      RETURN;
    END IF;
    RAISE EXCEPTION 'FAIL  % (expected %, got %: %)', label, expected, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL  % (expected %, but the statement succeeded)', label, expected;
END;
$$;

CREATE FUNCTION pg_temp.expect_ok(stmt text, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  INSERT INTO _results VALUES (label, true);
  RAISE NOTICE 'PASS  %', label;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FAIL  % (expected success, got %: %)', label, SQLSTATE, SQLERRM;
END;
$$;

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
-- A. Tenant isolation (Bible 3.1, 21.2, 36 "Tenancy")
-- =============================================================================
SELECT pg_temp.expect_error($$
  INSERT INTO "Consultation" (id, "organizationId", "patientId", "practiceId", "createdById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0b000000-0000-7000-8000-fd76a7158ec0',
          '0a000000-0000-7000-8000-0000000000a1', '0a000000-0000-7000-8000-bda01469c352', now())$$,
  '23503', 'A1 consultation in org A cannot reference a patient of org B');

SELECT pg_temp.expect_error($$
  INSERT INTO "Patient" (id, "organizationId", "primaryPracticeId", "firstName", "lastName", "dateOfBirth", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0b000000-0000-7000-8000-0000000000b1', 'X', 'Y', '2000-01-01', now())$$,
  '23503', 'A2 patient in org A cannot have a primary practice of org B');

SELECT pg_temp.expect_error($$
  INSERT INTO "Appointment" (id, "organizationId", "patientId", "practiceId", "providerUserId", "startsAt", "endsAt", timezone, "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-0000000000a1', '0b000000-0000-7000-8000-bda01469c352',
          now(), now() + interval '30 minutes', 'America/New_York', now())$$,
  '23503', 'A3 appointment in org A cannot use a provider of org B');

SELECT pg_temp.expect_error($$
  INSERT INTO "Appointment" (id, "organizationId", "patientId", "practiceId", "locationId", "startsAt", "endsAt", timezone, "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-0000000000a1', '0a000000-0000-7000-8000-00000000a2a2',
          now(), now() + interval '30 minutes', 'America/New_York', now())$$,
  '23503', 'A4 appointment location must belong to the appointment practice');

SELECT pg_temp.expect_error($$
  WITH r AS (INSERT INTO "Role" (id, key, name, "updatedAt")
             VALUES (gen_random_uuid(), 'PRACTICE_ADMIN', 'Practice admin', now()) RETURNING id)
  INSERT INTO "UserRole" (id, "userId", "organizationId", "roleId", scope)
  SELECT gen_random_uuid(), '0b000000-0000-7000-8000-bda01469c352', '0a000000-0000-7000-8000-000000000001', r.id, 'ORGANIZATION' FROM r$$,
  '23503', 'A5 a role in org A cannot be assigned to a user without an org A membership');

-- =============================================================================
-- B. Identity & RBAC shape
-- =============================================================================
INSERT INTO "Role" (id, key, name, "updatedAt") VALUES
  ('00000000-0000-7000-8000-ce0daeeb3d63', 'SUPER_ADMIN', 'Super admin', now()),
  ('00000000-0000-7000-8000-ff48ceb308c5', 'SURGEON_PHYSICIAN', 'Surgeon / physician', now());

SELECT pg_temp.expect_error($$
  INSERT INTO "Role" (id, key, name, "updatedAt") VALUES (gen_random_uuid(), 'SUPER_ADMIN', 'dup', now())$$,
  '23505', 'B1 system role keys are unique even though organizationId is NULL');

SELECT pg_temp.expect_error($$
  INSERT INTO "UserRole" (id, "userId", "organizationId", "roleId", scope)
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-bda01469c352', '0a000000-0000-7000-8000-000000000001',
          '00000000-0000-7000-8000-ce0daeeb3d63', 'PLATFORM')$$,
  '23514', 'B2 PLATFORM-scope assignment cannot carry an organization');

SELECT pg_temp.expect_error($$
  INSERT INTO "UserRole" (id, "userId", "organizationId", "roleId", scope, "practiceId", "locationId")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-bda01469c352', '0a000000-0000-7000-8000-000000000001',
          '00000000-0000-7000-8000-ff48ceb308c5', 'LOCATION',
          '0a000000-0000-7000-8000-0000000000a1', '0a000000-0000-7000-8000-00000000a2a2')$$,
  '23503', 'B3 LOCATION-scope assignment must use a location of the named practice');

SELECT pg_temp.expect_ok($$
  INSERT INTO "UserRole" (id, "userId", "organizationId", "roleId", scope, "practiceId")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-bda01469c352', '0a000000-0000-7000-8000-000000000001',
          '00000000-0000-7000-8000-ff48ceb308c5', 'PRACTICE', '0a000000-0000-7000-8000-0000000000a1')$$,
  'B4 valid PRACTICE-scope assignment is accepted');

SELECT pg_temp.expect_error($$
  INSERT INTO "UserRole" (id, "userId", "organizationId", "roleId", scope, "practiceId")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-bda01469c352', '0a000000-0000-7000-8000-000000000001',
          '00000000-0000-7000-8000-ff48ceb308c5', 'PRACTICE', '0a000000-0000-7000-8000-0000000000a1')$$,
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

-- =============================================================================
-- C. Clinical photography: original protection & before/after (Bible 6.6, 8, 34.1)
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

SELECT pg_temp.expect_error($$
  INSERT INTO "MediaRelease" (id, "organizationId", "patientId", purpose, "photoId", "beforeAfterSetId", "permissionId", "releasedById")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871', 'WEBSITE',
          '0a000000-0000-7000-8000-599a1cc8f834', '0a000000-0000-7000-8000-00000000ba01',
          '0a000000-0000-7000-8000-c4d89ad0e892', '0a000000-0000-7000-8000-bda01469c352')$$,
  '23514', 'D10 a media release covers exactly one asset');

-- =============================================================================
-- E. AI provenance & review (Bible 9, 34.2)
-- =============================================================================
INSERT INTO "AIModel" (id, key, name, task, "simulationCategory", "updatedAt") VALUES
  ('00000000-0000-7000-8000-ff9645c7e79e', 'lip-visualizer', 'Lip visualizer', 'SIMULATION', 'LIP_FILLER', now()),
  ('00000000-0000-7000-8000-afc15a989b35', 'nose-visualizer', 'Nose visualizer', 'SIMULATION', 'RHINOPLASTY', now());
INSERT INTO "AIModelVersion" (id, "modelId", version, "artifactDigest", "parameterSchema", "inferenceDefaults", thresholds, "intendedUse") VALUES
  ('00000000-0000-7000-8000-43744a7a0c15', '00000000-0000-7000-8000-ff9645c7e79e', '1.0.0', repeat('1', 64),
   '{"upperLipVolume":{"min":0,"max":1}}', '{}', '{"outsideRegionSimilarityMin":0.97}', 'Clinician-controlled visualization'),
  ('00000000-0000-7000-8000-0922883fdb39', '00000000-0000-7000-8000-afc15a989b35', '1.0.0', repeat('2', 64),
   '{}', '{}', '{}', 'Clinician-controlled visualization');

SELECT pg_temp.expect_error($$
  UPDATE "AIModelVersion" SET "parameterSchema" = '{"units":{"min":0,"max":100}}' WHERE id = '00000000-0000-7000-8000-43744a7a0c15'$$,
  'AE001', 'E1 a registered model version cannot be silently changed');

SELECT pg_temp.expect_ok($$
  UPDATE "AIModelVersion" SET status = 'VALIDATED', "validatedAt" = now() WHERE id = '00000000-0000-7000-8000-43744a7a0c15'$$,
  'E2 model version lifecycle status can advance');

SELECT pg_temp.expect_ok($$
  INSERT INTO "AIModelRollout" (id, "modelId", "modelVersionId", state, "changedById")
  VALUES (gen_random_uuid(), '00000000-0000-7000-8000-ff9645c7e79e', '00000000-0000-7000-8000-43744a7a0c15', 'ACTIVE',
          '0a000000-0000-7000-8000-bda01469c352')$$,
  'E3 platform-wide activation is accepted');

SELECT pg_temp.expect_error($$
  INSERT INTO "AIModelRollout" (id, "modelId", "modelVersionId", state, "changedById")
  VALUES (gen_random_uuid(), '00000000-0000-7000-8000-ff9645c7e79e', '00000000-0000-7000-8000-43744a7a0c15', 'ACTIVE',
          '0a000000-0000-7000-8000-bda01469c352')$$,
  '23505', 'E4 only one ACTIVE rollout per model at platform scope');

SELECT pg_temp.expect_error($$
  INSERT INTO "AIModelRollout" (id, "modelId", "modelVersionId", "organizationId", state, "changedById")
  VALUES (gen_random_uuid(), '00000000-0000-7000-8000-ff9645c7e79e', '00000000-0000-7000-8000-0922883fdb39', '0a000000-0000-7000-8000-000000000001', 'ACTIVE',
          '0a000000-0000-7000-8000-bda01469c352')$$,
  '23503', 'E5 a rollout cannot activate a version of a different model');

INSERT INTO "Simulation" (id, "organizationId", "patientId", category, "treatmentRegion", "createdById", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-8e4b0a367775', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871', 'LIP_FILLER', 'LIPS', '0a000000-0000-7000-8000-bda01469c352', now()),
  ('0a000000-0000-7000-8000-9fcc11a93da2', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871', 'LIP_FILLER', 'LIPS', '0a000000-0000-7000-8000-bda01469c352', now());
INSERT INTO "SimulationVersion" (id, "organizationId", "patientId", "simulationId", "versionNumber", "modelVersionId", "inferenceConfig", "generatedById") VALUES
  ('0a000000-0000-7000-8000-8efdacc4c187', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-8e4b0a367775', 1, '00000000-0000-7000-8000-43744a7a0c15', '{"upperLipVolume":0.4}', '0a000000-0000-7000-8000-bda01469c352');

SELECT pg_temp.expect_error($$
  INSERT INTO "SimulationVersionSource" ("organizationId", "patientId", "simulationVersionId", "photoId", role)
  VALUES ('0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-8efdacc4c187', '0a000000-0000-7000-8000-6a18a0ed400f', 'PRIMARY')$$,
  '23503', 'E6 a simulation cannot use another patient''s photo as a source');

SELECT pg_temp.expect_ok($$
  INSERT INTO "SimulationVersionSource" ("organizationId", "patientId", "simulationVersionId", "photoId", role)
  VALUES ('0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-8efdacc4c187', '0a000000-0000-7000-8000-599a1cc8f834', 'PRIMARY')$$,
  'E7 source asset provenance for the same patient is accepted');

SELECT pg_temp.expect_error($$
  UPDATE "SimulationVersion" SET "modelVersionId" = '00000000-0000-7000-8000-0922883fdb39'
  WHERE id = '0a000000-0000-7000-8000-8efdacc4c187'$$,
  'AE001', 'E8 model/version provenance cannot change, even before completion');

SELECT pg_temp.expect_ok($$
  UPDATE "SimulationVersion" SET "completedAt" = now() WHERE id = '0a000000-0000-7000-8000-8efdacc4c187'$$,
  'E9 generation completion is recorded');

SELECT pg_temp.expect_error($$
  UPDATE "SimulationVersion" SET "outputDerivativeId" = NULL WHERE id = '0a000000-0000-7000-8000-8efdacc4c187'$$,
  'AE001', 'E10 a completed simulation version is fully immutable');

SELECT pg_temp.expect_error($$
  INSERT INTO "SimulationApproval" (id, "organizationId", "patientId", "simulationId", "simulationVersionId", decision, "reviewerUserId")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-9fcc11a93da2', '0a000000-0000-7000-8000-8efdacc4c187', 'APPROVED',
          '0a000000-0000-7000-8000-bda01469c352')$$,
  '23503', 'E11 an approval must reference a version of the same simulation');

SELECT pg_temp.expect_error($$
  UPDATE "Simulation" SET status = 'RELEASED_TO_PATIENT' WHERE id = '0a000000-0000-7000-8000-8e4b0a367775'$$,
  '23514', 'E12 release to patient requires the released version, time and actor');

SELECT pg_temp.expect_error($$
  UPDATE "Simulation" SET "releasedVersionId" = '0a000000-0000-7000-8000-8efdacc4c187'
  WHERE id = '0a000000-0000-7000-8000-9fcc11a93da2'$$,
  '23503', 'E13 a simulation can only release one of its own versions');

INSERT INTO "SimulationApproval" (id, "organizationId", "patientId", "simulationId", "simulationVersionId", decision, "reviewerUserId")
VALUES ('0a000000-0000-7000-8000-6776d3ef6d36', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
        '0a000000-0000-7000-8000-8e4b0a367775', '0a000000-0000-7000-8000-8efdacc4c187', 'APPROVED',
        '0a000000-0000-7000-8000-bda01469c352');

SELECT pg_temp.expect_error($$
  UPDATE "SimulationApproval" SET decision = 'REJECTED' WHERE id = '0a000000-0000-7000-8000-6776d3ef6d36'$$,
  'AE001', 'E14 review decisions are append-only');

SELECT pg_temp.expect_error($$
  INSERT INTO "SimulationParameter" (id, "organizationId", "simulationVersionId", key)
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8efdacc4c187', 'upperLipVolume')$$,
  '23514', 'E15 a simulation parameter carries exactly one value');

-- =============================================================================
-- F. Consent versioning & executed-document immutability (Bible 12)
-- =============================================================================
INSERT INTO "ConsentTemplate" (id, "organizationId", name, "createdById", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-23037d045d41', '0a000000-0000-7000-8000-000000000001', 'Filler consent', '0a000000-0000-7000-8000-bda01469c352', now());
INSERT INTO "ConsentTemplateVersion" (id, "organizationId", "templateId", "versionNumber", blocks, "createdById", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-9b32f90e9f9b', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-23037d045d41', 1,
   '[{"id":"h1","type":"HEADING","text":"Consent"}]', '0a000000-0000-7000-8000-bda01469c352', now());

SELECT pg_temp.expect_ok($$
  UPDATE "ConsentTemplateVersion" SET blocks = '[{"id":"h1","type":"HEADING","text":"Consent v1"}]'
  WHERE id = '0a000000-0000-7000-8000-9b32f90e9f9b'$$,
  'F1 a DRAFT template version is editable');

SELECT pg_temp.expect_ok($$
  UPDATE "ConsentTemplateVersion"
  SET status = 'PUBLISHED', "publishedAt" = now(), "publishedById" = '0a000000-0000-7000-8000-bda01469c352', "contentHash" = repeat('9', 64)
  WHERE id = '0a000000-0000-7000-8000-9b32f90e9f9b'$$,
  'F2 publishing a version is accepted');

SELECT pg_temp.expect_error($$
  UPDATE "ConsentTemplateVersion" SET blocks = '[]' WHERE id = '0a000000-0000-7000-8000-9b32f90e9f9b'$$,
  'AE001', 'F3 a PUBLISHED template version is immutable');

SELECT pg_temp.expect_error($$
  UPDATE "ConsentTemplateVersion" SET status = 'DRAFT' WHERE id = '0a000000-0000-7000-8000-9b32f90e9f9b'$$,
  'AE001', 'F4 a PUBLISHED version cannot return to DRAFT');

SELECT pg_temp.expect_ok($$
  INSERT INTO "ConsentTemplateVersion" (id, "organizationId", "templateId", "versionNumber", blocks, "createdById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-23037d045d41', 2, '[]',
          '0a000000-0000-7000-8000-bda01469c352', now())$$,
  'F5 editing a template creates a new version');

SELECT pg_temp.expect_error($$
  INSERT INTO "ConsentTemplateVersion" (id, "organizationId", "templateId", "versionNumber", blocks, "createdById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-23037d045d41', 3, '[]',
          '0a000000-0000-7000-8000-bda01469c352', now())$$,
  '23505', 'F6 only one open DRAFT per template');

INSERT INTO "Document" (id, "organizationId", "patientId", type, title, "updatedAt") VALUES
  ('0a000000-0000-7000-8000-9e536b0bfa7c', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   'SIGNED_CONSENT', 'Filler consent (signed)', now());
INSERT INTO "DocumentVersion" (id, "organizationId", "patientId", "documentId", "versionNumber", "storageObjectId", sha256) VALUES
  ('0a000000-0000-7000-8000-ed5e08da26dc', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-9e536b0bfa7c', 1, '0a000000-0000-7000-8000-9e6e6c5076ab', repeat('e', 64));

SELECT pg_temp.expect_error($$
  INSERT INTO "ConsentAssignment" (id, "organizationId", "patientId", "templateVersionId", status, "assignedById",
                                   "completedAt", "signedDocumentVersionId", "signedSnapshotHash", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-7b53c75b7213',
          '0a000000-0000-7000-8000-9b32f90e9f9b', 'COMPLETE', '0a000000-0000-7000-8000-bda01469c352',
          now(), '0a000000-0000-7000-8000-ed5e08da26dc', repeat('e', 64), now())$$,
  '23503', 'F7 a consent cannot point at another patient''s signed snapshot');

SELECT pg_temp.expect_error($$
  INSERT INTO "ConsentAssignment" (id, "organizationId", "patientId", "templateVersionId", status, "assignedById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-9b32f90e9f9b', 'COMPLETE', '0a000000-0000-7000-8000-bda01469c352', now())$$,
  '23514', 'F8 COMPLETE requires the immutable snapshot and its hash');

SELECT pg_temp.expect_ok($$
  INSERT INTO "ConsentAssignment" (id, "organizationId", "patientId", "templateVersionId", status, responses, "assignedById",
                                   "completedAt", "signedDocumentVersionId", "signedSnapshotHash", "updatedAt")
  VALUES ('0a000000-0000-7000-8000-00000000ca01', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-9b32f90e9f9b', 'COMPLETE', '{"ack1":true}', '0a000000-0000-7000-8000-bda01469c352',
          now(), '0a000000-0000-7000-8000-ed5e08da26dc', repeat('e', 64), now())$$,
  'F9 a completed consent with snapshot and hash is accepted');

SELECT pg_temp.expect_error($$
  UPDATE "ConsentAssignment" SET responses = '{"ack1":false}' WHERE id = '0a000000-0000-7000-8000-00000000ca01'$$,
  'AE001', 'F10 an executed consent can never be edited');

SELECT pg_temp.expect_error($$
  UPDATE "DocumentVersion" SET sha256 = repeat('0', 64) WHERE id = '0a000000-0000-7000-8000-ed5e08da26dc'$$,
  'AE001', 'F11 a document version is immutable');

SELECT pg_temp.expect_ok($$
  UPDATE "ConsentAssignment"
  SET status = 'VOIDED', "voidedAt" = now(), "voidedById" = '0a000000-0000-7000-8000-bda01469c352', "voidReason" = 'Signed wrong form'
  WHERE id = '0a000000-0000-7000-8000-00000000ca01'$$,
  'F12 a completed consent can still be VOIDED per policy');

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
-- H. Scheduling, notes, configuration
-- =============================================================================
SELECT pg_temp.expect_error($$
  INSERT INTO "Appointment" (id, "organizationId", "patientId", "practiceId", "startsAt", "endsAt", timezone, "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-0000000000a1', now(), now() - interval '1 minute', 'America/New_York', now())$$,
  '23514', 'H1 an appointment must end after it starts');

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
-- Summary
-- =============================================================================
SELECT count(*) AS checks_passed FROM _results WHERE passed;
