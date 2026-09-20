-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "momentId" UUID;

-- CreateIndex
CREATE INDEX "Report_momentId_idx" ON "Report"("momentId");
