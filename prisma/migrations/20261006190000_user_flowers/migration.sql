-- 送花（虚拟礼物，2026-10-06）—— 运营方口径：**点赞式的人对人动作，不可折现**。
--
-- 纯加法：新增一张表 + `User` 上一个冗余计数列。不改既有列、不重写既有行，
-- 所以对现有数据是空操作（既有的 `flowerCount` 一律为 0）。
--
-- 为什么是 `(senderId, receiverId)` 复合主键，而不是 `MomentBookmark` 那样的 `id`：
-- 「点赞」这个语义本身就含「同一对只算一次」，把不变式写进主键就不需要
-- 「先查再写」，也没有两个并发请求各插一条的窗口。这也是 `MomentLike` 的形状。
-- 收花列表/计数按「收花人 + 时间」读，所以索引建在 `(receiverId, createdAt)`。
--
-- 两侧都是 CASCADE，与 `MomentLike` 同语义：用户被删，他送出的与收到的花一起消失。
--
-- 实体礼物（亲密度解锁 → 自发邮寄 → 中转站转寄 → 后台可见完整信息）**不在本次迁移**，
-- 运营方要求先保留、暂不上线；口径记在 `docs/GIFTS.md`。

-- AlterTable
ALTER TABLE "User" ADD COLUMN "flowerCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "UserFlower" (
    "senderId" UUID NOT NULL,
    "receiverId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFlower_pkey" PRIMARY KEY ("senderId", "receiverId")
);

-- CreateIndex
CREATE INDEX "UserFlower_receiverId_createdAt_idx" ON "UserFlower"("receiverId", "createdAt");

-- AddForeignKey
ALTER TABLE "UserFlower" ADD CONSTRAINT "UserFlower_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFlower" ADD CONSTRAINT "UserFlower_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
