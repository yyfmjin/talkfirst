-- C2 — 评论举报：`Report` 多一个目标列。
--
-- 裸 UUID、无外键 —— 与邻居 `momentId` / `messageId` 一致（那两列缺外键已记在
-- P0-00 的 P2 清单里）。对举报而言这并不是缺陷：它是**审核历史**，而评论是
-- **硬删除**（`MomentComment` 没有 `deletedAt`）；加 `onDelete: Cascade` 会在
-- 评论被删时把举报记录一起删掉，恰好抹掉管理员正要复核的那条线索。
--
-- 新列全为 NULL，对既有行无影响。索引供「这条评论被举报过几次」这类查询。

ALTER TABLE "Report" ADD COLUMN "commentId" UUID;

CREATE INDEX "Report_commentId_idx" ON "Report"("commentId");
