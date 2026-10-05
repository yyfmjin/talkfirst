-- C3 — 已读位置（未读数的基础）。
--
-- 新列可空，不需要 NOT NULL 收紧。
--
-- 既有行**回填成迁移时刻**，因为这里必须在两种错法里选一个：
--
--   · 留 NULL（= 从未读过一眼）→ 每个老成员一打开消息页就会看到「历史上所有消息都未读」。
--     那是一个凭空造出来的数字，用户既无法消化也无法消除；
--   · 回填成「此前全部已读」→ 只丢掉一次「迁移前的未读」。而那份信息在本次迁移之前
--     **从未被记录过**（这套代码没有任何已读语义），所以并没有真的丢掉什么。
--
-- 之后新加入的成员仍是 NULL：建会话时只有一条 SYSTEM 消息，而计数排除 SYSTEM
-- （见 `apps/api/src/social/social-safety.controller.ts` 的 `unreadCountFor`）。

ALTER TABLE "ConversationMember" ADD COLUMN "lastReadAt" TIMESTAMP(3);

UPDATE "ConversationMember" SET "lastReadAt" = CURRENT_TIMESTAMP WHERE "lastReadAt" IS NULL;
