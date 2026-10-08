-- Layer 4 database security (spec §3.5; ADR-0004; ADR-0018 K-08, K-16;
-- ADR-0028 K4-22). Tables classified in src/ownership.ts; scripts/check-rls.ts
-- compares that classification with the live database.

-- -----------------------------------------------------------------------------
-- Row-Level Security: tenant tables, forced
-- -----------------------------------------------------------------------------
ALTER TABLE "TreatmentCategory" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TreatmentCategory"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "Treatment" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Treatment"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "TreatmentPlan" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TreatmentPlan"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "TreatmentPlanItem" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "TreatmentPlanItem"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "Procedure" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Procedure"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "Estimate" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Estimate"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "ConsentTemplate" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ConsentTemplate"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "ConsentTemplateVersion" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ConsentTemplateVersion"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "ConsentAssignment" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ConsentAssignment"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "ConsentSignature" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ConsentSignature"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "PatientHandoff" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientHandoff"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "EducationContent" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EducationContent"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "EducationContentVersion" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EducationContentVersion"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "ContentAssignment" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ContentAssignment"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "PatientInstruction" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PatientInstruction"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

ALTER TABLE "DataExportJob" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "DataExportJob"
  USING ("organizationId" = app_current_organization_id())
  WITH CHECK ("organizationId" = app_current_organization_id());

-- -----------------------------------------------------------------------------
-- Grants. Nothing is granted to PUBLIC, and nothing is deleted except the items
-- of a plan still in DRAFT, which are replaced as a set (the trigger refuses
-- any other). Signatures are written once.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "TreatmentCategory", "Treatment", "TreatmentPlan", "Procedure", "Estimate",
  "ConsentTemplate", "ConsentTemplateVersion", "ConsentAssignment", "PatientHandoff", "EducationContent",
  "EducationContentVersion", "ContentAssignment", "PatientInstruction", "DataExportJob" TO aestara_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "TreatmentPlanItem" TO aestara_app;
GRANT SELECT, INSERT ON "ConsentSignature" TO aestara_app;
