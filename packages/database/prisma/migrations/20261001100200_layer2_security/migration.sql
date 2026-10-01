-- Layer 2 database security (spec §3.5; ADR-0004; ADR-0018 K-06, K-16, K-18;
-- ADR-0023 K2-07, K2-11). Tables classified in src/ownership.ts;
-- scripts/check-rls.ts compares that classification with the live database.
--
-- New role, created once per cluster and never able to log in:
--   aestara_worker  the worker's cross-tenant duties only: relaying the outbox,
--                   archiving audit rows to the WORM copy, listing organizations
--                   to run per-tenant jobs, and resolving an opaque storage key
--                   or job ID to its organization. Everything else the worker
--                   does runs as aestara_app inside that organization's tenant.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aestara_worker') THEN
    CREATE ROLE aestara_worker NOLOGIN NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'aestara_worker'
               AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'aestara_worker must be NOLOGIN, NOSUPERUSER and NOBYPASSRLS';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO aestara_worker;

-- -----------------------------------------------------------------------------
-- Row-Level Security: tenant tables, forced
-- -----------------------------------------------------------------------------
ALTER TABLE "StorageObject" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StorageObject"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "PhotographyProtocol" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PhotographyProtocol"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "PhotographyProtocolView" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PhotographyProtocolView"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "PhotoSession" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PhotoSession"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "PatientPhoto" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientPhoto"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "PhotoDerivative" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PhotoDerivative"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "PhotoTag" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PhotoTag"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "PhotoPermission" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PhotoPermission"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "MediaRelease" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MediaRelease"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "MediaReleasePermission" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MediaReleasePermission"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "AIJob" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AIJob"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "PracticeSetting" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PracticeSetting"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "RetentionPolicy" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "RetentionPolicy"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

-- Feature flags: organization and practice rows are tenant data. Platform-wide
-- rows (organizationId NULL) are readable by every tenant and written by no
-- runtime role in Layer 2: platform defaults live in code (ADR-0023 K2-18).
ALTER TABLE "FeatureFlag" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY flag_read ON "FeatureFlag" FOR SELECT
  USING ("organizationId" IS NULL OR "organizationId" = app_current_organization_id());
CREATE POLICY flag_insert ON "FeatureFlag" FOR INSERT
  WITH CHECK ("organizationId" = app_current_organization_id());
CREATE POLICY flag_update ON "FeatureFlag" FOR UPDATE
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

-- The outbox: the api and the platform role only append (the audit feed trigger
-- runs as the caller); the worker relays every tenant's events. Rows carry IDs
-- and codes only, never PHI.
ALTER TABLE "OutboxEvent" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_append ON "OutboxEvent" FOR INSERT TO aestara_app
  WITH CHECK ("organizationId" IS NULL OR "organizationId" = app_current_organization_id());
CREATE POLICY outbox_platform_append ON "OutboxEvent" FOR INSERT TO aestara_platform
  WITH CHECK (true);
CREATE POLICY outbox_relay ON "OutboxEvent" TO aestara_worker USING (true) WITH CHECK (true);

-- The worker's cross-tenant reads (ADR-0023 K2-07): every audit row for the WORM
-- copy; the organization list for per-tenant jobs; the organization of an
-- opaque storage key or job ID. Column grants below keep these narrow.
CREATE POLICY audit_archive ON "AuditEvent" FOR SELECT TO aestara_worker USING (true);
CREATE POLICY worker_tenants ON "Organization" FOR SELECT TO aestara_worker USING (true);
CREATE POLICY worker_resolve ON "StorageObject" FOR SELECT TO aestara_worker USING (true);
CREATE POLICY worker_resolve ON "AIJob" FOR SELECT TO aestara_worker USING (true);

-- -----------------------------------------------------------------------------
-- Grants. Nothing is granted to PUBLIC. Nothing may delete a clinical or audit
-- row; the only application deletes are a draft protocol's views (replaced while
-- editing) and a photo's tags (replaced as a set).
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "StorageObject", "PhotographyProtocol", "PhotoSession", "PatientPhoto",
  "PhotoPermission", "MediaRelease", "AIJob", "FeatureFlag", "PracticeSetting" TO aestara_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PhotographyProtocolView", "PhotoTag" TO aestara_app;
GRANT SELECT, INSERT ON "PhotoDerivative", "MediaReleasePermission", "RetentionPolicy" TO aestara_app;
GRANT INSERT ON "OutboxEvent" TO aestara_app, aestara_platform;

GRANT SELECT, UPDATE ON "OutboxEvent" TO aestara_worker;
GRANT SELECT ON "AuditEvent" TO aestara_worker;
GRANT SELECT (id, status) ON "Organization" TO aestara_worker;
GRANT SELECT (id, "organizationId", bucket, "objectKey") ON "StorageObject" TO aestara_worker;
GRANT SELECT (id, "organizationId") ON "AIJob" TO aestara_worker;
