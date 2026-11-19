-- 树洞内容的后台编辑与留痕（2026-11-18）
--
-- 三件事：
--   1. 删除从「看不见的软删」变成「可查、可恢复、记下是谁删的」；
--   2. 管理员可以改内容；
--   3. 每改一次，改之前的版本进 TreeHoleRevision —— 审核不能是无声改写。
--
-- 只加列 / 加表，不动既有行：历史删除的记录 deletedBy 为空，语义是「早于留痕机制」。

ALTER TABLE "TreeHolePost"
  ADD COLUMN "deletedBy" UUID,
  ADD COLUMN "editedAt" TIMESTAMP(3),
  ADD COLUMN "editedBy" UUID;

ALTER TABLE "TreeHoleComment"
  ADD COLUMN "deletedBy" UUID,
  ADD COLUMN "editedAt" TIMESTAMP(3),
  ADD COLUMN "editedBy" UUID;

CREATE TABLE "TreeHoleRevision" (
  "id" UUID NOT NULL,
  "postId" UUID,
  "commentId" UUID,
  "content" VARCHAR(500) NOT NULL,
  "editorId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TreeHoleRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TreeHoleRevision_postId_createdAt_idx" ON "TreeHoleRevision"("postId", "createdAt");
CREATE INDEX "TreeHoleRevision_commentId_createdAt_idx" ON "TreeHoleRevision"("commentId", "createdAt");
