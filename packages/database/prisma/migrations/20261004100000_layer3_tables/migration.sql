-- CreateEnum
CREATE TYPE "MedicalHistoryCategory" AS ENUM ('ALLERGY', 'MEDICATION', 'CONDITION', 'PRIOR_PROCEDURE', 'PRIOR_AESTHETIC_TREATMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('STAFF', 'PATIENT_INTAKE', 'INTEGRATION');

-- CreateEnum
CREATE TYPE "ConsultationStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'AWAITING_INFORMATION', 'READY_FOR_REVIEW', 'COMPLETED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "NoteStatus" AS ENUM ('DRAFT', 'FINAL');

-- CreateEnum
CREATE TYPE "ConsultationReleaseDecision" AS ENUM ('NOTHING_TO_RELEASE', 'MATERIALS_RELEASED');

-- CreateEnum
CREATE TYPE "RegistrationMode" AS ENUM ('NONE', 'AUTOMATIC', 'MANUAL');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CONSULTATION_SUMMARY', 'SIGNED_CONSENT', 'TREATMENT_PLAN', 'ESTIMATE', 'UPLOADED_CLINICAL', 'EXTERNAL_EMR', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'CONSULTATION_NOTE_FINALIZED';
ALTER TYPE "AuditAction" ADD VALUE 'DOCUMENT_ADDED';

-- AlterTable
ALTER TABLE "MediaRelease" ADD COLUMN     "beforeAfterSetId" UUID;

-- AlterTable
ALTER TABLE "PhotoDerivative" ADD COLUMN     "annotationId" UUID,
ADD COLUMN     "beforeAfterSetId" UUID;

-- AlterTable
ALTER TABLE "PhotoSession" ADD COLUMN     "consultationId" UUID;

-- CreateTable
CREATE TABLE "PatientMedicalHistory" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "category" "MedicalHistoryCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "details" JSONB,
    "onsetDate" DATE,
    "resolvedAt" DATE,
    "source" "RecordSource" NOT NULL DEFAULT 'STAFF',
    "recordedById" UUID,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PatientMedicalHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientConcern" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "area" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "recordedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PatientConcern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consultation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "practiceId" UUID NOT NULL,
    "locationId" UUID,
    "primaryProviderUserId" UUID,
    "status" "ConsultationStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "startedAt" TIMESTAMPTZ(3),
    "readyForReviewAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "completedById" UUID,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledById" UUID,
    "cancellationReason" TEXT,
    "releaseDecision" "ConsultationReleaseDecision",
    "releaseDecidedAt" TIMESTAMPTZ(3),
    "releaseDecidedById" UUID,
    "archivedAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "Consultation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsultationConcern" (
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "consultationId" UUID NOT NULL,
    "patientConcernId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultationConcern_pkey" PRIMARY KEY ("consultationId","patientConcernId")
);

-- CreateTable
CREATE TABLE "ConsultationNote" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "consultationId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "status" "NoteStatus" NOT NULL DEFAULT 'DRAFT',
    "body" TEXT NOT NULL,
    "correctsNoteId" UUID,
    "finalizedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ConsultationNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoAnnotation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "photoId" UUID NOT NULL,
    "authorUserId" UUID NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "layer" JSONB NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PhotoAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BeforeAfterSet" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "beforePhotoId" UUID NOT NULL,
    "afterPhotoId" UUID NOT NULL,
    "consultationId" UUID,
    "viewKey" TEXT,
    "title" TEXT,
    "registrationMode" "RegistrationMode" NOT NULL DEFAULT 'NONE',
    "registrationTransform" JSONB,
    "registrationJobId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "BeforeAfterSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "type" "DocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "consultationId" UUID,
    "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "releasedToPatientAt" TIMESTAMPTZ(3),
    "releasedById" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "storageObjectId" UUID NOT NULL,
    "sha256" TEXT NOT NULL,
    "changeNote" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PatientMedicalHistory_organizationId_patientId_category_idx" ON "PatientMedicalHistory"("organizationId", "patientId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "PatientConcern_organizationId_patientId_id_key" ON "PatientConcern"("organizationId", "patientId", "id");

-- CreateIndex
CREATE INDEX "Consultation_organizationId_patientId_createdAt_idx" ON "Consultation"("organizationId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "Consultation_organizationId_practiceId_status_idx" ON "Consultation"("organizationId", "practiceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Consultation_organizationId_id_key" ON "Consultation"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Consultation_organizationId_patientId_id_key" ON "Consultation"("organizationId", "patientId", "id");

-- CreateIndex
CREATE INDEX "ConsultationNote_organizationId_consultationId_idx" ON "ConsultationNote"("organizationId", "consultationId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationNote_consultationId_id_key" ON "ConsultationNote"("consultationId", "id");

-- CreateIndex
CREATE INDEX "PhotoAnnotation_photoId_idx" ON "PhotoAnnotation"("photoId");

-- CreateIndex
CREATE UNIQUE INDEX "PhotoAnnotation_organizationId_patientId_id_key" ON "PhotoAnnotation"("organizationId", "patientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BeforeAfterSet_organizationId_id_key" ON "BeforeAfterSet"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BeforeAfterSet_organizationId_patientId_id_key" ON "BeforeAfterSet"("organizationId", "patientId", "id");

-- CreateIndex
CREATE INDEX "Document_organizationId_patientId_type_idx" ON "Document"("organizationId", "patientId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Document_organizationId_id_key" ON "Document"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Document_organizationId_patientId_id_key" ON "Document"("organizationId", "patientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_versionNumber_key" ON "DocumentVersion"("documentId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_organizationId_patientId_id_key" ON "DocumentVersion"("organizationId", "patientId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_organizationId_storageObjectId_key" ON "DocumentVersion"("organizationId", "storageObjectId");

-- AddForeignKey
ALTER TABLE "PatientMedicalHistory" ADD CONSTRAINT "PatientMedicalHistory_organizationId_patientId_fkey" FOREIGN KEY ("organizationId", "patientId") REFERENCES "Patient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientMedicalHistory" ADD CONSTRAINT "PatientMedicalHistory_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientConcern" ADD CONSTRAINT "PatientConcern_organizationId_patientId_fkey" FOREIGN KEY ("organizationId", "patientId") REFERENCES "Patient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientConcern" ADD CONSTRAINT "PatientConcern_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_organizationId_patientId_fkey" FOREIGN KEY ("organizationId", "patientId") REFERENCES "Patient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_organizationId_practiceId_fkey" FOREIGN KEY ("organizationId", "practiceId") REFERENCES "Practice"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_organizationId_practiceId_locationId_fkey" FOREIGN KEY ("organizationId", "practiceId", "locationId") REFERENCES "Location"("organizationId", "practiceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_organizationId_primaryProviderUserId_fkey" FOREIGN KEY ("organizationId", "primaryProviderUserId") REFERENCES "ProviderProfile"("organizationId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_releaseDecidedById_fkey" FOREIGN KEY ("releaseDecidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationConcern" ADD CONSTRAINT "ConsultationConcern_organizationId_patientId_consultationI_fkey" FOREIGN KEY ("organizationId", "patientId", "consultationId") REFERENCES "Consultation"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationConcern" ADD CONSTRAINT "ConsultationConcern_organizationId_patientId_patientConcer_fkey" FOREIGN KEY ("organizationId", "patientId", "patientConcernId") REFERENCES "PatientConcern"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationNote" ADD CONSTRAINT "ConsultationNote_organizationId_patientId_consultationId_fkey" FOREIGN KEY ("organizationId", "patientId", "consultationId") REFERENCES "Consultation"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationNote" ADD CONSTRAINT "ConsultationNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationNote" ADD CONSTRAINT "ConsultationNote_consultationId_correctsNoteId_fkey" FOREIGN KEY ("consultationId", "correctsNoteId") REFERENCES "ConsultationNote"("consultationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoSession" ADD CONSTRAINT "PhotoSession_organizationId_patientId_consultationId_fkey" FOREIGN KEY ("organizationId", "patientId", "consultationId") REFERENCES "Consultation"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoDerivative" ADD CONSTRAINT "PhotoDerivative_organizationId_patientId_beforeAfterSetId_fkey" FOREIGN KEY ("organizationId", "patientId", "beforeAfterSetId") REFERENCES "BeforeAfterSet"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoDerivative" ADD CONSTRAINT "PhotoDerivative_organizationId_patientId_annotationId_fkey" FOREIGN KEY ("organizationId", "patientId", "annotationId") REFERENCES "PhotoAnnotation"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoAnnotation" ADD CONSTRAINT "PhotoAnnotation_organizationId_patientId_photoId_fkey" FOREIGN KEY ("organizationId", "patientId", "photoId") REFERENCES "PatientPhoto"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoAnnotation" ADD CONSTRAINT "PhotoAnnotation_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaRelease" ADD CONSTRAINT "MediaRelease_organizationId_patientId_beforeAfterSetId_fkey" FOREIGN KEY ("organizationId", "patientId", "beforeAfterSetId") REFERENCES "BeforeAfterSet"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeforeAfterSet" ADD CONSTRAINT "BeforeAfterSet_organizationId_patientId_fkey" FOREIGN KEY ("organizationId", "patientId") REFERENCES "Patient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeforeAfterSet" ADD CONSTRAINT "BeforeAfterSet_organizationId_patientId_beforePhotoId_fkey" FOREIGN KEY ("organizationId", "patientId", "beforePhotoId") REFERENCES "PatientPhoto"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeforeAfterSet" ADD CONSTRAINT "BeforeAfterSet_organizationId_patientId_afterPhotoId_fkey" FOREIGN KEY ("organizationId", "patientId", "afterPhotoId") REFERENCES "PatientPhoto"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeforeAfterSet" ADD CONSTRAINT "BeforeAfterSet_organizationId_patientId_consultationId_fkey" FOREIGN KEY ("organizationId", "patientId", "consultationId") REFERENCES "Consultation"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeforeAfterSet" ADD CONSTRAINT "BeforeAfterSet_organizationId_registrationJobId_fkey" FOREIGN KEY ("organizationId", "registrationJobId") REFERENCES "AIJob"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeforeAfterSet" ADD CONSTRAINT "BeforeAfterSet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_patientId_fkey" FOREIGN KEY ("organizationId", "patientId") REFERENCES "Patient"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_patientId_consultationId_fkey" FOREIGN KEY ("organizationId", "patientId", "consultationId") REFERENCES "Consultation"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_organizationId_patientId_documentId_fkey" FOREIGN KEY ("organizationId", "patientId", "documentId") REFERENCES "Document"("organizationId", "patientId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_organizationId_storageObjectId_fkey" FOREIGN KEY ("organizationId", "storageObjectId") REFERENCES "StorageObject"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

