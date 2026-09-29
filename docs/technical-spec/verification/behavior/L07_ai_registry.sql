-- =============================================================================
-- LAYER 7 - AI infrastructure (spec §5.8)
-- =============================================================================
-- =============================================================================
-- E. AI provenance: model registry and rollouts (Bible 9.7)
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

-- =============================================================================
-- R. Regression tests for defects found by the independent review (spec 11.3)
-- =============================================================================
SELECT pg_temp.expect_error($$
  UPDATE "AIModel" SET key = 'lip-visualizer-v2' WHERE key = 'lip-visualizer'$$,
  'AE001', 'R10 a registered model identity cannot change');

SELECT pg_temp.expect_error($$
  UPDATE "AIModelRollout" SET reason = 'edited in place' WHERE state = 'ACTIVE' AND "organizationId" IS NULL$$,
  'AE001', 'R11 an active rollout row cannot be edited in place (only deactivated)');
SELECT pg_temp.expect_ok($$
  UPDATE "AIModelRollout" SET state = 'INACTIVE', "deactivatedAt" = now() WHERE state = 'ACTIVE' AND "organizationId" IS NULL$$,
  'R12 an active rollout can be deactivated');
SELECT pg_temp.expect_error($$
  UPDATE "AIModelRollout" SET state = 'ACTIVE', "deactivatedAt" = NULL WHERE state = 'INACTIVE'$$,
  'AE001', 'R13 a deactivated rollout cannot be re-activated in place (rollback = new row)');
