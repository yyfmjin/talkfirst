-- AI 朋友（灵魂伴侣式聊天）—— 2026-10-15。
--
-- 三个改动，全部向后兼容（既有行语义不变）：
--   · `Conversation.type` 默认 'DIRECT' —— 既有私聊全部落在默认值上；
--   · `Message.senderKind` 默认 'USER'，`senderId` 放宽为可空 —— AI 消息没有
--     人类发送者（senderId=NULL + senderKind='AI'），人类消息不受影响；
--   · 新表 `AiCompanion`：每个用户最多一个 AI 朋友（userId 唯一），
--     存名字、对用户的称呼、风格预设与自定义人设。
-- 纯加法 + 放宽约束，没有数据搬运。

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "type" VARCHAR(16) NOT NULL DEFAULT 'DIRECT';

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "aiCompanionId" UUID;

-- CreateTable
CREATE TABLE "AiCompanion" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(30) NOT NULL,
    "userNickname" VARCHAR(30) NOT NULL,
    "stylePreset" VARCHAR(32),
    "personality" VARCHAR(500),
    "greeting" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiCompanion_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "senderKind" VARCHAR(8) NOT NULL DEFAULT 'USER';

-- AlterTable
ALTER TABLE "Message" ALTER COLUMN "senderId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "AiCompanion_userId_key" ON "AiCompanion"("userId");

-- CreateIndex
CREATE INDEX "Conversation_type_aiCompanionId_idx" ON "Conversation"("type", "aiCompanionId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_aiCompanionId_key" ON "Conversation"("aiCompanionId");

-- AddForeignKey
ALTER TABLE "AiCompanion" ADD CONSTRAINT "AiCompanion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_aiCompanionId_fkey" FOREIGN KEY ("aiCompanionId") REFERENCES "AiCompanion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
