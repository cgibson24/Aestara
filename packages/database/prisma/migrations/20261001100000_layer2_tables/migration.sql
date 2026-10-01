-- CreateEnum
CREATE TYPE "ProtocolStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "BodyRegion" AS ENUM ('FACE', 'BREAST', 'ABDOMEN_BODY', 'OTHER');

-- CreateEnum
CREATE TYPE "PhotoSessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "PhotoSource" AS ENUM ('PROVIDER_CAPTURE', 'PATIENT_UPLOAD', 'IMPORT');

-- CreateEnum
CREATE TYPE "PhotoStatus" AS ENUM ('UPLOAD_PENDING', 'QUARANTINED', 'PENDING_REVIEW', 'ACCEPTED', 'RETAKE_REQUESTED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DerivativeKind" AS ENUM ('THUMBNAIL', 'DISPLAY_PREVIEW', 'ANNOTATED_DERIVATIVE', 'BEFORE_AFTER_DERIVATIVE', 'AI_SIMULATION_DERIVATIVE', 'MARKETING_DERIVATIVE', 'EXPORT_DERIVATIVE');

-- CreateEnum
CREATE TYPE "MediaPermissionCategory" AS ENUM ('CLINICAL_USE', 'PATIENT_APP', 'EDUCATION', 'WEBSITE', 'SOCIAL_MEDIA', 'PAID_ADVERTISING', 'RESEARCH', 'AI_TRAINING', 'INTERNAL_AI_EVALUATION');

-- CreateEnum
CREATE TYPE "PhotoPermissionState" AS ENUM ('NOT_REQUESTED', 'REQUESTED', 'GRANTED', 'DECLINED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('PATIENT_WIDE', 'PHOTO_SESSION', 'PHOTO');

-- CreateEnum
CREATE TYPE "PermissionEvidence" AS ENUM ('SIGNED_CONSENT', 'PATIENT_APP_ACTION', 'STAFF_ATTESTATION', 'INTEGRATION_IMPORT');

-- CreateEnum
CREATE TYPE "StorageObjectClass" AS ENUM ('CLINICAL_ORIGINAL', 'CLINICAL_DERIVATIVE', 'AI_ARTIFACT', 'DOCUMENT', 'SIGNATURE', 'MESSAGE_ATTACHMENT', 'CONTENT_MEDIA', 'DATA_EXPORT', 'INTEGRATION_PAYLOAD');

-- CreateEnum
CREATE TYPE "StorageObjectStatus" AS ENUM ('PENDING_UPLOAD', 'QUARANTINED', 'AVAILABLE', 'REJECTED', 'PURGED');

-- CreateEnum
CREATE TYPE "MalwareScanStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'CLEAN', 'INFECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "AIJobType" AS ENUM ('IMAGE_DERIVATIVE', 'INPUT_QUALITY_CHECK', 'LANDMARK_DETECTION', 'SEGMENTATION', 'SIMULATION_GENERATION', 'OUTPUT_VALIDATION', 'IMAGE_REGISTRATION', 'SIMILAR_CASE_SEARCH', 'OUTCOME_MEASUREMENT');

-- CreateEnum
CREATE TYPE "AIJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "RetentionRecordCategory" AS ENUM ('CLINICAL_PHOTO', 'CLINICAL_RECORD', 'CONSENT_DOCUMENT', 'MESSAGE', 'AUDIT_EVENT', 'LOGIN_EVENT', 'AI_ARTIFACT', 'DATA_EXPORT', 'TELEHEALTH_METADATA', 'INTEGRATION_PAYLOAD');

-- CreateEnum
CREATE TYPE "RetentionAction" AS ENUM ('ARCHIVE', 'DELETE', 'REVIEW');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PHOTO_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'PHOTO_ARCHIVED';

-- CreateTable
CREATE TABLE "StorageObject" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "objectClass" "StorageObjectClass" NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" BIGINT,
    "sha256" TEXT,
    "status" "StorageObjectStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "scanStatus" "MalwareScanStatus" NOT NULL DEFAULT 'PENDING',
    "kmsKeyAlias" TEXT,
    "uploadedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMPTZ(3),
    "purgedAt" TIMESTAMPTZ(3),

    CONSTRAINT "StorageObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotographyProtocol" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "practiceId" UUID,
    "name" TEXT NOT NULL,
    "bodyRegion" "BodyRegion" NOT NULL,
    "description" TEXT,
    "status" "ProtocolStatus" NOT NULL DEFAULT 'DRAFT',
    "supersedesId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PhotographyProtocol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotographyProtocolView" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "protocolId" UUID NOT NULL,
    "viewKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isRequired" BOOLEAN NOT NULL,
    "captureInstructions" TEXT,
    "poseTarget" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotographyProtocolView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoSession" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "protocolId" UUID NOT NULL,
    "source" "PhotoSource" NOT NULL,
    "status" "PhotoSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "capturedByUserId" UUID,
    "practiceId" UUID,
    "locationId" UUID,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PhotoSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientPhoto" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "photoSessionId" UUID,
    "protocolViewId" UUID,
    "viewKey" TEXT,
    "source" "PhotoSource" NOT NULL,
    "status" "PhotoStatus" NOT NULL DEFAULT 'UPLOAD_PENDING',
    "originalObjectId" UUID NOT NULL,
    "capturedByUserId" UUID,
    "capturedAt" TIMESTAMPTZ(3) NOT NULL,
    "widthPx" INTEGER,
    "heightPx" INTEGER,
    "captureMetadata" JSONB,
    "qualityChecks" JSONB,
    "positionMatchScore" DECIMAL(5,4),
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewNote" TEXT,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PatientPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoDerivative" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "sourcePhotoId" UUID NOT NULL,
    "kind" "DerivativeKind" NOT NULL,
    "storageObjectId" UUID NOT NULL,
    "generationMetadata" JSONB NOT NULL,
    "generatedByJobId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoDerivative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoTag" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "photoId" UUID NOT NULL,
    "tag" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoPermission" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "category" "MediaPermissionCategory" NOT NULL,
    "scope" "PermissionScope" NOT NULL,
    "photoSessionId" UUID,
    "photoId" UUID,
    "state" "PhotoPermissionState" NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "previousVersionId" UUID,
    "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "evidence" "PermissionEvidence",
    "reason" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMPTZ(3),

    CONSTRAINT "PhotoPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaRelease" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "purpose" "MediaPermissionCategory" NOT NULL,
    "photoId" UUID,
    "derivativeId" UUID,
    "releasedById" UUID NOT NULL,
    "releasedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedById" UUID,
    "revocationReason" TEXT,

    CONSTRAINT "MediaRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaReleasePermission" (
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "mediaReleaseId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "MediaReleasePermission_pkey" PRIMARY KEY ("mediaReleaseId","permissionId")
);

-- CreateTable
CREATE TABLE "AIJob" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID,
    "jobType" "AIJobType" NOT NULL,
    "status" "AIJobStatus" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "requestedById" UUID,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "inputSummary" JSONB,
    "resultSummary" JSONB,
    "errorCode" TEXT,
    "queuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AIJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "organizationId" UUID,
    "practiceId" UUID,
    "enabled" BOOLEAN NOT NULL,
    "description" TEXT,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeSetting" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PracticeSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "recordCategory" "RetentionRecordCategory" NOT NULL,
    "retentionDays" INTEGER,
    "action" "RetentionAction" NOT NULL,
    "basis" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StorageObject_objectKey_key" ON "StorageObject"("objectKey");

-- CreateIndex
CREATE INDEX "StorageObject_organizationId_objectClass_createdAt_idx" ON "StorageObject"("organizationId", "objectClass", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StorageObject_organizationId_id_key" ON "StorageObject"("organizationId", "id");

-- CreateIndex
CREATE INDEX "PhotographyProtocol_organizationId_status_idx" ON "PhotographyProtocol"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PhotographyProtocol_organizationId_id_key" ON "PhotographyProtocol"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhotographyProtocol_organizationId_supersedesId_key" ON "PhotographyProtocol"("organizationId", "supersedesId");

-- CreateIndex
CREATE UNIQUE INDEX "PhotographyProtocolView_organizationId_id_key" ON "PhotographyProtocolView"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhotographyProtocolView_protocolId_viewKey_key" ON "PhotographyProtocolView"("protocolId", "viewKey");

-- CreateIndex
CREATE INDEX "PhotoSession_organizationId_patientId_startedAt_idx" ON "PhotoSession"("organizationId", "patientId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoSession_organizationId_id_key" ON "PhotoSession"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoSession_organizationId_patientId_id_key" ON "PhotoSession"("organizationId", "patientId", "id");

-- CreateIndex
CREATE INDEX "PatientPhoto_organizationId_patientId_capturedAt_idx" ON "PatientPhoto"("organizationId", "patientId", "capturedAt");

-- CreateIndex
CREATE INDEX "PatientPhoto_organizationId_patientId_viewKey_idx" ON "PatientPhoto"("organizationId", "patientId", "viewKey");

-- CreateIndex
CREATE UNIQUE INDEX "PatientPhoto_organizationId_id_key" ON "PatientPhoto"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PatientPhoto_organizationId_patientId_id_key" ON "PatientPhoto"("organizationId", "patientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PatientPhoto_organizationId_originalObjectId_key" ON "PatientPhoto"("organizationId", "originalObjectId");

-- CreateIndex
CREATE INDEX "PhotoDerivative_sourcePhotoId_kind_idx" ON "PhotoDerivative"("sourcePhotoId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoDerivative_organizationId_id_key" ON "PhotoDerivative"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoDerivative_organizationId_patientId_id_key" ON "PhotoDerivative"("organizationId", "patientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoDerivative_organizationId_storageObjectId_key" ON "PhotoDerivative"("organizationId", "storageObjectId");

-- CreateIndex
CREATE INDEX "PhotoTag_organizationId_tag_idx" ON "PhotoTag"("organizationId", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoTag_photoId_tag_key" ON "PhotoTag"("photoId", "tag");

-- CreateIndex
CREATE INDEX "PhotoPermission_organizationId_patientId_category_idx" ON "PhotoPermission"("organizationId", "patientId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoPermission_organizationId_patientId_id_key" ON "PhotoPermission"("organizationId", "patientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoPermission_organizationId_patientId_previousVersionId_key" ON "PhotoPermission"("organizationId", "patientId", "previousVersionId");

-- CreateIndex
CREATE INDEX "MediaRelease_organizationId_patientId_purpose_idx" ON "MediaRelease"("organizationId", "patientId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "MediaRelease_organizationId_patientId_id_key" ON "MediaRelease"("organizationId", "patientId", "id");

-- CreateIndex
CREATE INDEX "MediaReleasePermission_permissionId_idx" ON "MediaReleasePermission"("permissionId");

-- CreateIndex
CREATE INDEX "AIJob_status_queuedAt_idx" ON "AIJob"("status", "queuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AIJob_organizationId_id_key" ON "AIJob"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "AIJob_organizationId_idempotencyKey_key" ON "AIJob"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_availableAt_idx" ON "OutboxEvent"("publishedAt", "availableAt");

-- CreateIndex
CREATE INDEX "FeatureFlag_key_idx" ON "FeatureFlag"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeSetting_practiceId_key_key" ON "PracticeSetting"("practiceId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_organizationId_recordCategory_effectiveFrom_key" ON "RetentionPolicy"("organizationId", "recordCategory", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "StorageObject" ADD CONSTRAINT "StorageObject_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageObject" ADD CONSTRAINT "StorageObject_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotographyProtocol" ADD CONSTRAINT "PhotographyProtocol_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotographyProtocol" ADD CONSTRAINT "PhotographyProtocol_organizationId_practiceId_fkey" FOREIGN KEY ("organizationId", "practiceId") REFERENCES "Practice"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotographyProtocol" ADD CONSTRAINT "PhotographyProtocol_organizationId_supersedesId_fkey" FOREIGN KEY ("organizationId", "supersedesId") REFERENCES "PhotographyProtocol"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotographyProtocol" ADD CONSTRAINT "PhotographyProtocol_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotographyProtocolView" ADD CONSTRAINT "PhotographyProtocolView_organizationId_protocolId_fkey" FOREIGN KEY ("organizationId", "protocolId") REFERENCES "PhotographyProtocol"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoSession" ADD CONSTRAINT "PhotoSession_organizationId_patientId_fkey" FOREIGN KEY ("organizationId", "patientId") REFERENCES "Patient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoSession" ADD CONSTRAINT "PhotoSession_organizationId_protocolId_fkey" FOREIGN KEY ("organizationId", "protocolId") REFERENCES "PhotographyProtocol"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoSession" ADD CONSTRAINT "PhotoSession_capturedByUserId_fkey" FOREIGN KEY ("capturedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoSession" ADD CONSTRAINT "PhotoSession_organizationId_practiceId_fkey" FOREIGN KEY ("organizationId", "practiceId") REFERENCES "Practice"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoSession" ADD CONSTRAINT "PhotoSession_organizationId_practiceId_locationId_fkey" FOREIGN KEY ("organizationId", "practiceId", "locationId") REFERENCES "Location"("organizationId", "practiceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPhoto" ADD CONSTRAINT "PatientPhoto_organizationId_patientId_fkey" FOREIGN KEY ("organizationId", "patientId") REFERENCES "Patient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPhoto" ADD CONSTRAINT "PatientPhoto_organizationId_patientId_photoSessionId_fkey" FOREIGN KEY ("organizationId", "patientId", "photoSessionId") REFERENCES "PhotoSession"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPhoto" ADD CONSTRAINT "PatientPhoto_organizationId_protocolViewId_fkey" FOREIGN KEY ("organizationId", "protocolViewId") REFERENCES "PhotographyProtocolView"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPhoto" ADD CONSTRAINT "PatientPhoto_organizationId_originalObjectId_fkey" FOREIGN KEY ("organizationId", "originalObjectId") REFERENCES "StorageObject"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPhoto" ADD CONSTRAINT "PatientPhoto_capturedByUserId_fkey" FOREIGN KEY ("capturedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientPhoto" ADD CONSTRAINT "PatientPhoto_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoDerivative" ADD CONSTRAINT "PhotoDerivative_organizationId_patientId_sourcePhotoId_fkey" FOREIGN KEY ("organizationId", "patientId", "sourcePhotoId") REFERENCES "PatientPhoto"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoDerivative" ADD CONSTRAINT "PhotoDerivative_organizationId_storageObjectId_fkey" FOREIGN KEY ("organizationId", "storageObjectId") REFERENCES "StorageObject"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoDerivative" ADD CONSTRAINT "PhotoDerivative_organizationId_generatedByJobId_fkey" FOREIGN KEY ("organizationId", "generatedByJobId") REFERENCES "AIJob"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoDerivative" ADD CONSTRAINT "PhotoDerivative_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoTag" ADD CONSTRAINT "PhotoTag_organizationId_patientId_photoId_fkey" FOREIGN KEY ("organizationId", "patientId", "photoId") REFERENCES "PatientPhoto"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoTag" ADD CONSTRAINT "PhotoTag_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoPermission" ADD CONSTRAINT "PhotoPermission_organizationId_patientId_fkey" FOREIGN KEY ("organizationId", "patientId") REFERENCES "Patient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoPermission" ADD CONSTRAINT "PhotoPermission_organizationId_patientId_photoSessionId_fkey" FOREIGN KEY ("organizationId", "patientId", "photoSessionId") REFERENCES "PhotoSession"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoPermission" ADD CONSTRAINT "PhotoPermission_organizationId_patientId_photoId_fkey" FOREIGN KEY ("organizationId", "patientId", "photoId") REFERENCES "PatientPhoto"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoPermission" ADD CONSTRAINT "PhotoPermission_organizationId_patientId_previousVersionId_fkey" FOREIGN KEY ("organizationId", "patientId", "previousVersionId") REFERENCES "PhotoPermission"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoPermission" ADD CONSTRAINT "PhotoPermission_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaRelease" ADD CONSTRAINT "MediaRelease_organizationId_patientId_fkey" FOREIGN KEY ("organizationId", "patientId") REFERENCES "Patient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaRelease" ADD CONSTRAINT "MediaRelease_organizationId_patientId_photoId_fkey" FOREIGN KEY ("organizationId", "patientId", "photoId") REFERENCES "PatientPhoto"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaRelease" ADD CONSTRAINT "MediaRelease_organizationId_patientId_derivativeId_fkey" FOREIGN KEY ("organizationId", "patientId", "derivativeId") REFERENCES "PhotoDerivative"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaRelease" ADD CONSTRAINT "MediaRelease_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaRelease" ADD CONSTRAINT "MediaRelease_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaReleasePermission" ADD CONSTRAINT "MediaReleasePermission_organizationId_patientId_mediaRelea_fkey" FOREIGN KEY ("organizationId", "patientId", "mediaReleaseId") REFERENCES "MediaRelease"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaReleasePermission" ADD CONSTRAINT "MediaReleasePermission_organizationId_patientId_permission_fkey" FOREIGN KEY ("organizationId", "patientId", "permissionId") REFERENCES "PhotoPermission"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_organizationId_patientId_fkey" FOREIGN KEY ("organizationId", "patientId") REFERENCES "Patient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_organizationId_practiceId_fkey" FOREIGN KEY ("organizationId", "practiceId") REFERENCES "Practice"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeSetting" ADD CONSTRAINT "PracticeSetting_organizationId_practiceId_fkey" FOREIGN KEY ("organizationId", "practiceId") REFERENCES "Practice"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeSetting" ADD CONSTRAINT "PracticeSetting_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionPolicy" ADD CONSTRAINT "RetentionPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionPolicy" ADD CONSTRAINT "RetentionPolicy_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

