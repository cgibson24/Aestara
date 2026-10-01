-- =============================================================================
-- Row-Level Security and database roles (spec §3.5; ADR-0004; ADR-0018 K-05,
-- K-06, K-16, K-18). Runs against packages/database migrations, after the
-- harness and the Layer 1 fragment (whose fixtures it reuses: tenants A and B,
-- dr.a in A, dr.b in B, patients in both).
--
-- The session is a superuser, which bypasses RLS. Each check therefore runs its
-- statement as one database role, with or without a tenant, inside the helpers
-- below, which switch role only for that statement.
-- =============================================================================

-- Runs stmt as role_name with app.organization_id = org (NULL = unset) and
-- returns how many rows it yields.
CREATE FUNCTION pg_temp.rows_as(role_name text, org uuid, stmt text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM set_config('app.organization_id', coalesce(org::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  EXECUTE format('SELECT count(*) FROM (%s) AS q', stmt) INTO n;
  RESET ROLE;
  PERFORM set_config('app.organization_id', '', true);
  RETURN n;
END;
$$;

CREATE FUNCTION pg_temp.expect_rows_as(role_name text, org uuid, stmt text, expected bigint, label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  n := pg_temp.rows_as(role_name, org, stmt);
  IF n IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'FAIL  % (expected % rows, got %)', label, expected, n;
  END IF;
  INSERT INTO _results VALUES (label, true);
  RAISE NOTICE 'PASS  %', label;
END;
$$;

CREATE FUNCTION pg_temp.expect_error_as(role_name text, org uuid, stmt text, expected text, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM set_config('app.organization_id', coalesce(org::text, ''), true);
    EXECUTE format('SET LOCAL ROLE %I', role_name);
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    IF SQLSTATE = expected THEN
      INSERT INTO _results VALUES (label, true);
      RAISE NOTICE 'PASS  %', label;
      RETURN;
    END IF;
    RAISE EXCEPTION 'FAIL  % (expected %, got %: %)', label, expected, SQLSTATE, SQLERRM;
  END;
  RESET ROLE;
  RAISE EXCEPTION 'FAIL  % (expected %, but the statement succeeded)', label, expected;
END;
$$;

CREATE FUNCTION pg_temp.expect_ok_as(role_name text, org uuid, stmt text, label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.organization_id', coalesce(org::text, ''), true);
  EXECUTE format('SET LOCAL ROLE %I', role_name);
  EXECUTE stmt;
  RESET ROLE;
  PERFORM set_config('app.organization_id', '', true);
  INSERT INTO _results VALUES (label, true);
  RAISE NOTICE 'PASS  %', label;
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'FAIL  % (expected success, got %: %)', label, SQLSTATE, SQLERRM;
END;
$$;

-- -----------------------------------------------------------------------------
-- Fixtures: a platform operator with a SUPER_ADMIN grant, an organization
-- setting, a contact, platform-level and tenant audit events, idempotency keys.
-- -----------------------------------------------------------------------------
INSERT INTO "User" (id, kind, email, status, "updatedAt") VALUES
  ('0c000000-0000-7000-8000-000000000001', 'WORKFORCE', 'ops@example.test', 'ACTIVE', now());
INSERT INTO "UserRole" (id, "userId", "roleId", scope) VALUES
  (gen_random_uuid(), '0c000000-0000-7000-8000-000000000001',
   (SELECT id FROM "Role" WHERE key = 'SUPER_ADMIN' AND "organizationId" IS NULL), 'PLATFORM');
INSERT INTO "UserRole" (id, "userId", "organizationId", "roleId", scope) VALUES
  (gen_random_uuid(), '0a000000-0000-7000-8000-bda01469c352', '0a000000-0000-7000-8000-000000000001',
   (SELECT id FROM "Role" WHERE key = 'ORGANIZATION_ADMIN' AND "organizationId" IS NULL), 'ORGANIZATION');
INSERT INTO "OrganizationSetting" (id, "organizationId", key, value, "updatedAt") VALUES
  (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', 'security.mfaPolicy', '"fixture-policy"', now());
INSERT INTO "PatientContact" (id, "organizationId", "patientId", kind, "fullName", "updatedAt") VALUES
  (gen_random_uuid(), '0b000000-0000-7000-8000-000000000001', '0b000000-0000-7000-8000-fd76a7158ec0',
   'EMERGENCY_CONTACT', 'Contact B', now());
INSERT INTO "AuditEvent" (id, "organizationId", "actorType", "actorServiceId", action, "resourceType", "requestId") VALUES
  (gen_random_uuid(), NULL, 'SERVICE', 'platform', 'CONFIGURATION_CHANGED', 'Organization', 'req-platform-1'),
  (gen_random_uuid(), '0b000000-0000-7000-8000-000000000001', 'SERVICE', 'api', 'PATIENT_VIEWED', 'Patient', 'req-b-1');
INSERT INTO "IdempotencyKey" (id, "actorKey", key, "organizationId", method, "routeTemplate", "requestHash", "expiresAt") VALUES
  (gen_random_uuid(), 'user:dr.a', 'k-a', '0a000000-0000-7000-8000-000000000001', 'POST', '/patients', repeat('a', 64), now() + interval '7 days'),
  (gen_random_uuid(), 'user:dr.a', 'k-none', NULL, 'POST', '/auth/login', repeat('b', 64), now() + interval '7 days');

-- =============================================================================
-- S. Row-Level Security (application role)
-- =============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Organization', 'Practice', 'Location', 'Membership', 'UserRole', 'OrganizationSetting',
                           'ProviderProfile', 'StaffProfile', 'Patient', 'PatientContact', 'AuditEvent'] LOOP
    IF pg_temp.rows_as('aestara_app', NULL, format('SELECT 1 FROM %I', t)) <> 0 THEN
      RAISE EXCEPTION 'FAIL  S1 without a tenant the application sees rows of %', t;
    END IF;
  END LOOP;
  INSERT INTO _results VALUES ('S1 without a tenant the application sees no tenant rows (11 tables)', true);
  RAISE NOTICE 'PASS  S1 without a tenant the application sees no tenant rows (11 tables)';
END $$;

SELECT pg_temp.expect_rows_as('aestara_app', '0a000000-0000-7000-8000-000000000001',
  $$SELECT 1 FROM "Patient"$$,
  (SELECT count(*) FROM "Patient" WHERE "organizationId" = '0a000000-0000-7000-8000-000000000001'),
  'S2 with tenant A the application sees exactly the patients of A');

SELECT pg_temp.expect_rows_as('aestara_app', '0a000000-0000-7000-8000-000000000001',
  $$SELECT 1 FROM "Patient" WHERE id = '0b000000-0000-7000-8000-fd76a7158ec0'$$, 0,
  'S3 tenant A cannot read a patient of B by its id');

SELECT pg_temp.expect_rows_as('aestara_app', '0a000000-0000-7000-8000-000000000001',
  $$SELECT 1 FROM "PatientContact"$$, 0,
  'S4 tenant A cannot read the contacts of B''s patients');

SELECT pg_temp.expect_error_as('aestara_app', '0a000000-0000-7000-8000-000000000001', $$
  INSERT INTO "Patient" (id, "organizationId", "firstName", "lastName", "dateOfBirth", "updatedAt")
  VALUES (gen_random_uuid(), '0b000000-0000-7000-8000-000000000001', 'X', 'Y', '2000-01-01', now())$$,
  '42501', 'S5 tenant A cannot create a patient in B');

SELECT pg_temp.expect_error_as('aestara_app', '0a000000-0000-7000-8000-000000000001', $$
  UPDATE "Patient" SET "organizationId" = '0b000000-0000-7000-8000-000000000001'
  WHERE id = '0a000000-0000-7000-8000-8f01aa50d871'$$,
  '42501', 'S6 tenant A cannot move its patient into B');

DO $$
DECLARE n bigint;
BEGIN
  PERFORM set_config('app.organization_id', '0a000000-0000-7000-8000-000000000001', true);
  SET LOCAL ROLE aestara_app;
  UPDATE "Patient" SET "middleName" = 'x' WHERE id = '0b000000-0000-7000-8000-fd76a7158ec0';
  GET DIAGNOSTICS n = ROW_COUNT;
  RESET ROLE;
  IF n <> 0 OR EXISTS (SELECT 1 FROM "Patient" WHERE "middleName" = 'x') THEN
    RAISE EXCEPTION 'FAIL  S7 tenant A changed a patient of B';
  END IF;
  INSERT INTO _results VALUES ('S7 tenant A updating a patient of B changes nothing', true);
  RAISE NOTICE 'PASS  S7 tenant A updating a patient of B changes nothing';
END $$;

SELECT pg_temp.expect_rows_as('aestara_app', '0a000000-0000-7000-8000-000000000001',
  $$SELECT 1 FROM "UserRole" WHERE scope = 'PLATFORM'$$, 0,
  'S8 the application never sees platform-scope grants');

SELECT pg_temp.expect_rows_as('aestara_app', '0a000000-0000-7000-8000-000000000001',
  $$SELECT 1 FROM "Organization"$$, 1,
  'S9 the application sees only its own organization');

SELECT pg_temp.expect_rows_as('aestara_app', '0a000000-0000-7000-8000-000000000001',
  $$SELECT 1 FROM "Role"$$, (SELECT count(*) FROM "Role" WHERE "organizationId" IS NULL),
  'S10 system roles are visible in every tenant');

DO $$
BEGIN
  BEGIN
    PERFORM set_config('app.organization_id', 'not-a-uuid', true);
    SET LOCAL ROLE aestara_app;
    PERFORM 1 FROM "Patient";
    RAISE EXCEPTION 'FAIL  S11 a malformed tenant value was accepted';
  EXCEPTION WHEN invalid_text_representation THEN
    NULL;
  END;
  RESET ROLE;
  INSERT INTO _results VALUES ('S11 a malformed tenant value fails closed', true);
  RAISE NOTICE 'PASS  S11 a malformed tenant value fails closed';
END $$;

-- Audit: insert and read only (K-18), own tenant or platform-level.
SELECT pg_temp.expect_error_as('aestara_app', '0a000000-0000-7000-8000-000000000001',
  $$UPDATE "AuditEvent" SET "requestId" = 'x'$$, '42501', 'S12 the application cannot update audit events');
SELECT pg_temp.expect_error_as('aestara_app', '0a000000-0000-7000-8000-000000000001',
  $$DELETE FROM "AuditEvent"$$, '42501', 'S13 the application cannot delete audit events');
SELECT pg_temp.expect_error_as('aestara_app', '0a000000-0000-7000-8000-000000000001',
  $$DELETE FROM "LoginEvent"$$, '42501', 'S14 the application cannot delete login events');
SELECT pg_temp.expect_error_as('aestara_app', '0a000000-0000-7000-8000-000000000001',
  $$DELETE FROM "Patient"$$, '42501', 'S15 the application cannot delete patients');
SELECT pg_temp.expect_ok_as('aestara_app', '0a000000-0000-7000-8000-000000000001', $$
  INSERT INTO "AuditEvent" (id, "organizationId", "actorType", "actorUserId", action, "resourceType", "requestId")
  VALUES (gen_random_uuid(), '0a000000-0000-7000-8000-000000000001', 'USER', '0a000000-0000-7000-8000-bda01469c352',
          'PATIENT_VIEWED', 'Patient', 'req-a-1'),
         (gen_random_uuid(), NULL, 'USER', '0a000000-0000-7000-8000-bda01469c352', 'LOGIN_FAILURE', 'User', 'req-a-2')$$,
  'S16 the application writes audit events for its tenant and platform-level ones');
SELECT pg_temp.expect_error_as('aestara_app', '0a000000-0000-7000-8000-000000000001', $$
  INSERT INTO "AuditEvent" (id, "organizationId", "actorType", "actorUserId", action, "resourceType", "requestId")
  VALUES (gen_random_uuid(), '0b000000-0000-7000-8000-000000000001', 'USER', '0a000000-0000-7000-8000-bda01469c352',
          'PATIENT_VIEWED', 'Patient', 'req-a-3')$$,
  '42501', 'S17 the application cannot write audit events into another tenant');
SELECT pg_temp.expect_rows_as('aestara_app', '0a000000-0000-7000-8000-000000000001',
  $$SELECT 1 FROM "AuditEvent" WHERE "organizationId" IS DISTINCT FROM '0a000000-0000-7000-8000-000000000001'$$, 0,
  'S18 the application reads only its tenant''s audit events');

SELECT pg_temp.expect_rows_as('aestara_app', '0b000000-0000-7000-8000-000000000001',
  $$SELECT 1 FROM "IdempotencyKey"$$, 0,
  'S19 an idempotency key stored in tenant A is invisible to tenant B');
SELECT pg_temp.expect_rows_as('aestara_app', NULL,
  $$SELECT 1 FROM "IdempotencyKey"$$, 1,
  'S20 without a tenant only keys stored without a tenant are visible');

-- Search under the tenant policy (ADR-0020): 2,000 synthetic patients in B give
-- the planner a real choice. A leakproof prefix search must use its key index;
-- the old lower()/LIKE form must not, which is why the keys exist.
INSERT INTO "Patient" (id, "organizationId", "firstName", "lastName", "dateOfBirth", "updatedAt")
SELECT gen_random_uuid(), '0b000000-0000-7000-8000-000000000001', 'Synthetic',
       (ARRAY['Lee','Kim','Ng','Ortiz','Patel','Reyes','Shah','Tran'])[1 + n % 8] || n, date '1970-01-01' + n, now()
FROM generate_series(1, 2000) n;
ANALYZE "Patient";

CREATE FUNCTION pg_temp.plan_as_app(org uuid, stmt text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE plan text := ''; line text;
BEGIN
  PERFORM set_config('app.organization_id', org::text, true);
  EXECUTE 'SET LOCAL ROLE aestara_app';
  FOR line IN EXECUTE 'EXPLAIN (COSTS OFF) ' || stmt LOOP
    plan := plan || line || E'\n';
  END LOOP;
  RESET ROLE;
  PERFORM set_config('app.organization_id', '', true);
  RETURN plan;
END;
$$;

DO $$
DECLARE plan text;
BEGIN
  plan := pg_temp.plan_as_app('0b000000-0000-7000-8000-000000000001',
    $q$SELECT id FROM "Patient" WHERE "organizationId" = '0b000000-0000-7000-8000-000000000001'
         AND "lastNameKey" >= 'ortiz1' AND "lastNameKey" < 'ortiz2'
       ORDER BY "lastNameKey" LIMIT 25$q$);
  IF plan !~ 'Index Cond: [^\n]*"lastNameKey" >=' THEN
    RAISE EXCEPTION 'FAIL  S21 a prefix search under RLS did not use its key index:%', E'\n' || plan;
  END IF;
  plan := pg_temp.plan_as_app('0b000000-0000-7000-8000-000000000001',
    $q$SELECT id FROM "Patient" WHERE "organizationId" = '0b000000-0000-7000-8000-000000000001'
         AND lower("lastName") LIKE 'ortiz1%' LIMIT 25$q$);
  IF plan ~ 'Index Cond: [^\n]*lower' THEN
    RAISE EXCEPTION 'FAIL  S21 control: a non-leakproof predicate became an index condition:%', E'\n' || plan;
  END IF;
  INSERT INTO _results VALUES ('S21 under RLS a name-prefix search uses its key index; lower()/LIKE cannot', true);
  RAISE NOTICE 'PASS  S21 under RLS a name-prefix search uses its key index; lower()/LIKE cannot';
END $$;

SELECT pg_temp.expect_rows_as('aestara_app', '0b000000-0000-7000-8000-000000000001',
  $$SELECT 1 FROM "Patient" WHERE "organizationId" = '0b000000-0000-7000-8000-000000000001'
      AND "phoneKey" = '15550100199'$$, 0,
  'S22 a search key from another tenant''s patient is not found');

-- =============================================================================
-- P. Platform role: organization metadata only (ADR-0018 K-06)
-- =============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Patient', 'PatientContact', 'ProviderProfile', 'StaffProfile', 'OrganizationSetting'] LOOP
    BEGIN
      PERFORM pg_temp.rows_as('aestara_platform', NULL, format('SELECT 1 FROM %I', t));
      RAISE EXCEPTION 'FAIL  P1 the platform role could read %', t;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END LOOP;
  INSERT INTO _results VALUES ('P1 the platform role has no access to patient, profile or settings tables', true);
  RAISE NOTICE 'PASS  P1 the platform role has no access to patient, profile or settings tables';
END $$;

SELECT pg_temp.expect_rows_as('aestara_platform', NULL,
  $$SELECT 1 FROM "Organization"$$, (SELECT count(*) FROM "Organization"),
  'P2 the platform role reads every organization''s metadata');

SELECT pg_temp.expect_rows_as('aestara_platform', '0b000000-0000-7000-8000-000000000001',
  $$SELECT 1 FROM "AuditEvent" WHERE "organizationId" IS NOT NULL$$, 0,
  'P3 the platform role reads only platform-level audit events, even with a tenant set');

SELECT pg_temp.expect_error_as('aestara_platform', NULL,
  $$SELECT "passwordHash" FROM "UserCredential"$$, '42501',
  'P4 the platform role cannot read credential secrets');

SELECT pg_temp.expect_error_as('aestara_platform', NULL, $$
  INSERT INTO "UserRole" (id, "userId", "organizationId", "roleId", scope, "assignedById")
  VALUES (gen_random_uuid(), '0b000000-0000-7000-8000-bda01469c352', '0b000000-0000-7000-8000-000000000001',
          (SELECT id FROM "Role" WHERE key = 'SURGEON_PHYSICIAN' AND "organizationId" IS NULL), 'ORGANIZATION',
          '0c000000-0000-7000-8000-000000000001')$$,
  'AE002', 'P5 the platform role cannot grant a role with clinical permissions (spec §4.5 rule 2)');

SELECT pg_temp.expect_ok_as('aestara_platform', NULL, $$
  INSERT INTO "UserRole" (id, "userId", "organizationId", "roleId", scope, "assignedById")
  VALUES (gen_random_uuid(), '0b000000-0000-7000-8000-bda01469c352', '0b000000-0000-7000-8000-000000000001',
          (SELECT id FROM "Role" WHERE key = 'ORGANIZATION_ADMIN' AND "organizationId" IS NULL), 'ORGANIZATION',
          '0c000000-0000-7000-8000-000000000001')$$,
  'P6 the platform role can bootstrap an ORGANIZATION_ADMIN (ADR-0018 K-05)');

SELECT pg_temp.expect_error_as('aestara_platform', NULL,
  $$SELECT * FROM auth_sign_in_memberships('0a000000-0000-7000-8000-bda01469c352')$$, '42501',
  'P7 only the application may call the sign-in lookup');

-- =============================================================================
-- I. Sign-in lookup before a tenant is chosen (ADR-0018 K-03, K-16)
-- =============================================================================
SELECT pg_temp.expect_rows_as('aestara_app', NULL,
  $$SELECT 1 FROM auth_sign_in_memberships('0a000000-0000-7000-8000-bda01469c352')
    WHERE organization_id = '0a000000-0000-7000-8000-000000000001' AND membership_status = 'ACTIVE'
      AND mfa_policy = '"fixture-policy"' AND 'ORGANIZATION_ADMIN' = ANY (role_keys)$$, 1,
  'I1 the lookup returns the user''s membership, policy and roles without a tenant');

SELECT pg_temp.expect_rows_as('aestara_app', NULL,
  $$SELECT 1 FROM auth_sign_in_memberships('0a000000-0000-7000-8000-bda01469c352')
    WHERE organization_id IS DISTINCT FROM '0a000000-0000-7000-8000-000000000001'$$, 0,
  'I2 the lookup returns only the user''s own memberships');

SELECT pg_temp.expect_rows_as('aestara_app', NULL,
  $$SELECT 1 FROM auth_sign_in_memberships('0c000000-0000-7000-8000-000000000001')
    WHERE organization_id IS NULL AND role_keys = ARRAY['SUPER_ADMIN']$$, 1,
  'I3 the lookup reports platform-scope grants');

SELECT pg_temp.expect_rows_as('aestara_app', NULL,
  $$SELECT 1 FROM "Membership"$$, 0,
  'I4 the lookup is the only pre-tenant path to memberships');

-- =============================================================================
-- M. Layer 2: photography, storage, the outbox and the worker (ADR-0023)
-- Fixtures: an original and a photo in tenant B (the Layer 2 fragment created
-- tenant A's), and outbox rows written by the audit feed.
-- =============================================================================
INSERT INTO "StorageObject" (id, "organizationId", "objectClass", bucket, "objectKey", "contentType", sha256, status, "verifiedAt") VALUES
  ('0b000000-0000-7000-8000-5c00000000b1', '0b000000-0000-7000-8000-000000000001', 'CLINICAL_ORIGINAL', 'clinical', 'org-b/o1', 'image/jpeg', repeat('b', 64), 'AVAILABLE', now());
INSERT INTO "PatientPhoto" (id, "organizationId", "patientId", source, status, "originalObjectId", "capturedAt", "updatedAt") VALUES
  ('0b000000-0000-7000-8000-5e00000000b1', '0b000000-0000-7000-8000-000000000001', '0b000000-0000-7000-8000-fd76a7158ec0', 'PROVIDER_CAPTURE', 'ACCEPTED', '0b000000-0000-7000-8000-5c00000000b1', now(), now());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['StorageObject', 'PhotographyProtocol', 'PhotographyProtocolView', 'PhotoSession',
                           'PatientPhoto', 'PhotoDerivative', 'PhotoTag', 'PhotoPermission', 'MediaRelease',
                           'MediaReleasePermission', 'AIJob', 'PracticeSetting', 'RetentionPolicy'] LOOP
    IF pg_temp.rows_as('aestara_app', NULL, format('SELECT 1 FROM %I', t)) <> 0 THEN
      RAISE EXCEPTION 'FAIL  M1 without a tenant the application sees rows of %', t;
    END IF;
  END LOOP;
  -- Platform-wide flag rows (organizationId NULL) are readable everywhere by design.
  IF pg_temp.rows_as('aestara_app', NULL, 'SELECT 1 FROM "FeatureFlag" WHERE "organizationId" IS NOT NULL') <> 0 THEN
    RAISE EXCEPTION 'FAIL  M1 without a tenant the application sees organization flags';
  END IF;
  INSERT INTO _results VALUES ('M1 without a tenant the application sees no Layer 2 tenant rows (14 tables)', true);
  RAISE NOTICE 'PASS  M1 without a tenant the application sees no Layer 2 tenant rows (14 tables)';
END $$;

SELECT pg_temp.expect_rows_as('aestara_app', '0a000000-0000-7000-8000-000000000001',
  $$SELECT 1 FROM "PatientPhoto" WHERE id = '0b000000-0000-7000-8000-5e00000000b1'$$, 0,
  'M2 tenant A cannot read a photo of B by its id');

SELECT pg_temp.expect_rows_as('aestara_app', '0a000000-0000-7000-8000-000000000001',
  $$SELECT 1 FROM "StorageObject" WHERE "objectKey" = 'org-b/o1'$$, 0,
  'M3 tenant A cannot find B''s stored object by its key');

SELECT pg_temp.expect_error_as('aestara_app', '0a000000-0000-7000-8000-000000000001', $$
  INSERT INTO "StorageObject" (id, "organizationId", "objectClass", bucket, "objectKey", "contentType")
  VALUES (gen_random_uuid(), '0b000000-0000-7000-8000-000000000001', 'CLINICAL_ORIGINAL', 'clinical', 'org-b/x', 'image/jpeg')$$,
  '42501', 'M4 tenant A cannot register an object in B');

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['StorageObject', 'PatientPhoto', 'PhotoSession', 'PhotoDerivative', 'PhotoPermission',
                           'MediaRelease', 'MediaReleasePermission', 'AIJob', 'RetentionPolicy', 'OutboxEvent'] LOOP
    BEGIN
      PERFORM set_config('app.organization_id', '0a000000-0000-7000-8000-000000000001', true);
      SET LOCAL ROLE aestara_app;
      EXECUTE format('DELETE FROM %I', t);
      RESET ROLE;
      RAISE EXCEPTION 'FAIL  M5 the application could delete from %', t;
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE;
    END;
  END LOOP;
  INSERT INTO _results VALUES ('M5 the application cannot delete clinical media, permissions, jobs or the outbox', true);
  RAISE NOTICE 'PASS  M5 the application cannot delete clinical media, permissions, jobs or the outbox';
END $$;

SELECT pg_temp.expect_ok_as('aestara_app', '0a000000-0000-7000-8000-000000000001', $$
  INSERT INTO "OutboxEvent" (id, "organizationId", "eventType", "aggregateType", "aggregateId", payload)
  VALUES ('0a000000-0000-7000-8000-0e0000000001', '0a000000-0000-7000-8000-000000000001', 'photo.captured',
          'PatientPhoto', '0a000000-0000-7000-8000-599a1cc8f834', '{}')$$,
  'M6 the application appends outbox events for its tenant');

SELECT pg_temp.expect_error_as('aestara_app', '0a000000-0000-7000-8000-000000000001', $$
  INSERT INTO "OutboxEvent" (id, "organizationId", "eventType", "aggregateType", "aggregateId", payload)
  VALUES (gen_random_uuid(), '0b000000-0000-7000-8000-000000000001', 'photo.captured', 'PatientPhoto',
          '0b000000-0000-7000-8000-5e00000000b1', '{}')$$,
  '42501', 'M7 the application cannot append outbox events for another tenant');

SELECT pg_temp.expect_error_as('aestara_app', '0a000000-0000-7000-8000-000000000001',
  $$SELECT 1 FROM "OutboxEvent"$$, '42501',
  'M8 the application cannot read the outbox');

SELECT pg_temp.expect_rows_as('aestara_worker', NULL,
  $$SELECT 1 FROM "OutboxEvent" WHERE "eventType" = 'audit.recorded'$$,
  (SELECT count(*) FROM "AuditEvent"),
  'M9 every audit event has its WORM-feed outbox row, and the worker sees them all');

SELECT pg_temp.expect_rows_as('aestara_worker', NULL,
  $$SELECT 1 FROM "AuditEvent"$$, (SELECT count(*) FROM "AuditEvent"),
  'M10 the worker reads every tenant''s audit events for the WORM copy');

SELECT pg_temp.expect_rows_as('aestara_worker', NULL,
  $$SELECT "organizationId" FROM "StorageObject" WHERE "objectKey" = 'org-b/o1'$$, 1,
  'M11 the worker resolves an opaque key to its organization');

DO $$
DECLARE stmt text;
BEGIN
  FOREACH stmt IN ARRAY ARRAY[
    'SELECT sha256 FROM "StorageObject"', 'SELECT 1 FROM "Patient"', 'SELECT 1 FROM "PatientPhoto"',
    'SELECT name FROM "Organization"', 'SELECT "inputSummary" FROM "AIJob"'] LOOP
    BEGIN
      PERFORM pg_temp.rows_as('aestara_worker', NULL, format('SELECT 1 FROM (%s) q', stmt));
      RAISE EXCEPTION 'FAIL  M12 the worker role could run: %', stmt;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END LOOP;
  -- Writes cannot run as subqueries; try them directly.
  FOREACH stmt IN ARRAY ARRAY['UPDATE "AuditEvent" SET "requestId" = ''x''',
                              'INSERT INTO "AuditEvent" (id, "actorType", action, "resourceType", "requestId") VALUES (gen_random_uuid(), ''SYSTEM'', ''LOGOUT'', ''Session'', ''r'')',
                              'UPDATE "StorageObject" SET status = ''PURGED'''] LOOP
    BEGIN
      SET LOCAL ROLE aestara_worker;
      EXECUTE stmt;
      RESET ROLE;
      RAISE EXCEPTION 'FAIL  M12 the worker role could run: %', stmt;
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE;
    END;
  END LOOP;
  INSERT INTO _results VALUES ('M12 the worker reaches nothing but its cross-tenant columns', true);
  RAISE NOTICE 'PASS  M12 the worker reaches nothing but its cross-tenant columns';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['StorageObject', 'PhotographyProtocol', 'PhotoSession', 'PatientPhoto', 'PhotoPermission',
                           'MediaRelease', 'FeatureFlag', 'PracticeSetting', 'RetentionPolicy'] LOOP
    BEGIN
      PERFORM pg_temp.rows_as('aestara_platform', NULL, format('SELECT 1 FROM %I', t));
      RAISE EXCEPTION 'FAIL  M13 the platform role could read %', t;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END LOOP;
  INSERT INTO _results VALUES ('M13 the platform role has no access to photos, storage or practice configuration', true);
  RAISE NOTICE 'PASS  M13 the platform role has no access to photos, storage or practice configuration';
END $$;

SELECT pg_temp.expect_rows_as('aestara_platform', NULL,
  $$SELECT app_seed_standard_protocols('0b000000-0000-7000-8000-000000000001') AS n$$, 1,
  'M14 the platform role seeds a new organization''s standard protocols through the definer function');

SELECT pg_temp.expect_rows_as('aestara_app', '0b000000-0000-7000-8000-000000000001',
  $$SELECT 1 FROM "PhotographyProtocol" p JOIN "PhotographyProtocolView" v ON v."protocolId" = p.id
    WHERE p.status = 'ACTIVE' AND p."practiceId" IS NULL AND v."isRequired"$$, 16,
  'M15 tenant B has the three standard protocols, ACTIVE, organization-wide, 16 required views');

SELECT pg_temp.expect_rows_as('aestara_app', '0a000000-0000-7000-8000-000000000001',
  $$SELECT 1 FROM "PhotographyProtocol" WHERE name IN ('Face', 'Breast', 'Abdomen/body contour')$$, 0,
  'M16 seeding B added nothing to A');

SELECT pg_temp.expect_rows_as('aestara_platform', NULL,
  $$SELECT 1 FROM (SELECT app_seed_standard_protocols('0b000000-0000-7000-8000-000000000001') AS n) q WHERE n = 0$$, 1,
  'M17 seeding is idempotent: a second call adds nothing');

SELECT pg_temp.expect_error_as('aestara_app', '0a000000-0000-7000-8000-000000000001',
  $$SELECT app_seed_standard_protocols('0a000000-0000-7000-8000-000000000001')$$, '42501',
  'M18 only the platform bootstrap may call the protocol seed');

SELECT pg_temp.expect_error_as('aestara_platform', NULL, $$
  INSERT INTO "PhotographyProtocol" (id, "organizationId", name, "bodyRegion", "updatedAt")
  VALUES (gen_random_uuid(), '0b000000-0000-7000-8000-000000000001', 'X', 'FACE', now())$$,
  '42501', 'M19 the platform role cannot write protocols directly');

SELECT pg_temp.expect_rows_as('aestara_app', '0b000000-0000-7000-8000-000000000001',
  $$SELECT 1 FROM "PhotographyProtocolView" v JOIN "PhotographyProtocol" p ON p.id = v."protocolId"
    WHERE p.name = 'Face' AND v."viewKey" = 'LEFT_45' AND (v."poseTarget"->>'yawDeg')::int = 45
      AND v."poseTarget"->>'subject' = 'FACE'$$, 1,
  'M20 a standard view carries its pose target (left 45 shows the left side, yaw +45)');
