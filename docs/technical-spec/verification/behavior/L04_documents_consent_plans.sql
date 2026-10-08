-- =============================================================================
-- LAYER 4 - Documents, consent, education, treatment plans (spec §5.8)
-- =============================================================================
-- =============================================================================
-- F. Consent versioning, the consent machine, hand-offs and executed-document
--    immutability (Bible 12; ADR-0028 K4-11 to K4-19)
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
  VALUES ('0a000000-0000-7000-8000-0000000004a2', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-23037d045d41', 2, '[]',
          '0a000000-0000-7000-8000-bda01469c352', now())$$,
  'F5 editing a template creates a new version');

SELECT pg_temp.expect_error($$
  INSERT INTO "ConsentTemplateVersion" (id, "organizationId", "templateId", "versionNumber", blocks, "createdById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-23037d045d41', 3, '[]',
          '0a000000-0000-7000-8000-bda01469c352', now())$$,
  '23505', 'F6 only one open DRAFT per template');

SELECT pg_temp.expect_error($$
  UPDATE "ConsentTemplateVersion"
  SET status = 'PUBLISHED', "publishedAt" = now(), "publishedById" = '0a000000-0000-7000-8000-bda01469c352', "contentHash" = 'not-a-hash'
  WHERE id = '0a000000-0000-7000-8000-0000000004a2'$$,
  '23514', 'F13 a content hash is a hex SHA-256');

-- A retired template whose version is published.
INSERT INTO "ConsentTemplate" (id, "organizationId", name, "retiredAt", "createdById", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-0000000004a3', '0a000000-0000-7000-8000-000000000001', 'Old consent', now(), '0a000000-0000-7000-8000-bda01469c352', now());
INSERT INTO "ConsentTemplateVersion" (id, "organizationId", "templateId", "versionNumber", status, blocks, "contentHash",
                                      "publishedAt", "publishedById", "createdById", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-0000000004a4', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-0000000004a3', 1, 'PUBLISHED',
   '[]', repeat('8', 64), now(), '0a000000-0000-7000-8000-bda01469c352', '0a000000-0000-7000-8000-bda01469c352', now());

SELECT pg_temp.expect_error($$
  INSERT INTO "ConsentAssignment" (id, "organizationId", "patientId", "templateVersionId", status, "assignedById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-9b32f90e9f9b', 'ASSIGNED', '0a000000-0000-7000-8000-bda01469c352', now())$$,
  'AE001', 'F14 a consent is created DRAFT');

SELECT pg_temp.expect_error($$
  INSERT INTO "ConsentAssignment" (id, "organizationId", "patientId", "templateVersionId", "assignedById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-0000000004a2', '0a000000-0000-7000-8000-bda01469c352', now())$$,
  'AE001', 'F15 a consent is never prepared from a DRAFT version');

SELECT pg_temp.expect_error($$
  INSERT INTO "ConsentAssignment" (id, "organizationId", "patientId", "templateVersionId", "assignedById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-0000000004a4', '0a000000-0000-7000-8000-bda01469c352', now())$$,
  'AE001', 'F16 a retired template takes no new consents');

SELECT pg_temp.expect_ok($$
  INSERT INTO "ConsentAssignment" (id, "organizationId", "patientId", "templateVersionId", "assignedById", "updatedAt")
  VALUES ('0a000000-0000-7000-8000-00000000ca01', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-9b32f90e9f9b', '0a000000-0000-7000-8000-bda01469c352', now())$$,
  'F17 a consent is prepared from a PUBLISHED version of a current template');

SELECT pg_temp.expect_error($$
  UPDATE "ConsentAssignment" SET status = 'SIGNED_BY_PATIENT', "patientSignedAt" = now()
  WHERE id = '0a000000-0000-7000-8000-00000000ca01'$$,
  'AE001', 'F18 a consent follows the 5.4.4 table (no DRAFT -> SIGNED_BY_PATIENT)');

-- A second consent of the same patient, and one of another patient.
INSERT INTO "ConsentAssignment" (id, "organizationId", "patientId", "templateVersionId", "assignedById", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-00000000ca02', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-9b32f90e9f9b', '0a000000-0000-7000-8000-bda01469c352', now()),
  ('0a000000-0000-7000-8000-00000000ca04', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-7b53c75b7213',
   '0a000000-0000-7000-8000-9b32f90e9f9b', '0a000000-0000-7000-8000-bda01469c352', now());

SELECT pg_temp.expect_error($$
  UPDATE "ConsentAssignment" SET "templateVersionId" = '0a000000-0000-7000-8000-0000000004a4'
  WHERE id = '0a000000-0000-7000-8000-00000000ca04'$$,
  'AE001', 'F19 a consent keeps its template version');

-- The patient's steps, in the clinic.
UPDATE "ConsentAssignment" SET status = 'ASSIGNED', "assignedAt" = now() WHERE id = '0a000000-0000-7000-8000-00000000ca01';
UPDATE "ConsentAssignment" SET status = 'VIEWED', "firstViewedAt" = now() WHERE id = '0a000000-0000-7000-8000-00000000ca01';
UPDATE "ConsentAssignment" SET status = 'IN_PROGRESS', responses = '{"ack1":true}' WHERE id = '0a000000-0000-7000-8000-00000000ca01';

-- The staff member's device and session, and a second device.
INSERT INTO "Device" (id, "userId", "clientApp", "installationIdHash", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-0000000004d1', '0a000000-0000-7000-8000-bda01469c352', 'IOS_PROVIDER', repeat('d', 64), now()),
  ('0a000000-0000-7000-8000-0000000004d2', '0a000000-0000-7000-8000-bda01469c352', 'IOS_PROVIDER', repeat('c', 64), now());
INSERT INTO "Session" (id, "userId", "organizationId", "deviceId", "clientApp", "refreshTokenHash", "idleExpiresAt", "absoluteExpiresAt") VALUES
  ('0a000000-0000-7000-8000-0000000004e1', '0a000000-0000-7000-8000-bda01469c352', '0a000000-0000-7000-8000-000000000001',
   '0a000000-0000-7000-8000-0000000004d1', 'IOS_PROVIDER', repeat('b', 64), now() + interval '1 hour', now() + interval '12 hours');

SELECT pg_temp.expect_error($$
  INSERT INTO "PatientHandoff" (id, "organizationId", "patientId", purpose, "consentAssignmentId", "treatmentPlanId", "openedById",
                                "sessionId", "deviceId", "tokenHash", "identityConfirmedAt", "absoluteExpiresAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871', 'PLAN_RESPONSE',
          '0a000000-0000-7000-8000-00000000ca01', NULL, '0a000000-0000-7000-8000-bda01469c352',
          '0a000000-0000-7000-8000-0000000004e1', '0a000000-0000-7000-8000-0000000004d1', repeat('1', 64), now(), now() + interval '60 minutes')$$,
  '23514', 'F20 a hand-off has one target, matching its purpose');

SELECT pg_temp.expect_error($$
  INSERT INTO "PatientHandoff" (id, "organizationId", "patientId", purpose, "consentAssignmentId", "openedById",
                                "sessionId", "deviceId", "tokenHash", "identityConfirmedAt", "absoluteExpiresAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871', 'CONSENT_SIGNING',
          '0a000000-0000-7000-8000-00000000ca01', '0a000000-0000-7000-8000-bda01469c352',
          '0a000000-0000-7000-8000-0000000004e1', '0a000000-0000-7000-8000-0000000004d1', repeat('1', 64), now(), now() + interval '61 minutes')$$,
  '23514', 'F21 a hand-off lasts at most 60 minutes');

SELECT pg_temp.expect_error($$
  INSERT INTO "PatientHandoff" (id, "organizationId", "patientId", purpose, "consentAssignmentId", "openedById",
                                "sessionId", "deviceId", "tokenHash", "identityConfirmedAt", "absoluteExpiresAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871', 'CONSENT_SIGNING',
          '0a000000-0000-7000-8000-00000000ca01', '0a000000-0000-7000-8000-bda01469c352',
          '0a000000-0000-7000-8000-0000000004e1', '0a000000-0000-7000-8000-0000000004d2', repeat('1', 64), now(), now() + interval '60 minutes')$$,
  'AE001', 'F22 a hand-off is bound to the opener''s session and its device');

INSERT INTO "PatientHandoff" (id, "organizationId", "patientId", purpose, "consentAssignmentId", "openedById",
                              "sessionId", "deviceId", "tokenHash", "identityConfirmedAt", "absoluteExpiresAt") VALUES
  ('0a000000-0000-7000-8000-0000000004f1', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871', 'CONSENT_SIGNING',
   '0a000000-0000-7000-8000-00000000ca01', '0a000000-0000-7000-8000-bda01469c352',
   '0a000000-0000-7000-8000-0000000004e1', '0a000000-0000-7000-8000-0000000004d1', repeat('1', 64), now(), now() + interval '60 minutes');

-- The patient's signature: a JSON signature object, written once.
INSERT INTO "StorageObject" (id, "organizationId", "objectClass", bucket, "objectKey", "contentType", sha256, status, "verifiedAt") VALUES
  ('0a000000-0000-7000-8000-0000000004b3', '0a000000-0000-7000-8000-000000000001', 'SIGNATURE', 'clinical', 'org-a/sig1', 'application/json', repeat('5', 64), 'AVAILABLE', now()),
  ('0a000000-0000-7000-8000-0000000004b4', '0a000000-0000-7000-8000-000000000001', 'SIGNATURE', 'clinical', 'org-a/sig2', 'application/json', repeat('6', 64), 'AVAILABLE', now());

SELECT pg_temp.expect_error($$
  INSERT INTO "ConsentSignature" (id, "organizationId", "patientId", "consentAssignmentId", "signerRole", "signerName", method,
                                  "signatureObjectId", attestation, "idempotencyKey", "handoffId")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-00000000ca02', 'PATIENT', 'Ann Lee', 'TYPED', '0a000000-0000-7000-8000-0000000004b4',
          'I have read and agree to this consent.', 'sig-ca02', '0a000000-0000-7000-8000-0000000004f1')$$,
  'AE001', 'F23 a signature names a hand-off of its own consent');

INSERT INTO "ConsentSignature" (id, "organizationId", "patientId", "consentAssignmentId", "signerRole", "signerName", method,
                                "signatureObjectId", attestation, "idempotencyKey", "handoffId") VALUES
  (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-00000000ca01', 'PATIENT', 'Ann Lee', 'DRAWN', '0a000000-0000-7000-8000-0000000004b3',
   'I have read and agree to this consent.', 'sig-ca01', '0a000000-0000-7000-8000-0000000004f1');
UPDATE "ConsentAssignment" SET status = 'SIGNED_BY_PATIENT', "patientSignedAt" = now() WHERE id = '0a000000-0000-7000-8000-00000000ca01';
UPDATE "PatientHandoff" SET "endedAt" = now(), "endReason" = 'COMPLETED' WHERE id = '0a000000-0000-7000-8000-0000000004f1';

SELECT pg_temp.expect_error($$
  UPDATE "PatientHandoff" SET "lastActivityAt" = now() + interval '1 minute' WHERE id = '0a000000-0000-7000-8000-0000000004f1'$$,
  'AE001', 'F24 an ended hand-off never changes');

SELECT pg_temp.expect_error($$
  UPDATE "ConsentAssignment" SET responses = '{"ack1":false}' WHERE id = '0a000000-0000-7000-8000-00000000ca01'$$,
  'AE001', 'F25 once the patient has signed, the responses are frozen');

SELECT pg_temp.expect_error($$
  UPDATE "ConsentAssignment" SET status = 'COMPLETE', "completedAt" = now() WHERE id = '0a000000-0000-7000-8000-00000000ca01'$$,
  '23514', 'F8 COMPLETE requires the immutable snapshot and its hash');

INSERT INTO "Document" (id, "organizationId", "patientId", type, title, "updatedAt") VALUES
  ('0a000000-0000-7000-8000-9e536b0bfa7c', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   'SIGNED_CONSENT', 'Filler consent (signed)', now());
INSERT INTO "DocumentVersion" (id, "organizationId", "patientId", "documentId", "versionNumber", "storageObjectId", sha256) VALUES
  ('0a000000-0000-7000-8000-ed5e08da26dc', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-9e536b0bfa7c', 1, '0a000000-0000-7000-8000-9e6e6c5076ab', repeat('e', 64));

SELECT pg_temp.expect_error($$
  UPDATE "ConsentAssignment" SET "signedDocumentVersionId" = '0a000000-0000-7000-8000-ed5e08da26dc', "signedSnapshotHash" = repeat('e', 64)
  WHERE id = '0a000000-0000-7000-8000-00000000ca04'$$,
  '23503', 'F7 a consent cannot point at another patient''s signed snapshot');

SELECT pg_temp.expect_error($$
  UPDATE "ConsentAssignment"
  SET status = 'COMPLETE', "completedAt" = now(), "signedDocumentVersionId" = '0a000000-0000-7000-8000-ed5e08da26dc',
      "signedSnapshotHash" = repeat('f', 64)
  WHERE id = '0a000000-0000-7000-8000-00000000ca01'$$,
  'AE001', 'F26 the stored hash is the SHA-256 of the SIGNED_CONSENT snapshot version');

SELECT pg_temp.expect_ok($$
  UPDATE "ConsentAssignment"
  SET status = 'COMPLETE', "completedAt" = now(), "signedDocumentVersionId" = '0a000000-0000-7000-8000-ed5e08da26dc',
      "signedSnapshotHash" = repeat('e', 64)
  WHERE id = '0a000000-0000-7000-8000-00000000ca01'$$,
  'F9 a completed consent with snapshot and hash is accepted');

SELECT pg_temp.expect_error($$
  UPDATE "ConsentAssignment" SET responses = '{"ack1":false}' WHERE id = '0a000000-0000-7000-8000-00000000ca01'$$,
  'AE001', 'F10 an executed consent can never be edited');

SELECT pg_temp.expect_error($$
  UPDATE "DocumentVersion" SET sha256 = repeat('0', 64) WHERE id = '0a000000-0000-7000-8000-ed5e08da26dc'$$,
  'AE001', 'F11 a document version is immutable');

-- Media-permission evidence (ADR-0028 K4-19).
SELECT pg_temp.expect_error($$
  INSERT INTO "PhotoPermission" (id, "organizationId", "patientId", category, scope, state, "versionNumber", "effectiveAt",
                                 evidence, "evidenceConsentAssignmentId")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          'EDUCATION', 'PATIENT_WIDE', 'GRANTED', 1, now(), 'SIGNED_CONSENT', '0a000000-0000-7000-8000-00000000ca02')$$,
  'AE001', 'F27 SIGNED_CONSENT evidence cites a COMPLETE consent');

SELECT pg_temp.expect_error($$
  INSERT INTO "PhotoPermission" (id, "organizationId", "patientId", category, scope, state, "versionNumber", "effectiveAt",
                                 evidence, "evidenceConsentAssignmentId")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          'EDUCATION', 'PATIENT_WIDE', 'GRANTED', 1, now(), 'STAFF_ATTESTATION', '0a000000-0000-7000-8000-00000000ca01')$$,
  '23514', 'F28 only SIGNED_CONSENT evidence cites a consent');

SELECT pg_temp.expect_ok($$
  INSERT INTO "PhotoPermission" (id, "organizationId", "patientId", category, scope, state, "versionNumber", "effectiveAt",
                                 evidence, "evidenceConsentAssignmentId")
  VALUES ('0a000000-0000-7000-8000-0000000004c1', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          'EDUCATION', 'PATIENT_WIDE', 'GRANTED', 1, now(), 'SIGNED_CONSENT', '0a000000-0000-7000-8000-00000000ca01')$$,
  'F29 a grant may cite a COMPLETE consent of the same patient');

SELECT pg_temp.expect_error($$
  UPDATE "ConsentAssignment"
  SET status = 'VOIDED', "voidedAt" = now(), "voidedById" = '0a000000-0000-7000-8000-bda01469c352', "voidReason" = 'Signed wrong form'
  WHERE id = '0a000000-0000-7000-8000-00000000ca01'$$,
  'AE001', 'F30 a consent that a current grant cites is not voided');

UPDATE "PhotoPermission" SET "supersededAt" = now() WHERE id = '0a000000-0000-7000-8000-0000000004c1';

-- Supersession (ADR-0028 K4-16).
SELECT pg_temp.expect_error($$
  INSERT INTO "ConsentAssignment" (id, "organizationId", "patientId", "templateVersionId", "replacesAssignmentId", "assignedById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-9b32f90e9f9b', '0a000000-0000-7000-8000-00000000ca02', '0a000000-0000-7000-8000-bda01469c352', now())$$,
  'AE001', 'F31 a replacement replaces a COMPLETE consent');

INSERT INTO "ConsentAssignment" (id, "organizationId", "patientId", "templateVersionId", "replacesAssignmentId", "assignedById", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-00000000ca03', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-9b32f90e9f9b', '0a000000-0000-7000-8000-00000000ca01', '0a000000-0000-7000-8000-bda01469c352', now());

SELECT pg_temp.expect_error($$
  INSERT INTO "ConsentAssignment" (id, "organizationId", "patientId", "templateVersionId", "replacesAssignmentId", "assignedById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-9b32f90e9f9b', '0a000000-0000-7000-8000-00000000ca01', '0a000000-0000-7000-8000-bda01469c352', now())$$,
  '23505', 'F32 a consent has one open replacement');

SELECT pg_temp.expect_error($$
  UPDATE "ConsentAssignment" SET status = 'SUPERSEDED', "supersededAt" = now(), "supersededByAssignmentId" = '0a000000-0000-7000-8000-00000000ca03'
  WHERE id = '0a000000-0000-7000-8000-00000000ca01'$$,
  'AE001', 'F33 a consent is superseded only when its replacement completes');

INSERT INTO "StorageObject" (id, "organizationId", "objectClass", bucket, "objectKey", "contentType", sha256, status, "verifiedAt") VALUES
  ('0a000000-0000-7000-8000-0000000004b1', '0a000000-0000-7000-8000-000000000001', 'DOCUMENT', 'clinical', 'org-a/doc2', 'application/pdf', repeat('7', 64), 'AVAILABLE', now());
INSERT INTO "DocumentVersion" (id, "organizationId", "patientId", "documentId", "versionNumber", "storageObjectId", sha256) VALUES
  ('0a000000-0000-7000-8000-0000000004b2', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-9e536b0bfa7c', 2, '0a000000-0000-7000-8000-0000000004b1', repeat('7', 64));
UPDATE "ConsentAssignment" SET status = 'ASSIGNED', "assignedAt" = now() WHERE id = '0a000000-0000-7000-8000-00000000ca03';
UPDATE "ConsentAssignment" SET status = 'VIEWED', "firstViewedAt" = now() WHERE id = '0a000000-0000-7000-8000-00000000ca03';
UPDATE "ConsentAssignment" SET status = 'IN_PROGRESS', responses = '{"ack1":true}' WHERE id = '0a000000-0000-7000-8000-00000000ca03';
UPDATE "ConsentAssignment" SET status = 'SIGNED_BY_PATIENT', "patientSignedAt" = now() WHERE id = '0a000000-0000-7000-8000-00000000ca03';
UPDATE "ConsentAssignment"
SET status = 'COMPLETE', "completedAt" = now(), "signedDocumentVersionId" = '0a000000-0000-7000-8000-0000000004b2', "signedSnapshotHash" = repeat('7', 64)
WHERE id = '0a000000-0000-7000-8000-00000000ca03';

SELECT pg_temp.expect_ok($$
  UPDATE "ConsentAssignment" SET status = 'SUPERSEDED', "supersededAt" = now(), "supersededByAssignmentId" = '0a000000-0000-7000-8000-00000000ca03'
  WHERE id = '0a000000-0000-7000-8000-00000000ca01'$$,
  'F34 a consent is superseded by its completed replacement');

SELECT pg_temp.expect_ok($$
  UPDATE "ConsentAssignment"
  SET status = 'VOIDED', "voidedAt" = now(), "voidedById" = '0a000000-0000-7000-8000-bda01469c352', "voidReason" = 'Signed wrong form'
  WHERE id = '0a000000-0000-7000-8000-00000000ca03'$$,
  'F12 a completed consent can still be VOIDED per policy');

SELECT pg_temp.expect_error($$
  UPDATE "ConsentAssignment"
  SET status = 'VOIDED', "voidedAt" = now(), "voidedById" = '0a000000-0000-7000-8000-bda01469c352', "voidReason" = repeat('x', 501)
  WHERE id = '0a000000-0000-7000-8000-00000000ca02'$$,
  '23514', 'F35 a void reason is at most 500 characters');

SELECT pg_temp.expect_ok($$
  UPDATE "ConsentAssignment"
  SET status = 'VOIDED', "voidedAt" = now(), "voidedById" = '0a000000-0000-7000-8000-bda01469c352', "voidReason" = 'Prepared in error'
  WHERE id = '0a000000-0000-7000-8000-00000000ca02'$$,
  'F36 a draft consent is discarded by voiding it with a reason');

SELECT pg_temp.expect_error($$
  DELETE FROM "ConsentAssignment" WHERE id = '0a000000-0000-7000-8000-00000000ca02'$$,
  'AE001', 'F37 a consent is never deleted');

-- =============================================================================
-- Education content and its assignment (Bible 12.5, 12.6; ADR-0028 K4-17, K4-18)
-- =============================================================================
INSERT INTO "EducationContent" (id, "organizationId", "contentType", title, "updatedAt") VALUES
  ('0a000000-0000-7000-8000-00000000a441', '0a000000-0000-7000-8000-000000000001', 'PROCEDURE_EXPLANATION', 'About lip filler', now()),
  ('0a000000-0000-7000-8000-00000000a444', '0a000000-0000-7000-8000-000000000001', 'POST_OP_INSTRUCTION', 'After lip filler', now());

SELECT pg_temp.expect_error($$
  INSERT INTO "EducationContentVersion" (id, "organizationId", "contentId", "versionNumber", status, body, "publishedAt", "publishedById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-00000000a444', 1, 'PUBLISHED',
          '{"text":"Avoid heat for 48h"}', now(), '0a000000-0000-7000-8000-bda01469c352', now())$$,
  '23514', 'F38 publishing education records its source and licence');

INSERT INTO "EducationContentVersion" (id, "organizationId", "contentId", "versionNumber", status, body, source, license,
                                       "publishedAt", "publishedById", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-00000000a442', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-00000000a441', 1, 'PUBLISHED',
   '{"text":"What to expect"}', 'Practice A1 clinical team', 'Original work of the practice', now(), '0a000000-0000-7000-8000-bda01469c352', now()),
  ('0a000000-0000-7000-8000-00000000a445', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-00000000a444', 1, 'PUBLISHED',
   '{"text":"Avoid heat for 48h"}', 'Practice A1 clinical team', 'Original work of the practice', now(), '0a000000-0000-7000-8000-bda01469c352', now());
INSERT INTO "EducationContentVersion" (id, "organizationId", "contentId", "versionNumber", body, "updatedAt") VALUES
  ('0a000000-0000-7000-8000-00000000a443', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-00000000a441', 2,
   '{"text":"What to expect (revised)"}', now());

SELECT pg_temp.expect_error($$
  INSERT INTO "ContentAssignment" (id, "organizationId", "patientId", "contentVersionId", "assignedById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-00000000a443', '0a000000-0000-7000-8000-bda01469c352', now())$$,
  'AE001', 'F39 education is assigned only from a PUBLISHED version');

SELECT pg_temp.expect_ok($$
  INSERT INTO "ContentAssignment" (id, "organizationId", "patientId", "contentVersionId", "consultationId", "assignedById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-00000000a442', '0a000000-0000-7000-8000-e60f6eb6f3af', '0a000000-0000-7000-8000-bda01469c352', now())$$,
  'F40 a PUBLISHED version is assigned');

SELECT pg_temp.expect_error($$
  INSERT INTO "PatientInstruction" (id, "organizationId", "patientId", "contentVersionId", "consultationId", "assignedById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-00000000a442', '0a000000-0000-7000-8000-e60f6eb6f3af', '0a000000-0000-7000-8000-bda01469c352', now())$$,
  'AE001', 'F41 an instruction points at pre-op or post-op instruction content');

SELECT pg_temp.expect_ok($$
  INSERT INTO "PatientInstruction" (id, "organizationId", "patientId", "contentVersionId", "consultationId", "assignedById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-00000000a445', '0a000000-0000-7000-8000-e60f6eb6f3af', '0a000000-0000-7000-8000-bda01469c352', now())$$,
  'F42 a published post-op instruction is assigned by consultation');

-- =============================================================================
-- J. Treatment plans, procedures, estimates and exports (Bible 11, 22.4;
--    ADR-0028 K4-03 to K4-10, K4-21)
-- =============================================================================
INSERT INTO "TreatmentCategory" (id, "organizationId", name, "updatedAt") VALUES
  ('0a000000-0000-7000-8000-00000000a421', '0a000000-0000-7000-8000-000000000001', 'Injectables', now());
INSERT INTO "Treatment" (id, "organizationId", "categoryId", name, "defaultUnitPrice", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-00000000a422', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-00000000a421', 'Lip filler', 400, now());

SELECT pg_temp.expect_error($$
  INSERT INTO "TreatmentPlan" (id, "organizationId", "patientId", "practiceId", title, status, "createdById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871', '0a000000-0000-7000-8000-0000000000a1',
          'Plan X', 'PROPOSED', '0a000000-0000-7000-8000-bda01469c352', now())$$,
  'AE001', 'J1 a plan is created DRAFT');

-- Options A and B of one consultation; C and D stand alone.
INSERT INTO "TreatmentPlan" (id, "organizationId", "patientId", "consultationId", "practiceId", "optionLabel", title, "createdById", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-00000000a401', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-e60f6eb6f3af', '0a000000-0000-7000-8000-0000000000a1', 'Plan A', 'Lips', '0a000000-0000-7000-8000-bda01469c352', now()),
  ('0a000000-0000-7000-8000-00000000a402', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-e60f6eb6f3af', '0a000000-0000-7000-8000-0000000000a1', 'Plan B', 'Lips, staged', '0a000000-0000-7000-8000-bda01469c352', now()),
  ('0a000000-0000-7000-8000-00000000a403', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   NULL, '0a000000-0000-7000-8000-0000000000a1', NULL, 'Standalone draft', '0a000000-0000-7000-8000-bda01469c352', now()),
  ('0a000000-0000-7000-8000-00000000a404', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   NULL, '0a000000-0000-7000-8000-0000000000a1', NULL, 'Standalone option', '0a000000-0000-7000-8000-bda01469c352', now());

SELECT pg_temp.expect_error($$
  INSERT INTO "TreatmentPlanItem" (id, "organizationId", "patientId", "treatmentPlanId", "treatmentId", quantity, "unitPrice", "lineTotal", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871', '0a000000-0000-7000-8000-00000000a401',
          '0a000000-0000-7000-8000-00000000a422', 1.5, 333.33, 499.99, now())$$,
  '23514', 'J2 a line total is quantity x unit price, rounded half-up to cents, less the discount');

SELECT pg_temp.expect_error($$
  INSERT INTO "TreatmentPlanItem" (id, "organizationId", "patientId", "treatmentPlanId", "treatmentId", quantity, "unitPrice", "discountAmount", "lineTotal", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871', '0a000000-0000-7000-8000-00000000a401',
          '0a000000-0000-7000-8000-00000000a422', 1, 400, 401, -1, now())$$,
  '23514', 'J3 a discount never exceeds the line amount');

SELECT pg_temp.expect_ok($$
  INSERT INTO "TreatmentPlanItem" (id, "organizationId", "patientId", "treatmentPlanId", "treatmentId", quantity, "unitPrice", "lineTotal", "updatedAt")
  VALUES ('0a000000-0000-7000-8000-00000000a411', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-00000000a401', '0a000000-0000-7000-8000-00000000a422', 1.5, 333.33, 500.00, now())$$,
  'J4 a correctly priced line is accepted');

INSERT INTO "TreatmentPlanItem" (id, "organizationId", "patientId", "treatmentPlanId", "treatmentId", "unitPrice", "lineTotal", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-00000000a412', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-00000000a402', '0a000000-0000-7000-8000-00000000a422', 400, 400, now()),
  ('0a000000-0000-7000-8000-00000000a414', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-00000000a404', '0a000000-0000-7000-8000-00000000a422', 400, 400, now());

SELECT pg_temp.expect_error($$
  UPDATE "TreatmentPlan" SET currency = 'EUR' WHERE id = '0a000000-0000-7000-8000-00000000a401'$$,
  '23514', 'J5 amounts are in USD');

UPDATE "TreatmentPlan" SET status = 'PROPOSED', subtotal = 500, "estimatedTotal" = 500 WHERE id = '0a000000-0000-7000-8000-00000000a401';
UPDATE "TreatmentPlan" SET status = 'PROPOSED', subtotal = 400, "estimatedTotal" = 400
WHERE id IN ('0a000000-0000-7000-8000-00000000a402', '0a000000-0000-7000-8000-00000000a404');

SELECT pg_temp.expect_error($$
  UPDATE "TreatmentPlanItem" SET notes = 'Upper lip only' WHERE id = '0a000000-0000-7000-8000-00000000a411'$$,
  'AE001', 'J6 the items of a proposed plan are frozen');

SELECT pg_temp.expect_error($$
  UPDATE "TreatmentPlan" SET title = 'Lips and chin' WHERE id = '0a000000-0000-7000-8000-00000000a401'$$,
  'AE001', 'J7 a proposed plan''s content is frozen');

SELECT pg_temp.expect_ok($$
  UPDATE "TreatmentPlan" SET status = 'DRAFT' WHERE id = '0a000000-0000-7000-8000-00000000a401'$$,
  'J8 a proposed option is revised back to DRAFT');
UPDATE "TreatmentPlanItem" SET notes = 'Upper lip only' WHERE id = '0a000000-0000-7000-8000-00000000a411';
UPDATE "TreatmentPlan" SET status = 'PROPOSED' WHERE id = '0a000000-0000-7000-8000-00000000a401';

INSERT INTO "PatientHandoff" (id, "organizationId", "patientId", purpose, "treatmentPlanId", "openedById",
                              "sessionId", "deviceId", "tokenHash", "identityConfirmedAt", "absoluteExpiresAt") VALUES
  ('0a000000-0000-7000-8000-0000000004f2', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871', 'PLAN_RESPONSE',
   '0a000000-0000-7000-8000-00000000a401', '0a000000-0000-7000-8000-bda01469c352',
   '0a000000-0000-7000-8000-0000000004e1', '0a000000-0000-7000-8000-0000000004d1', repeat('2', 64), now(), now() + interval '60 minutes'),
  ('0a000000-0000-7000-8000-0000000004f3', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871', 'PLAN_RESPONSE',
   '0a000000-0000-7000-8000-00000000a402', '0a000000-0000-7000-8000-bda01469c352',
   '0a000000-0000-7000-8000-0000000004e1', '0a000000-0000-7000-8000-0000000004d1', repeat('3', 64), now(), now() + interval '60 minutes');

SELECT pg_temp.expect_error($$
  UPDATE "TreatmentPlan" SET status = 'ACCEPTED', "respondedAt" = now(), "responseSource" = 'IN_CLINIC'
  WHERE id = '0a000000-0000-7000-8000-00000000a401'$$,
  '23514', 'J9 an in-clinic response records the hand-off, the attestation and the typed name');

SELECT pg_temp.expect_error($$
  UPDATE "TreatmentPlan" SET status = 'ACCEPTED', "respondedAt" = now(), "responseSource" = 'IN_CLINIC',
         "responseHandoffId" = '0a000000-0000-7000-8000-0000000004f3', "responseSignerName" = 'Ann Lee',
         "responseAttestation" = 'Accepting this plan is not consent to treatment.'
  WHERE id = '0a000000-0000-7000-8000-00000000a401'$$,
  'AE001', 'J10 an in-clinic response names a hand-off of this plan');

SELECT pg_temp.expect_ok($$
  UPDATE "TreatmentPlan" SET status = 'ACCEPTED', "respondedAt" = now(), "responseSource" = 'IN_CLINIC',
         "responseHandoffId" = '0a000000-0000-7000-8000-0000000004f2', "responseSignerName" = 'Ann Lee',
         "responseAttestation" = 'Accepting this plan is not consent to treatment.'
  WHERE id = '0a000000-0000-7000-8000-00000000a401'$$,
  'J11 the patient''s in-clinic acceptance is recorded');

SELECT pg_temp.expect_error($$
  UPDATE "TreatmentPlan" SET status = 'ACCEPTED', "respondedAt" = now(), "responseSource" = 'IN_CLINIC',
         "responseHandoffId" = '0a000000-0000-7000-8000-0000000004f3', "responseSignerName" = 'Ann Lee',
         "responseAttestation" = 'Accepting this plan is not consent to treatment.'
  WHERE id = '0a000000-0000-7000-8000-00000000a402'$$,
  '23505', 'J12 at most one option of a consultation is accepted');

SELECT pg_temp.expect_error($$
  UPDATE "TreatmentPlan" SET status = 'DECLINED', "respondedAt" = now(), "responseSource" = 'SIBLING_ACCEPTED',
         "acceptedSiblingId" = '0a000000-0000-7000-8000-00000000a404'
  WHERE id = '0a000000-0000-7000-8000-00000000a402'$$,
  'AE001', 'J13 a sibling decline names an accepted option of the same consultation');

SELECT pg_temp.expect_ok($$
  UPDATE "TreatmentPlan" SET status = 'DECLINED', "respondedAt" = now(), "responseSource" = 'SIBLING_ACCEPTED',
         "acceptedSiblingId" = '0a000000-0000-7000-8000-00000000a401'
  WHERE id = '0a000000-0000-7000-8000-00000000a402'$$,
  'J14 the other option declines when one is accepted');

SELECT pg_temp.expect_error($$
  UPDATE "TreatmentPlan" SET "responseSignerName" = 'A. Lee' WHERE id = '0a000000-0000-7000-8000-00000000a401'$$,
  'AE001', 'J15 a recorded response never changes');

UPDATE "TreatmentPlan" SET status = 'SCHEDULED' WHERE id = '0a000000-0000-7000-8000-00000000a401';

SELECT pg_temp.expect_error($$
  INSERT INTO "Procedure" (id, "organizationId", "patientId", "practiceId", "treatmentId", status, "scheduledFor", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871', '0a000000-0000-7000-8000-0000000000a1',
          '0a000000-0000-7000-8000-00000000a422', 'SCHEDULED', now(), now())$$,
  'AE001', 'J16 a procedure is created PLANNED');

INSERT INTO "Procedure" (id, "organizationId", "patientId", "practiceId", "treatmentId", "treatmentPlanItemId", "createdById", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-00000000a431', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-0000000000a1', '0a000000-0000-7000-8000-00000000a422', '0a000000-0000-7000-8000-00000000a411',
   '0a000000-0000-7000-8000-bda01469c352', now());

SELECT pg_temp.expect_error($$
  UPDATE "Procedure" SET status = 'SCHEDULED' WHERE id = '0a000000-0000-7000-8000-00000000a431'$$,
  '23514', 'J17 a scheduled procedure has a time');

SELECT pg_temp.expect_error($$
  UPDATE "TreatmentPlan" SET status = 'COMPLETED' WHERE id = '0a000000-0000-7000-8000-00000000a401'$$,
  'AE001', 'J18 a plan completes only when its procedures are closed');

UPDATE "Procedure" SET status = 'SCHEDULED', "scheduledFor" = now() + interval '7 days' WHERE id = '0a000000-0000-7000-8000-00000000a431';

SELECT pg_temp.expect_error($$
  UPDATE "Procedure" SET status = 'COMPLETED' WHERE id = '0a000000-0000-7000-8000-00000000a431'$$,
  '23514', 'J19 a completed procedure records its performer and time');

UPDATE "Procedure" SET status = 'COMPLETED', "performedByUserId" = '0a000000-0000-7000-8000-bda01469c352', "performedAt" = now()
WHERE id = '0a000000-0000-7000-8000-00000000a431';

SELECT pg_temp.expect_error($$
  UPDATE "Procedure" SET notes = 'Edited later' WHERE id = '0a000000-0000-7000-8000-00000000a431'$$,
  'AE001', 'J20 a closed procedure is frozen');

SELECT pg_temp.expect_error($$
  DELETE FROM "Procedure" WHERE id = '0a000000-0000-7000-8000-00000000a431'$$,
  'AE001', 'J21 a procedure is never deleted');

SELECT pg_temp.expect_ok($$
  UPDATE "TreatmentPlan" SET status = 'COMPLETED' WHERE id = '0a000000-0000-7000-8000-00000000a401'$$,
  'J22 a plan completes once its procedures are closed');

SELECT pg_temp.expect_error($$
  UPDATE "TreatmentPlan" SET notes = 'Follow-up' WHERE id = '0a000000-0000-7000-8000-00000000a401'$$,
  'AE001', 'J23 a closed plan is frozen');

SELECT pg_temp.expect_error($$
  UPDATE "TreatmentPlan" SET status = 'CANCELLED', "cancelledAt" = now(), "cancelledById" = '0a000000-0000-7000-8000-bda01469c352'
  WHERE id = '0a000000-0000-7000-8000-00000000a403'$$,
  '23514', 'J24 cancelling a plan needs a reason');

SELECT pg_temp.expect_ok($$
  UPDATE "TreatmentPlan" SET status = 'CANCELLED', "cancelledAt" = now(), "cancelledById" = '0a000000-0000-7000-8000-bda01469c352',
         "cancellationReason" = 'Patient chose another option'
  WHERE id = '0a000000-0000-7000-8000-00000000a403'$$,
  'J25 a draft is discarded by cancelling it with a reason');

SELECT pg_temp.expect_error($$
  DELETE FROM "TreatmentPlan" WHERE id = '0a000000-0000-7000-8000-00000000a403'$$,
  'AE001', 'J26 a plan is never deleted');

SELECT pg_temp.expect_error($$
  INSERT INTO "Estimate" (id, "organizationId", "patientId", "treatmentPlanId", "versionNumber", status, currency,
                          subtotal, "discountTotal", total, "lineItemsSnapshot", "issuedAt", "createdById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871', '0a000000-0000-7000-8000-00000000a403',
          1, 'ISSUED', 'USD', 0, 0, 0, '[]', now(), '0a000000-0000-7000-8000-bda01469c352', now())$$,
  'AE001', 'J27 an estimate is issued only for a PROPOSED, ACCEPTED or SCHEDULED plan');

INSERT INTO "Estimate" (id, "organizationId", "patientId", "treatmentPlanId", "versionNumber", status, currency,
                        subtotal, "discountTotal", total, "lineItemsSnapshot", "issuedAt", "createdById", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-00000000a451', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-00000000a404', 1, 'ISSUED', 'USD', 400, 0, 400, '[]', now(), '0a000000-0000-7000-8000-bda01469c352', now());

SELECT pg_temp.expect_error($$
  INSERT INTO "Estimate" (id, "organizationId", "patientId", "treatmentPlanId", "versionNumber", status, currency,
                          subtotal, "discountTotal", total, "lineItemsSnapshot", "issuedAt", "createdById", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871', '0a000000-0000-7000-8000-00000000a404',
          2, 'ISSUED', 'USD', 400, 0, 400, '[]', now(), '0a000000-0000-7000-8000-bda01469c352', now())$$,
  '23505', 'J28 a plan has at most one current estimate');

UPDATE "Estimate" SET status = 'SUPERSEDED', "supersededAt" = now() WHERE id = '0a000000-0000-7000-8000-00000000a451';
SELECT pg_temp.expect_ok($$
  INSERT INTO "Estimate" (id, "organizationId", "patientId", "treatmentPlanId", "versionNumber", status, currency,
                          subtotal, "discountTotal", total, "lineItemsSnapshot", "issuedAt", "createdById", "updatedAt")
  VALUES ('0a000000-0000-7000-8000-00000000a452', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-00000000a404', 2, 'ISSUED', 'USD', 400, 0, 400, '[]', now(), '0a000000-0000-7000-8000-bda01469c352', now())$$,
  'J29 a new estimate is issued once the previous one is superseded');

SELECT pg_temp.expect_error($$
  UPDATE "Estimate" SET status = 'DRAFT' WHERE id = '0a000000-0000-7000-8000-00000000a452'$$,
  'AE001', 'R8 an issued estimate cannot return to DRAFT');

SELECT pg_temp.expect_error($$
  UPDATE "Estimate" SET status = 'VOID', "voidedAt" = now(), "voidedById" = '0a000000-0000-7000-8000-bda01469c352'
  WHERE id = '0a000000-0000-7000-8000-00000000a452'$$,
  '23514', 'J30 voiding an estimate needs a reason');

SELECT pg_temp.expect_ok($$
  UPDATE "Estimate" SET status = 'VOID', "voidedAt" = now(), "voidedById" = '0a000000-0000-7000-8000-bda01469c352', "voidReason" = 'Wrong price'
  WHERE id = '0a000000-0000-7000-8000-00000000a452'$$,
  'R9 an issued estimate can still be voided');

SELECT pg_temp.expect_error($$
  INSERT INTO "DataExportJob" (id, "organizationId", "requestedById", purpose, scope, "idempotencyKey", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-bda01469c352',
          'PATIENT_REQUEST', '{}', 'exp-0', now())$$,
  '23514', 'J31 a Layer 4 export covers one patient');

SELECT pg_temp.expect_error($$
  INSERT INTO "DataExportJob" (id, "organizationId", "patientId", "requestedById", purpose, scope, "idempotencyKey", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-bda01469c352', 'OTHER', '{}', 'exp-1', now())$$,
  '23514', 'J32 an export for another purpose needs a note');

SELECT pg_temp.expect_error($$
  INSERT INTO "DataExportJob" (id, "organizationId", "patientId", "requestedById", purpose, scope, status, "idempotencyKey", "updatedAt")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
          '0a000000-0000-7000-8000-bda01469c352', 'PATIENT_REQUEST', '{}', 'RUNNING', 'exp-2', now())$$,
  'AE001', 'J33 an export is created REQUESTED');

INSERT INTO "DataExportJob" (id, "organizationId", "patientId", "requestedById", purpose, scope, "idempotencyKey", "updatedAt") VALUES
  ('0a000000-0000-7000-8000-00000000a461', '0a000000-0000-7000-8000-000000000001', '0a000000-0000-7000-8000-8f01aa50d871',
   '0a000000-0000-7000-8000-bda01469c352', 'TRANSFER_OF_CARE', '{}', 'exp-3', now());

SELECT pg_temp.expect_error($$
  UPDATE "DataExportJob" SET status = 'EXPIRED' WHERE id = '0a000000-0000-7000-8000-00000000a461'$$,
  'AE001', 'J34 an export follows its machine (no REQUESTED -> EXPIRED)');

-- =============================================================================
-- R. Regression tests for defects found by the independent review (spec 11.3)
-- =============================================================================
SELECT pg_temp.expect_error($$
  UPDATE "ConsentAssignment" SET status = 'COMPLETE' WHERE id = '0a000000-0000-7000-8000-00000000ca03'$$,
  'AE001', 'R5 a VOIDED consent is terminal (cannot be re-completed)');

SELECT pg_temp.expect_error($$
  UPDATE "ConsentAssignment" SET status = 'DRAFT' WHERE id = '0a000000-0000-7000-8000-00000000ca01'$$,
  'AE001', 'R6 an executed consent cannot be reopened to DRAFT for editing');

SELECT pg_temp.expect_error($$
  UPDATE "EducationContentVersion" SET status = 'DRAFT' WHERE id = '0a000000-0000-7000-8000-00000000a445'$$,
  'AE001', 'R7 published education content cannot return to DRAFT');
