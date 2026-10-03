-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('SUGGESTION', 'BUG', 'COMPLAINT', 'OTHER');

-- CreateTable
CREATE TABLE "Feedback" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "kind" "FeedbackKind" NOT NULL DEFAULT 'OTHER',
    "body" TEXT NOT NULL,
    "contactEmail" VARCHAR(320),
    "source" VARCHAR(128),
    "status" "FeedbackStatus" NOT NULL DEFAULT 'OPEN',
    "replyBody" TEXT,
    "repliedAt" TIMESTAMP(3),
    "repliedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Feedback_status_createdAt_idx" ON "Feedback"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Feedback_userId_createdAt_idx" ON "Feedback"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_repliedById_fkey" FOREIGN KEY ("repliedById") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
