-- 树洞举报的处置状态（2026-11-18）
--
-- 只加列，不动既有行：已有的举报全部是 `resolvedAt IS NULL`，也就是「还没处理」——
-- 这正是本迁移上线时的真实状态（此前后台根本没有地方能处理它们）。

ALTER TABLE "TreeHoleReport"
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD COLUMN "resolvedBy" UUID;

CREATE INDEX "TreeHoleReport_resolvedAt_idx" ON "TreeHoleReport"("resolvedAt");
