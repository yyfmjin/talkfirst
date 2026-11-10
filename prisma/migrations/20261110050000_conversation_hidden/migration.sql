-- 会话按人隐藏：自己删掉聊天框，不影响对方与历史消息
ALTER TABLE "ConversationMember" ADD COLUMN "hiddenAt" TIMESTAMP(3);
