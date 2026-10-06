-- 通知合并（聊天消息）—— 2026-10-06。
--
-- 现象：同一个人连发三条消息，收件人收到三条 `NEW_MESSAGE` 通知（线上实测：
-- 21:04:15 / 21:04:35 / 21:04:42 三条，其中两条来自同一个发送者）。
-- 要求：未读期间同一个会话只占一条通知，并带上「几条」的数量。
--
-- 纯加法，既有行为空操作：
--   · `count` 默认 1 —— 既有行都是「一条」，语义一致；
--   · `dedupeKey` 可空 —— 既有行不参与合并（没有键就永远不匹配），
--     新写入的聊天消息才会带上 `NEW_MESSAGE:<会话 id>`；
--   · 新索引只服务于合并时的查找（某人的、某会话的、还没读的那一行）。
--
-- 为什么不去重 `MOMENT_LIKE` 那类：它们已被契约钉住「每次都要提醒」
-- （见 `notifications-api.spec.ts` 的 C5 用例）。这里只动聊天消息。

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "count" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "dedupeKey" VARCHAR(120);

-- CreateIndex
CREATE INDEX "Notification_userId_dedupeKey_idx" ON "Notification"("userId", "dedupeKey");
