-- Phase 14: translation cache + audit log (audit table is IF NOT EXISTS for local seed compat).
CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
  "id" UUID NOT NULL,
  "adminId" UUID NOT NULL,
  "action" VARCHAR(64) NOT NULL,
  "targetId" UUID,
  "detail" VARCHAR(2000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdminAuditLog_adminId_createdAt_idx" ON "AdminAuditLog"("adminId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

CREATE TABLE "MessageTranslation" (
  "id" UUID NOT NULL,
  "messageId" UUID NOT NULL,
  "sourceLang" VARCHAR(8) NOT NULL,
  "targetLang" VARCHAR(8) NOT NULL,
  "text" VARCHAR(2000) NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MessageTranslation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageTranslation_messageId_targetLang_key" ON "MessageTranslation"("messageId", "targetLang");
CREATE INDEX "MessageTranslation_messageId_idx" ON "MessageTranslation"("messageId");
