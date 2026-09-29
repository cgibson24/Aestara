-- =============================================================================
-- LAYER 4 - Documents, consent, education, treatment plans (spec §5.8)
-- =============================================================================
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
-- R. Regression tests for defects found by the independent review (spec 11.3)
-- =============================================================================
SELECT pg_temp.expect_error($$
  UPDATE "ConsentAssignment" SET status = 'COMPLETE' WHERE status = 'VOIDED'$$,
  'AE001', 'R5 a VOIDED consent is terminal (cannot be re-completed)');

-- second executed consent to prove COMPLETE cannot be reopened
INSERT INTO "StorageObject" (id, "organizationId", "objectClass", bucket, "objectKey", "contentType", sha256, status, "verifiedAt")
VALUES (gen_random_uuid(), (SELECT id FROM "Organization" WHERE slug = 'org-a'), 'DOCUMENT', 'clinical', 'org-a/doc2', 'application/pdf', repeat('7', 64), 'AVAILABLE', now());
INSERT INTO "DocumentVersion" (id, "organizationId", "patientId", "documentId", "versionNumber", "storageObjectId", sha256)
SELECT gen_random_uuid(), d."organizationId", d."patientId", d.id, 2, (SELECT id FROM "StorageObject" WHERE "objectKey" = 'org-a/doc2'), repeat('7', 64)
FROM "Document" d WHERE d.title = 'Filler consent (signed)';
INSERT INTO "ConsentAssignment" (id, "organizationId", "patientId", "templateVersionId", status, responses, "assignedById",
                                 "completedAt", "signedDocumentVersionId", "signedSnapshotHash", "updatedAt")
SELECT gen_random_uuid(), dv."organizationId", dv."patientId",
       (SELECT id FROM "ConsentTemplateVersion" WHERE status = 'PUBLISHED' LIMIT 1), 'COMPLETE', '{"ack1":true}', (SELECT id FROM "User" WHERE email = 'dr.a@example.test'),
       now(), dv.id, repeat('7', 64), now()
FROM "DocumentVersion" dv WHERE dv."versionNumber" = 2;

SELECT pg_temp.expect_error($$
  UPDATE "ConsentAssignment" SET status = 'DRAFT' WHERE status = 'COMPLETE'$$,
  'AE001', 'R6 an executed consent cannot be reopened to DRAFT for editing');

INSERT INTO "EducationContent" (id, "organizationId", "contentType", title, "updatedAt")
VALUES (gen_random_uuid(), (SELECT id FROM "Organization" WHERE slug = 'org-a'), 'POST_OP_INSTRUCTION', 'After lip filler', now());
INSERT INTO "EducationContentVersion" (id, "organizationId", "contentId", "versionNumber", status, body, "publishedAt", "updatedAt")
SELECT gen_random_uuid(), c."organizationId", c.id, 1, 'PUBLISHED', '{"text":"Avoid heat for 48h"}', now(), now()
FROM "EducationContent" c WHERE c.title = 'After lip filler';

SELECT pg_temp.expect_error($$
  UPDATE "EducationContentVersion" SET status = 'DRAFT' WHERE status = 'PUBLISHED'$$,
  'AE001', 'R7 published education content cannot return to DRAFT');

INSERT INTO "TreatmentCategory" (id, "organizationId", name, "updatedAt") VALUES (gen_random_uuid(), (SELECT id FROM "Organization" WHERE slug = 'org-a'), 'Injectables', now());
INSERT INTO "Treatment" (id, "organizationId", "categoryId", name, "updatedAt")
SELECT gen_random_uuid(), c."organizationId", c.id, 'Lip filler', now() FROM "TreatmentCategory" c WHERE c.name = 'Injectables';
INSERT INTO "TreatmentPlan" (id, "organizationId", "patientId", "practiceId", title, "createdById", "updatedAt")
VALUES (gen_random_uuid(), (SELECT id FROM "Organization" WHERE slug = 'org-a'), (SELECT id FROM "Patient" WHERE mrn = 'MRN-1' AND "organizationId" = (SELECT id FROM "Organization" WHERE slug = 'org-a')), (SELECT id FROM "Practice" WHERE name = 'Practice A1'), 'Plan A', (SELECT id FROM "User" WHERE email = 'dr.a@example.test'), now());
INSERT INTO "Estimate" (id, "organizationId", "patientId", "treatmentPlanId", "versionNumber", status, currency,
                        subtotal, "discountTotal", total, "lineItemsSnapshot", "issuedAt", "createdById", "updatedAt")
SELECT gen_random_uuid(), t."organizationId", t."patientId", t.id, 1, 'ISSUED', 'USD', 800, 0, 800, '[]', now(), (SELECT id FROM "User" WHERE email = 'dr.a@example.test'), now()
FROM "TreatmentPlan" t WHERE t.title = 'Plan A';

SELECT pg_temp.expect_error($$
  UPDATE "Estimate" SET status = 'DRAFT' WHERE status = 'ISSUED'$$,
  'AE001', 'R8 an issued estimate cannot return to DRAFT');
SELECT pg_temp.expect_ok($$
  UPDATE "Estimate" SET status = 'VOID' WHERE status = 'ISSUED'$$,
  'R9 an issued estimate can still be voided');
