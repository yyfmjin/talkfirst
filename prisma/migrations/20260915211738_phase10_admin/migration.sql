-- Phase 10: minimal admin moderation (ban state + operator notes).
ALTER TABLE "User" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "bannedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "banReason" VARCHAR(500);

CREATE TABLE "AdminNote" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "adminId" UUID NOT NULL,
  "body" VARCHAR(1000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdminNote_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AdminNote" ADD CONSTRAINT "AdminNote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "AdminNote_userId_createdAt_idx" ON "AdminNote"("userId", "createdAt");
