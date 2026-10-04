-- Layer 3 database security (spec §3.5; ADR-0004; ADR-0018 K-08, K-16;
-- ADR-0026 K3-20). Tables classified in src/ownership.ts; scripts/check-rls.ts
-- compares that classification with the live database. No new role: the worker
-- applies registration results as aestara_app inside the organization's tenant.

-- -----------------------------------------------------------------------------
-- Row-Level Security: tenant tables, forced
-- -----------------------------------------------------------------------------
ALTER TABLE "PatientMedicalHistory" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientMedicalHistory"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "PatientConcern" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientConcern"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "Consultation" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Consultation"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "ConsultationConcern" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ConsultationConcern"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "ConsultationNote" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ConsultationNote"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "PhotoAnnotation" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PhotoAnnotation"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "BeforeAfterSet" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "BeforeAfterSet"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Document"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "DocumentVersion" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DocumentVersion"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

-- -----------------------------------------------------------------------------
-- Grants. Nothing is granted to PUBLIC, and no clinical row is deleted, except
-- a note still in DRAFT (discarded by its author; the trigger refuses a FINAL
-- one) and a consultation's concern links (replaced as a set while open).
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "PatientMedicalHistory", "PatientConcern", "Consultation",
  "PhotoAnnotation", "BeforeAfterSet", "Document" TO aestara_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ConsultationNote" TO aestara_app;
GRANT SELECT, INSERT, DELETE ON "ConsultationConcern" TO aestara_app;
GRANT SELECT, INSERT ON "DocumentVersion" TO aestara_app;
