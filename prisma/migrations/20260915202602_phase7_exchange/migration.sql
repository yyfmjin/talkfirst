-- Phase 7: mutual Contact Exchange requests for an existing conversation.
CREATE TYPE "ExchangeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED');

CREATE TABLE "ExchangeRequest" (
  "id" UUID NOT NULL,
  "connectionId" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "requesterId" UUID NOT NULL,
  "receiverId" UUID NOT NULL,
  "platforms" "SocialPlatform"[] NOT NULL,
  "message" VARCHAR(200),
  "status" "ExchangeStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExchangeRequest_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ExchangeRequest" ADD CONSTRAINT "ExchangeRequest_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExchangeRequest" ADD CONSTRAINT "ExchangeRequest_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExchangeRequest" ADD CONSTRAINT "ExchangeRequest_receiverId_fkey"
  FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ExchangeRequest_conversationId_status_idx" ON "ExchangeRequest"("conversationId", "status");
CREATE INDEX "ExchangeRequest_requesterId_status_idx" ON "ExchangeRequest"("requesterId", "status");
CREATE INDEX "ExchangeRequest_receiverId_status_idx" ON "ExchangeRequest"("receiverId", "status");
