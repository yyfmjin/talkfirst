-- 树洞举报（2026-11-13）

CREATE TABLE "TreeHoleReport" (
  "id" UUID NOT NULL,
  "postId" UUID,
  "commentId" UUID,
  "reporterId" UUID NOT NULL,
  "reason" VARCHAR(24) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TreeHoleReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TreeHoleReport_postId_idx" ON "TreeHoleReport"("postId");
CREATE INDEX "TreeHoleReport_commentId_idx" ON "TreeHoleReport"("commentId");
CREATE INDEX "TreeHoleReport_createdAt_idx" ON "TreeHoleReport"("createdAt");
