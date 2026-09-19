-- Phase 5: link each Connection to its 1:1 Conversation (nullable so past
-- rows migrate cleanly; enforced as unique for all new rows).
ALTER TABLE "Connection" ADD COLUMN "conversationId" UUID;

CREATE UNIQUE INDEX "Connection_conversationId_key" ON "Connection"("conversationId");
