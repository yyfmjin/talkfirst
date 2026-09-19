-- Phase 13: standalone admin console (audit log for moderation actions).
CREATE TABLE "AdminAuditLog" (
  "id" UUID NOT NULL,
  "adminId" UUID NOT NULL,
  "action" VARCHAR(64) NOT NULL,
  "targetId" UUID,
  "detail" VARCHAR(2000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminAuditLog_adminId_createdAt_idx" ON "AdminAuditLog"("adminId", "createdAt");
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");
