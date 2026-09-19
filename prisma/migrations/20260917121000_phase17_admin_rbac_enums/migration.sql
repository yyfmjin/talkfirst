-- Phase A (Admin RBAC) — migration 1 of 2: enum additions only.
--
-- Deliberately isolated from the rest of the Phase A DDL. PostgreSQL's
-- `ALTER TYPE ... ADD VALUE` has transaction-visibility rules: the new value
-- cannot be *used* until the transaction that added it commits. Keeping enum
-- additions in their own migration guarantees no later statement in the same
-- transaction ever tries to reference 'SUSPENDED' or the new AdminRole type.
--
-- No existing enum value is removed or renamed.

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'MODERATOR', 'SUPPORT', 'ANALYST', 'CONTENT_MANAGER');

-- AlterEnum
ALTER TYPE "UserStatus" ADD VALUE 'SUSPENDED';
