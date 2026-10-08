-- Catalog edits take If-Match like every PATCH (ADR-0029, M4.1).
-- AlterTable
ALTER TABLE "TreatmentCategory" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Treatment" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;
