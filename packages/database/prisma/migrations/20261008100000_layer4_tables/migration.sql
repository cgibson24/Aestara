-- CreateEnum
CREATE TYPE "ProcedureStatus" AS ENUM ('PLANNED', 'SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TreatmentPlanStatus" AS ENUM ('DRAFT', 'PROPOSED', 'SENT_TO_PATIENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TreatmentPlanResponseSource" AS ENUM ('IN_CLINIC', 'PATIENT_APP', 'SIBLING_ACCEPTED');

-- CreateEnum
CREATE TYPE "SimulationCategory" AS ENUM ('LIP_FILLER', 'RHINOPLASTY', 'BOTULINUM_TOXIN', 'CHEEK_CHIN_JAW_FILLER', 'FACIAL_LIFT_PROCEDURES', 'BREAST_BODY_CONTOUR', 'SKIN_RESURFACING_TIGHTENING');

-- CreateEnum
CREATE TYPE "TemplateVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('DRAFT', 'ASSIGNED', 'VIEWED', 'IN_PROGRESS', 'SIGNED_BY_PATIENT', 'SIGNED_BY_PROVIDER', 'COMPLETE', 'VOIDED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "SignerRole" AS ENUM ('PATIENT', 'PROVIDER', 'WITNESS');

-- CreateEnum
CREATE TYPE "SignatureMethod" AS ENUM ('DRAWN', 'TYPED');

-- CreateEnum
CREATE TYPE "HandoffPurpose" AS ENUM ('CONSENT_SIGNING', 'PLAN_RESPONSE');

-- CreateEnum
CREATE TYPE "HandoffEndReason" AS ENUM ('EXITED', 'COMPLETED', 'IDLE_TIMEOUT', 'MAX_LIFETIME', 'REVOKED');

-- CreateEnum
CREATE TYPE "EducationContentType" AS ENUM ('VIDEO', 'IMAGE', 'ANIMATION', 'TEXT', 'PDF', 'PROCEDURE_EXPLANATION', 'FAQ', 'PRE_OP_INSTRUCTION', 'POST_OP_INSTRUCTION');

-- CreateEnum
CREATE TYPE "ContentAssignmentStatus" AS ENUM ('ASSIGNED', 'OPENED', 'VIEWED', 'COMPLETED', 'ACKNOWLEDGED');

-- CreateEnum
CREATE TYPE "EstimateStatus" AS ENUM ('DRAFT', 'ISSUED', 'SUPERSEDED', 'VOID');

-- CreateEnum
CREATE TYPE "DataExportPurpose" AS ENUM ('PATIENT_REQUEST', 'TRANSFER_OF_CARE', 'LEGAL_REQUEST', 'OTHER');

-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('REQUESTED', 'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PROCEDURE_STATUS_CHANGED';

-- AlterTable
ALTER TABLE "PhotoPermission" ADD COLUMN     "evidenceConsentAssignmentId" UUID;

-- AlterTable
ALTER TABLE "PhotoSession" ADD COLUMN     "procedureId" UUID;

-- CreateTable
CREATE TABLE "TreatmentCategory" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "OperationalStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TreatmentCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Treatment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "unitLabel" TEXT,
    "defaultUnitPrice" DECIMAL(12,2),
    "simulationCategory" "SimulationCategory",
    "status" "OperationalStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Treatment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Procedure" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "locationId" UUID,
    "treatmentId" UUID NOT NULL,
    "treatmentPlanItemId" UUID,
    "consultationId" UUID,
    "performedByUserId" UUID,
    "status" "ProcedureStatus" NOT NULL DEFAULT 'PLANNED',
    "area" TEXT,
    "scheduledFor" TIMESTAMPTZ(3),
    "performedAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "externalId" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledById" UUID,
    "cancellationReason" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Procedure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreatmentPlan" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "consultationId" UUID,
    "practiceId" UUID NOT NULL,
    "providerUserId" UUID,
    "optionLabel" TEXT,
    "title" TEXT NOT NULL,
    "status" "TreatmentPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "estimatedTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "financingReference" TEXT,
    "notes" TEXT,
    "proposedDate" DATE,
    "sentAt" TIMESTAMPTZ(3),
    "viewedAt" TIMESTAMPTZ(3),
    "respondedAt" TIMESTAMPTZ(3),
    "responseSource" "TreatmentPlanResponseSource",
    "responseHandoffId" UUID,
    "responseAttestation" TEXT,
    "responseSignerName" TEXT,
    "acceptedSiblingId" UUID,
    "expiresAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledById" UUID,
    "cancellationReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "TreatmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreatmentPlanItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "treatmentPlanId" UUID NOT NULL,
    "treatmentId" UUID NOT NULL,
    "area" TEXT,
    "providerUserId" UUID,
    "description" TEXT,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "proposedDate" DATE,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TreatmentPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentTemplate" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "practiceId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "retiredAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ConsentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentTemplateVersion" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "TemplateVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "blocks" JSONB NOT NULL,
    "requiresProviderSignature" BOOLEAN NOT NULL DEFAULT false,
    "requiresWitnessSignature" BOOLEAN NOT NULL DEFAULT false,
    "contentHash" TEXT,
    "createdById" UUID NOT NULL,
    "publishedAt" TIMESTAMPTZ(3),
    "publishedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ConsentTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentAssignment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "templateVersionId" UUID NOT NULL,
    "consultationId" UUID,
    "procedureId" UUID,
    "treatmentPlanId" UUID,
    "status" "ConsentStatus" NOT NULL DEFAULT 'DRAFT',
    "responses" JSONB,
    "assignedById" UUID NOT NULL,
    "assignedAt" TIMESTAMPTZ(3),
    "dueAt" TIMESTAMPTZ(3),
    "firstViewedAt" TIMESTAMPTZ(3),
    "patientSignedAt" TIMESTAMPTZ(3),
    "providerSignedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "signedDocumentVersionId" UUID,
    "signedSnapshotHash" TEXT,
    "voidedAt" TIMESTAMPTZ(3),
    "voidedById" UUID,
    "voidReason" TEXT,
    "supersededAt" TIMESTAMPTZ(3),
    "supersededByAssignmentId" UUID,
    "replacesAssignmentId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ConsentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentSignature" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "consentAssignmentId" UUID NOT NULL,
    "signerRole" "SignerRole" NOT NULL,
    "signerUserId" UUID,
    "signerName" TEXT NOT NULL,
    "method" "SignatureMethod" NOT NULL,
    "signatureObjectId" UUID NOT NULL,
    "attestation" TEXT NOT NULL,
    "signedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" INET,
    "deviceId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "handoffId" UUID,

    CONSTRAINT "ConsentSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientHandoff" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "purpose" "HandoffPurpose" NOT NULL,
    "consentAssignmentId" UUID,
    "treatmentPlanId" UUID,
    "openedById" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "identityConfirmedAt" TIMESTAMPTZ(3) NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "absoluteExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    "endReason" "HandoffEndReason",

    CONSTRAINT "PatientHandoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducationContent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "contentType" "EducationContentType" NOT NULL,
    "title" TEXT NOT NULL,
    "treatmentId" UUID,
    "retiredAt" TIMESTAMPTZ(3),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EducationContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EducationContentVersion" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "contentId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "TemplateVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "body" JSONB,
    "mediaObjectId" UUID,
    "durationSeconds" INTEGER,
    "source" TEXT,
    "license" TEXT,
    "publishedAt" TIMESTAMPTZ(3),
    "publishedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EducationContentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentAssignment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "contentVersionId" UUID NOT NULL,
    "consultationId" UUID,
    "procedureId" UUID,
    "status" "ContentAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assignedById" UUID NOT NULL,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "presentedInConsultationAt" TIMESTAMPTZ(3),
    "openedAt" TIMESTAMPTZ(3),
    "viewedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "acknowledgedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ContentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientInstruction" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "contentVersionId" UUID NOT NULL,
    "procedureId" UUID,
    "consultationId" UUID,
    "assignedById" UUID NOT NULL,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedToPatientAt" TIMESTAMPTZ(3),
    "patientAcknowledgedAt" TIMESTAMPTZ(3),
    "clinicalCompletedAt" TIMESTAMPTZ(3),
    "clinicalCompletedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PatientInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Estimate" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "treatmentPlanId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "EstimateStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discountTotal" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "lineItemsSnapshot" JSONB NOT NULL,
    "validUntil" DATE,
    "documentId" UUID,
    "issuedAt" TIMESTAMPTZ(3),
    "issuedById" UUID,
    "supersededAt" TIMESTAMPTZ(3),
    "voidedAt" TIMESTAMPTZ(3),
    "voidedById" UUID,
    "voidReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Estimate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataExportJob" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID,
    "requestedById" UUID NOT NULL,
    "purpose" "DataExportPurpose" NOT NULL,
    "purposeNote" TEXT,
    "scope" JSONB NOT NULL,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'REQUESTED',
    "resultObjectId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DataExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TreatmentCategory_organizationId_id_key" ON "TreatmentCategory"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Treatment_organizationId_id_key" ON "Treatment"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Treatment_organizationId_code_key" ON "Treatment"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Procedure_organizationId_patientId_status_idx" ON "Procedure"("organizationId", "patientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Procedure_organizationId_id_key" ON "Procedure"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Procedure_organizationId_patientId_id_key" ON "Procedure"("organizationId", "patientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Procedure_organizationId_patientId_treatmentPlanItemId_key" ON "Procedure"("organizationId", "patientId", "treatmentPlanItemId");

-- CreateIndex
CREATE INDEX "TreatmentPlan_organizationId_patientId_status_idx" ON "TreatmentPlan"("organizationId", "patientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TreatmentPlan_organizationId_id_key" ON "TreatmentPlan"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TreatmentPlan_organizationId_patientId_id_key" ON "TreatmentPlan"("organizationId", "patientId", "id");

-- CreateIndex
CREATE INDEX "TreatmentPlanItem_treatmentPlanId_idx" ON "TreatmentPlanItem"("treatmentPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "TreatmentPlanItem_organizationId_patientId_id_key" ON "TreatmentPlanItem"("organizationId", "patientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentTemplate_organizationId_id_key" ON "ConsentTemplate"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentTemplateVersion_templateId_versionNumber_key" ON "ConsentTemplateVersion"("templateId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentTemplateVersion_organizationId_id_key" ON "ConsentTemplateVersion"("organizationId", "id");

-- CreateIndex
CREATE INDEX "ConsentAssignment_organizationId_patientId_status_idx" ON "ConsentAssignment"("organizationId", "patientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentAssignment_organizationId_id_key" ON "ConsentAssignment"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentAssignment_organizationId_patientId_id_key" ON "ConsentAssignment"("organizationId", "patientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentAssignment_organizationId_patientId_signedDocumentVe_key" ON "ConsentAssignment"("organizationId", "patientId", "signedDocumentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentAssignment_organizationId_patientId_supersededByAssi_key" ON "ConsentAssignment"("organizationId", "patientId", "supersededByAssignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentSignature_consentAssignmentId_signerRole_key" ON "ConsentSignature"("consentAssignmentId", "signerRole");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentSignature_organizationId_idempotencyKey_key" ON "ConsentSignature"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentSignature_organizationId_signatureObjectId_key" ON "ConsentSignature"("organizationId", "signatureObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "PatientHandoff_tokenHash_key" ON "PatientHandoff"("tokenHash");

-- CreateIndex
CREATE INDEX "PatientHandoff_organizationId_patientId_openedAt_idx" ON "PatientHandoff"("organizationId", "patientId", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PatientHandoff_organizationId_patientId_id_key" ON "PatientHandoff"("organizationId", "patientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EducationContent_organizationId_id_key" ON "EducationContent"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EducationContentVersion_contentId_versionNumber_key" ON "EducationContentVersion"("contentId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "EducationContentVersion_organizationId_id_key" ON "EducationContentVersion"("organizationId", "id");

-- CreateIndex
CREATE INDEX "ContentAssignment_organizationId_patientId_status_idx" ON "ContentAssignment"("organizationId", "patientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PatientInstruction_organizationId_patientId_id_key" ON "PatientInstruction"("organizationId", "patientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Estimate_treatmentPlanId_versionNumber_key" ON "Estimate"("treatmentPlanId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Estimate_organizationId_patientId_id_key" ON "Estimate"("organizationId", "patientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DataExportJob_organizationId_idempotencyKey_key" ON "DataExportJob"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "DataExportJob_organizationId_resultObjectId_key" ON "DataExportJob"("organizationId", "resultObjectId");

-- AddForeignKey
ALTER TABLE "TreatmentCategory" ADD CONSTRAINT "TreatmentCategory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentCategory" ADD CONSTRAINT "TreatmentCategory_organizationId_parentId_fkey" FOREIGN KEY ("organizationId", "parentId") REFERENCES "TreatmentCategory"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Treatment" ADD CONSTRAINT "Treatment_organizationId_categoryId_fkey" FOREIGN KEY ("organizationId", "categoryId") REFERENCES "TreatmentCategory"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_organizationId_patientId_fkey" FOREIGN KEY ("organizationId", "patientId") REFERENCES "Patient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_organizationId_practiceId_fkey" FOREIGN KEY ("organizationId", "practiceId") REFERENCES "Practice"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_organizationId_practiceId_locationId_fkey" FOREIGN KEY ("organizationId", "practiceId", "locationId") REFERENCES "Location"("organizationId", "practiceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_organizationId_treatmentId_fkey" FOREIGN KEY ("organizationId", "treatmentId") REFERENCES "Treatment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_organizationId_patientId_treatmentPlanItemId_fkey" FOREIGN KEY ("organizationId", "patientId", "treatmentPlanItemId") REFERENCES "TreatmentPlanItem"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_organizationId_patientId_consultationId_fkey" FOREIGN KEY ("organizationId", "patientId", "consultationId") REFERENCES "Consultation"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_organizationId_performedByUserId_fkey" FOREIGN KEY ("organizationId", "performedByUserId") REFERENCES "ProviderProfile"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Procedure" ADD CONSTRAINT "Procedure_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_organizationId_patientId_fkey" FOREIGN KEY ("organizationId", "patientId") REFERENCES "Patient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_organizationId_patientId_consultationId_fkey" FOREIGN KEY ("organizationId", "patientId", "consultationId") REFERENCES "Consultation"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_organizationId_practiceId_fkey" FOREIGN KEY ("organizationId", "practiceId") REFERENCES "Practice"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_organizationId_providerUserId_fkey" FOREIGN KEY ("organizationId", "providerUserId") REFERENCES "ProviderProfile"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_organizationId_patientId_responseHandoffId_fkey" FOREIGN KEY ("organizationId", "patientId", "responseHandoffId") REFERENCES "PatientHandoff"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlan" ADD CONSTRAINT "TreatmentPlan_organizationId_patientId_acceptedSiblingId_fkey" FOREIGN KEY ("organizationId", "patientId", "acceptedSiblingId") REFERENCES "TreatmentPlan"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlanItem" ADD CONSTRAINT "TreatmentPlanItem_organizationId_patientId_treatmentPlanId_fkey" FOREIGN KEY ("organizationId", "patientId", "treatmentPlanId") REFERENCES "TreatmentPlan"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlanItem" ADD CONSTRAINT "TreatmentPlanItem_organizationId_treatmentId_fkey" FOREIGN KEY ("organizationId", "treatmentId") REFERENCES "Treatment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentPlanItem" ADD CONSTRAINT "TreatmentPlanItem_organizationId_providerUserId_fkey" FOREIGN KEY ("organizationId", "providerUserId") REFERENCES "ProviderProfile"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoSession" ADD CONSTRAINT "PhotoSession_organizationId_patientId_procedureId_fkey" FOREIGN KEY ("organizationId", "patientId", "procedureId") REFERENCES "Procedure"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoPermission" ADD CONSTRAINT "PhotoPermission_organizationId_patientId_evidenceConsentAs_fkey" FOREIGN KEY ("organizationId", "patientId", "evidenceConsentAssignmentId") REFERENCES "ConsentAssignment"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentTemplate" ADD CONSTRAINT "ConsentTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentTemplate" ADD CONSTRAINT "ConsentTemplate_organizationId_practiceId_fkey" FOREIGN KEY ("organizationId", "practiceId") REFERENCES "Practice"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentTemplate" ADD CONSTRAINT "ConsentTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentTemplateVersion" ADD CONSTRAINT "ConsentTemplateVersion_organizationId_templateId_fkey" FOREIGN KEY ("organizationId", "templateId") REFERENCES "ConsentTemplate"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentTemplateVersion" ADD CONSTRAINT "ConsentTemplateVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentTemplateVersion" ADD CONSTRAINT "ConsentTemplateVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentAssignment" ADD CONSTRAINT "ConsentAssignment_organizationId_patientId_fkey" FOREIGN KEY ("organizationId", "patientId") REFERENCES "Patient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentAssignment" ADD CONSTRAINT "ConsentAssignment_organizationId_templateVersionId_fkey" FOREIGN KEY ("organizationId", "templateVersionId") REFERENCES "ConsentTemplateVersion"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentAssignment" ADD CONSTRAINT "ConsentAssignment_organizationId_patientId_consultationId_fkey" FOREIGN KEY ("organizationId", "patientId", "consultationId") REFERENCES "Consultation"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentAssignment" ADD CONSTRAINT "ConsentAssignment_organizationId_patientId_procedureId_fkey" FOREIGN KEY ("organizationId", "patientId", "procedureId") REFERENCES "Procedure"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentAssignment" ADD CONSTRAINT "ConsentAssignment_organizationId_patientId_treatmentPlanId_fkey" FOREIGN KEY ("organizationId", "patientId", "treatmentPlanId") REFERENCES "TreatmentPlan"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentAssignment" ADD CONSTRAINT "ConsentAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentAssignment" ADD CONSTRAINT "ConsentAssignment_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentAssignment" ADD CONSTRAINT "ConsentAssignment_organizationId_patientId_signedDocumentV_fkey" FOREIGN KEY ("organizationId", "patientId", "signedDocumentVersionId") REFERENCES "DocumentVersion"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentAssignment" ADD CONSTRAINT "ConsentAssignment_organizationId_patientId_supersededByAss_fkey" FOREIGN KEY ("organizationId", "patientId", "supersededByAssignmentId") REFERENCES "ConsentAssignment"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentAssignment" ADD CONSTRAINT "ConsentAssignment_organizationId_patientId_replacesAssignm_fkey" FOREIGN KEY ("organizationId", "patientId", "replacesAssignmentId") REFERENCES "ConsentAssignment"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentSignature" ADD CONSTRAINT "ConsentSignature_organizationId_patientId_consentAssignmen_fkey" FOREIGN KEY ("organizationId", "patientId", "consentAssignmentId") REFERENCES "ConsentAssignment"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentSignature" ADD CONSTRAINT "ConsentSignature_organizationId_patientId_handoffId_fkey" FOREIGN KEY ("organizationId", "patientId", "handoffId") REFERENCES "PatientHandoff"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentSignature" ADD CONSTRAINT "ConsentSignature_signerUserId_fkey" FOREIGN KEY ("signerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentSignature" ADD CONSTRAINT "ConsentSignature_organizationId_signatureObjectId_fkey" FOREIGN KEY ("organizationId", "signatureObjectId") REFERENCES "StorageObject"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentSignature" ADD CONSTRAINT "ConsentSignature_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientHandoff" ADD CONSTRAINT "PatientHandoff_organizationId_patientId_fkey" FOREIGN KEY ("organizationId", "patientId") REFERENCES "Patient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientHandoff" ADD CONSTRAINT "PatientHandoff_organizationId_patientId_consentAssignmentI_fkey" FOREIGN KEY ("organizationId", "patientId", "consentAssignmentId") REFERENCES "ConsentAssignment"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientHandoff" ADD CONSTRAINT "PatientHandoff_organizationId_patientId_treatmentPlanId_fkey" FOREIGN KEY ("organizationId", "patientId", "treatmentPlanId") REFERENCES "TreatmentPlan"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientHandoff" ADD CONSTRAINT "PatientHandoff_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientHandoff" ADD CONSTRAINT "PatientHandoff_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientHandoff" ADD CONSTRAINT "PatientHandoff_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationContent" ADD CONSTRAINT "EducationContent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationContent" ADD CONSTRAINT "EducationContent_organizationId_treatmentId_fkey" FOREIGN KEY ("organizationId", "treatmentId") REFERENCES "Treatment"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationContent" ADD CONSTRAINT "EducationContent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationContentVersion" ADD CONSTRAINT "EducationContentVersion_organizationId_contentId_fkey" FOREIGN KEY ("organizationId", "contentId") REFERENCES "EducationContent"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationContentVersion" ADD CONSTRAINT "EducationContentVersion_organizationId_mediaObjectId_fkey" FOREIGN KEY ("organizationId", "mediaObjectId") REFERENCES "StorageObject"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EducationContentVersion" ADD CONSTRAINT "EducationContentVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentAssignment" ADD CONSTRAINT "ContentAssignment_organizationId_patientId_fkey" FOREIGN KEY ("organizationId", "patientId") REFERENCES "Patient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentAssignment" ADD CONSTRAINT "ContentAssignment_organizationId_contentVersionId_fkey" FOREIGN KEY ("organizationId", "contentVersionId") REFERENCES "EducationContentVersion"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentAssignment" ADD CONSTRAINT "ContentAssignment_organizationId_patientId_consultationId_fkey" FOREIGN KEY ("organizationId", "patientId", "consultationId") REFERENCES "Consultation"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentAssignment" ADD CONSTRAINT "ContentAssignment_organizationId_patientId_procedureId_fkey" FOREIGN KEY ("organizationId", "patientId", "procedureId") REFERENCES "Procedure"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentAssignment" ADD CONSTRAINT "ContentAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientInstruction" ADD CONSTRAINT "PatientInstruction_organizationId_patientId_fkey" FOREIGN KEY ("organizationId", "patientId") REFERENCES "Patient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientInstruction" ADD CONSTRAINT "PatientInstruction_organizationId_contentVersionId_fkey" FOREIGN KEY ("organizationId", "contentVersionId") REFERENCES "EducationContentVersion"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientInstruction" ADD CONSTRAINT "PatientInstruction_organizationId_patientId_procedureId_fkey" FOREIGN KEY ("organizationId", "patientId", "procedureId") REFERENCES "Procedure"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientInstruction" ADD CONSTRAINT "PatientInstruction_organizationId_patientId_consultationId_fkey" FOREIGN KEY ("organizationId", "patientId", "consultationId") REFERENCES "Consultation"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientInstruction" ADD CONSTRAINT "PatientInstruction_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientInstruction" ADD CONSTRAINT "PatientInstruction_clinicalCompletedById_fkey" FOREIGN KEY ("clinicalCompletedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_organizationId_patientId_fkey" FOREIGN KEY ("organizationId", "patientId") REFERENCES "Patient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_organizationId_patientId_treatmentPlanId_fkey" FOREIGN KEY ("organizationId", "patientId", "treatmentPlanId") REFERENCES "TreatmentPlan"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_organizationId_patientId_documentId_fkey" FOREIGN KEY ("organizationId", "patientId", "documentId") REFERENCES "Document"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataExportJob" ADD CONSTRAINT "DataExportJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataExportJob" ADD CONSTRAINT "DataExportJob_organizationId_patientId_fkey" FOREIGN KEY ("organizationId", "patientId") REFERENCES "Patient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataExportJob" ADD CONSTRAINT "DataExportJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataExportJob" ADD CONSTRAINT "DataExportJob_organizationId_resultObjectId_fkey" FOREIGN KEY ("organizationId", "resultObjectId") REFERENCES "StorageObject"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

