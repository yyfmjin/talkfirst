-- AlterTable
ALTER TABLE "Moment" ADD COLUMN     "reviewReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'APPROVED',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" UUID;

-- CreateIndex
CREATE INDEX "Moment_reviewStatus_createdAt_idx" ON "Moment"("reviewStatus", "createdAt");
