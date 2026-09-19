-- Phase A (Admin RBAC) — migration 2 of 2: tables, columns, indexes, FKs, backfill.
--
-- Backup taken before this migration: .local-data/backups/pre_admin_rbac_20260917.sql
--
-- Pre-flight integrity checks (all verified 0 before writing this file):
--   AdminAuditLog.adminId orphans ............ 0
--   AdminNote.adminId orphans ................ 0
--   AdminAuditLog.targetId non-UUID values ... 0  (safe to widen UUID -> VARCHAR)
--   User.isAdmin = true ...................... 9  (backfilled as SUPER_ADMIN)
--
-- Safety notes:
--   * `targetId` is WIDENED (uuid -> varchar(128)), which is lossless.
--   * The two new FKs use ON DELETE RESTRICT, never CASCADE, so audit rows and
--     admin notes cannot be silently destroyed by deleting an admin account.
--   * New columns are all nullable or defaulted, so no table rewrite.
--   * `AdminUser.updatedAt` has no SQL default (Prisma manages it), so the
--     backfill supplies it explicitly.

-- AlterTable
ALTER TABLE "AdminAuditLog" ADD COLUMN     "after" JSONB,
ADD COLUMN     "before" JSONB,
ADD COLUMN     "ip" VARCHAR(45),
ADD COLUMN     "reason" VARCHAR(500),
ADD COLUMN     "targetType" VARCHAR(32),
ADD COLUMN     "userAgent" VARCHAR(512),
ALTER COLUMN "targetId" SET DATA TYPE VARCHAR(128);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "suspendedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'MODERATOR',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_userId_key" ON "AdminUser"("userId");

-- CreateIndex
CREATE INDEX "AdminUser_role_idx" ON "AdminUser"("role");

-- CreateIndex
CREATE INDEX "AdminUser_isActive_idx" ON "AdminUser"("isActive");

-- CreateIndex
CREATE INDEX "AdminAuditLog_action_createdAt_idx" ON "AdminAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetType_targetId_idx" ON "AdminAuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AdminNote_adminId_createdAt_idx" ON "AdminNote"("adminId", "createdAt");

-- AddForeignKey
ALTER TABLE "AdminUser" ADD CONSTRAINT "AdminUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNote" ADD CONSTRAINT "AdminNote_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: every existing administrator becomes SUPER_ADMIN.
--
-- Rationale: introducing RBAC must not silently strip capabilities from the
-- admins who already exist. All 9 current admins keep full power; roles can be
-- downgraded deliberately afterwards. `ON CONFLICT DO NOTHING` keeps this
-- idempotent.
INSERT INTO "AdminUser" ("id", "userId", "role", "isActive", "createdBy", "createdAt", "updatedAt")
SELECT gen_random_uuid(), u."id", 'SUPER_ADMIN', true, NULL, now(), now()
FROM "User" u
WHERE u."isAdmin" = true
ON CONFLICT ("userId") DO NOTHING;
