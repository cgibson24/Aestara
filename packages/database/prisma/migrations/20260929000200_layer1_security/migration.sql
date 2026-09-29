-- Layer 1 database security (spec §3.5; ADR-0004; ADR-0018 K-05, K-06, K-16, K-18).
--
-- Roles. Created once per cluster, never able to log in. Each environment
-- creates its own login users outside migrations and grants them one role.
--   aestara_app       api and worker runtime. Subject to Row-Level Security.
--   aestara_platform  platform operations (SUPER_ADMIN routes): organization
--                     metadata only; no grant on any patient or clinical table.
--   aestara_signin    owns the one sign-in lookup function; reads memberships
--                     across organizations and nothing else.
-- The migration user needs CREATEROLE and must be able to administer these roles.
--
-- Tenant context. Every request transaction runs
--   SELECT set_config('app.organization_id', '<uuid from the verified token>', true)
-- (the SET LOCAL form), so the value ends with the transaction and never leaks
-- through a pooled connection. An unset value matches no rows. Workers set it
-- per job. Tables classified in src/ownership.ts; scripts/check-rls.ts compares
-- that classification with the live database.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aestara_app') THEN
    CREATE ROLE aestara_app NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aestara_platform') THEN
    CREATE ROLE aestara_platform NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'aestara_signin') THEN
    CREATE ROLE aestara_signin NOLOGIN NOBYPASSRLS;
  END IF;
  IF EXISTS (SELECT FROM pg_roles
             WHERE rolname IN ('aestara_app', 'aestara_platform', 'aestara_signin')
               AND (rolsuper OR rolbypassrls OR rolcanlogin)) THEN
    RAISE EXCEPTION 'aestara_app, aestara_platform and aestara_signin must be NOLOGIN, NOSUPERUSER and NOBYPASSRLS';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO aestara_app, aestara_platform, aestara_signin;

-- -----------------------------------------------------------------------------
-- Tenant context
-- -----------------------------------------------------------------------------
CREATE FUNCTION app_current_organization_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.organization_id', true), '')::uuid
$$;

-- -----------------------------------------------------------------------------
-- Row-Level Security: tenant classes, forced (the table owner is subject too)
-- -----------------------------------------------------------------------------
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Organization"
  USING (id = app_current_organization_id())
  WITH CHECK (id = app_current_organization_id());

ALTER TABLE "Practice" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Practice"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "Location" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Location"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Membership"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

-- PLATFORM-scope grants have no organization and are therefore never visible
-- to the application role; only aestara_platform and the sign-in lookup see them.
ALTER TABLE "UserRole" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "UserRole"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "OrganizationSetting" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "OrganizationSetting"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "ProviderProfile" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ProviderProfile"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "StaffProfile" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StaffProfile"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "Patient" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Patient"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "PatientContact" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientContact"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

-- Audit: the application reads its tenant's events and may write events for its
-- tenant or platform-level events (organizationId NULL, e.g. a failed sign-in of
-- a known user before an organization is chosen). The platform role writes any
-- event (an organization bootstrap is recorded in the new organization) but reads
-- only platform-level events (spec §4.5 note 4). Neither can update or delete (K-18).
ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON "AuditEvent" FOR SELECT TO aestara_app
  USING ("organizationId" = app_current_organization_id());
CREATE POLICY audit_write ON "AuditEvent" FOR INSERT TO aestara_app
  WITH CHECK ("organizationId" IS NULL OR "organizationId" = app_current_organization_id());
CREATE POLICY audit_platform_read ON "AuditEvent" FOR SELECT TO aestara_platform
  USING ("organizationId" IS NULL);
CREATE POLICY audit_platform_write ON "AuditEvent" FOR INSERT TO aestara_platform
  WITH CHECK (true);

-- A key is visible only in the tenant context it was stored under; keys stored
-- before a tenant was chosen are visible only while none is set.
ALTER TABLE "IdempotencyKey" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "IdempotencyKey"
  USING ("organizationId" IS NOT DISTINCT FROM app_current_organization_id())
  WITH CHECK ("organizationId" IS NOT DISTINCT FROM app_current_organization_id());

-- Catalog: system roles are visible to everyone; custom roles (UD-07, not
-- enabled in Layer 1) only inside their organization. Not forced, so migrations
-- can maintain the catalog.
ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_visibility ON "Role" FOR SELECT
  USING ("organizationId" IS NULL OR "organizationId" = app_current_organization_id());

-- Platform reach (ADR-0018 K-06): organization metadata across all tenants.
CREATE POLICY platform_metadata ON "Organization" TO aestara_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_metadata ON "Practice" TO aestara_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_metadata ON "Location" TO aestara_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_metadata ON "Membership" TO aestara_platform USING (true) WITH CHECK (true);
CREATE POLICY platform_metadata ON "UserRole" TO aestara_platform USING (true) WITH CHECK (true);

-- The sign-in lookup reads memberships before any tenant is chosen.
CREATE POLICY signin_lookup ON "Organization" FOR SELECT TO aestara_signin USING (true);
CREATE POLICY signin_lookup ON "Membership" FOR SELECT TO aestara_signin USING (true);
CREATE POLICY signin_lookup ON "UserRole" FOR SELECT TO aestara_signin USING (true);
CREATE POLICY signin_lookup ON "OrganizationSetting" FOR SELECT TO aestara_signin USING (true);

-- -----------------------------------------------------------------------------
-- Pre-tenant sign-in lookup (ADR-0018 K-16): the one SECURITY DEFINER function.
-- One row per membership of the user, plus one row without an organization when
-- the user holds platform-scope grants. Used to list the organizations a user
-- may choose and to apply the strictest MFA policy at sign-in (K-03).
-- -----------------------------------------------------------------------------
CREATE FUNCTION auth_sign_in_memberships(p_user_id uuid)
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  organization_status text,
  membership_status text,
  mfa_policy jsonb,
  role_keys text[]
)
-- plpgsql so the plan is cached per connection; sign-in calls it on every login.
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.name, o.status::text, m.status::text,
         (SELECT s.value FROM "OrganizationSetting" s
           WHERE s."organizationId" = o.id AND s.key = 'security.mfaPolicy'),
         ARRAY(SELECT DISTINCT r.key FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId"
                WHERE ur."organizationId" = o.id AND ur."userId" = p_user_id AND ur."revokedAt" IS NULL
                ORDER BY r.key)
  FROM "Membership" m
  JOIN "Organization" o ON o.id = m."organizationId"
  WHERE m."userId" = p_user_id
  UNION ALL
  SELECT NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::jsonb,
         ARRAY(SELECT DISTINCT r.key FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId"
                WHERE ur.scope = 'PLATFORM' AND ur."userId" = p_user_id AND ur."revokedAt" IS NULL
                ORDER BY r.key)
  WHERE EXISTS (SELECT 1 FROM "UserRole" ur
                WHERE ur.scope = 'PLATFORM' AND ur."userId" = p_user_id AND ur."revokedAt" IS NULL);
END;
$$;

-- Transferring ownership needs membership of the new owner, and the new owner
-- needs CREATE on the schema only for the moment of the transfer.
-- On PostgreSQL 16+, the membership a CREATEROLE user gets in a role it creates
-- does not allow SET ROLE, so grant that explicitly (without inheriting).
DO $$
BEGIN
  IF current_setting('server_version_num')::int >= 160000 THEN
    IF NOT pg_has_role(current_user, 'aestara_signin', 'SET') THEN
      EXECUTE format('GRANT aestara_signin TO %I WITH INHERIT FALSE, SET TRUE', current_user);
    END IF;
  ELSIF NOT pg_has_role(current_user, 'aestara_signin', 'MEMBER') THEN
    EXECUTE format('GRANT aestara_signin TO %I', current_user);
  END IF;
END $$;
-- Set EXECUTE while this user still owns the function; the transfer keeps it.
REVOKE ALL ON FUNCTION auth_sign_in_memberships(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_sign_in_memberships(uuid) TO aestara_app;
GRANT CREATE ON SCHEMA public TO aestara_signin;
ALTER FUNCTION auth_sign_in_memberships(uuid) OWNER TO aestara_signin;
REVOKE CREATE ON SCHEMA public FROM aestara_signin;
GRANT SELECT ON "Organization", "Membership", "UserRole", "Role", "OrganizationSetting" TO aestara_signin;

-- -----------------------------------------------------------------------------
-- Separation of duties, rule 2 (spec §4.5; ADR-0018 K-05), enforced again in the
-- database: the platform role can never grant a role that carries a patient,
-- photo, consultation, simulation or document permission, or a clinical consent
-- action. The same list is PLATFORM_UNGRANTABLE_* in src/catalog.ts.
-- -----------------------------------------------------------------------------
CREATE FUNCTION app_guard_platform_role_grant() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF pg_has_role(current_user, 'aestara_platform', 'MEMBER')
     AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
     AND EXISTS (
       SELECT 1 FROM "RolePermission" rp JOIN "Permission" p ON p.id = rp."permissionId"
       WHERE rp."roleId" = NEW."roleId"
         AND (p.key LIKE 'patient.%' OR p.key LIKE 'photo.%' OR p.key LIKE 'consultation.%'
              OR p.key LIKE 'simulation.%' OR p.key LIKE 'document.%'
              OR p.key IN ('consent.assign', 'consent.sign.provider', 'consent.void'))) THEN
    RAISE EXCEPTION 'SEPARATION_OF_DUTIES: a platform actor cannot grant a role with clinical permissions'
      USING ERRCODE = 'AE002';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "UserRole_platform_grant_guard"
  BEFORE INSERT OR UPDATE OF "roleId" ON "UserRole"
  FOR EACH ROW EXECUTE FUNCTION app_guard_platform_role_grant();

-- -----------------------------------------------------------------------------
-- Grants. Nothing is granted to PUBLIC. Audit and login ledgers are
-- insert-and-read only (K-18); nothing may delete a clinical or audit row.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "User", "UserCredential", "Device", "Session" TO aestara_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "UserToken" TO aestara_app;
GRANT SELECT, INSERT ON "LoginEvent", "AuditEvent" TO aestara_app;
GRANT SELECT ON "Permission", "RolePermission", "Role" TO aestara_app;
GRANT SELECT, UPDATE ON "Organization" TO aestara_app;
GRANT SELECT, INSERT, UPDATE ON "Practice", "Location", "Membership", "UserRole", "OrganizationSetting",
  "ProviderProfile", "StaffProfile", "Patient" TO aestara_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PatientContact", "IdempotencyKey" TO aestara_app;

GRANT SELECT, INSERT, UPDATE ON "Organization", "Membership", "UserRole", "User" TO aestara_platform;
GRANT SELECT ON "Practice", "Location", "Permission", "RolePermission", "Role", "LoginEvent" TO aestara_platform;
GRANT SELECT, INSERT ON "UserToken", "AuditEvent" TO aestara_platform;
GRANT SELECT, UPDATE ON "Session", "Device" TO aestara_platform;
GRANT SELECT (id, "userId", type, label, "createdAt", "lastUsedAt", "revokedAt") ON "UserCredential" TO aestara_platform;
GRANT UPDATE ("revokedAt") ON "UserCredential" TO aestara_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON "IdempotencyKey" TO aestara_platform;
