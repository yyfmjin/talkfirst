-- C4 — 收藏（Bookmark）：只新增一张表，不改任何既有列与既有行，所以对现有数据是空操作。
--
-- 主键是 `id`，而不是 `MomentLike` 那样的 `(momentId, userId)` 复合键：收藏列表按
-- 「最近收藏在前」分页，走的是全仓库共用的 `(createdAt, id)` keyset 游标
-- （`apps/api/src/common/keyset-cursor.ts`）。复合主键没有 `id` 可做同一毫秒的
-- tie-break，会逼出第二套只属于收藏的游标形状 —— 而那正是共用 helper 要避免的分叉。
-- `(userId, momentId)` 的唯一性因此改由唯一索引表达（与 `Notification` 同一写法）。
--
-- 两侧都是 CASCADE，与 `MomentLike` 同语义：动态被删，指向它的收藏一起消失；
-- 用户被删同理。

-- CreateTable
CREATE TABLE "MomentBookmark" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "momentId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MomentBookmark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MomentBookmark_userId_momentId_key" ON "MomentBookmark"("userId", "momentId");

-- CreateIndex
CREATE INDEX "MomentBookmark_userId_createdAt_idx" ON "MomentBookmark"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "MomentBookmark" ADD CONSTRAINT "MomentBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MomentBookmark" ADD CONSTRAINT "MomentBookmark_momentId_fkey" FOREIGN KEY ("momentId") REFERENCES "Moment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
