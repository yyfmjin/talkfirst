-- 引用回复（2026-11-08）
--
-- 一条消息可以引用**同一条会话**里的一条消息。列可为空：绝大多数消息不引用任何东西。
--
-- `ON DELETE SET NULL` 而不是 CASCADE：被引用方被撤回（逻辑删除）时引用不该消失，
-- 物理删除（会话级联）也不该把回复一起带走 —— 回复本身是独立的一条消息。
--
-- 索引只为「被引用」方向建：列表查询是 `include replyTo`（按主键取一条），
-- 不需要反向扫；但外键列没有索引时，删除父行会做全表扫描。

ALTER TABLE "Message" ADD COLUMN "replyToId" UUID;

ALTER TABLE "Message"
  ADD CONSTRAINT "Message_replyToId_fkey"
  FOREIGN KEY ("replyToId") REFERENCES "Message"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Message_replyToId_idx" ON "Message"("replyToId");
