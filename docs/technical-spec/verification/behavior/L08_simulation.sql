-- =============================================================================
-- LAYER 8 - Outcome simulation (spec §5.8)
-- =============================================================================
-- =============================================================================
-- E. AI provenance & review (Bible 9, 34.2)
-- =============================================================================
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
-- R. Regression tests for defects found by the independent review (spec 11.3)
-- =============================================================================
INSERT INTO "SimulationParameter" (id, "organizationId", "simulationVersionId", key, "numericValue")
SELECT gen_random_uuid(), v."organizationId", v.id, 'upperLipVolume', 0.4 FROM "SimulationVersion" v WHERE v."versionNumber" = 1;
SELECT pg_temp.expect_error($$
  UPDATE "SimulationParameter" SET "numericValue" = 0.9 WHERE key = 'upperLipVolume'$$,
  'AE001', 'R14 simulation parameters (provenance) are append-only');

SELECT pg_temp.expect_error($$
  INSERT INTO "SimulationApproval" (id, "organizationId", "patientId", "simulationId", "simulationVersionId", decision, "reviewerUserId")
  SELECT gen_random_uuid(), v."organizationId", v."patientId", v."simulationId", v.id, 'REJECTED',
         (SELECT id FROM "User" WHERE email = 'dr.b@example.test')
  FROM "SimulationVersion" v WHERE v."versionNumber" = 1$$,
  '23503', 'R18 the reviewing provider must be a provider of the same organization');
