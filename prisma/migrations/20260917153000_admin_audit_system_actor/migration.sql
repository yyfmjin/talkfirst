-- Admin Audit Infrastructure: let the platform itself be an audited actor.
--
-- Why this shape:
--   * No system User row is created. A fake account would be searchable, could
--     become loginable if a hash check ever loosened, and would pollute user
--     counts and the dashboard's "total users". NULL is the honest
--     representation of "no human performed this action".
--   * `actorType` is added with a constant default, which is a metadata-only
--     operation in PostgreSQL 11+. The existing rows are not rewritten and keep
--     their exact meaning: they are all human actions.
--   * `DROP NOT NULL` is likewise metadata-only and is a *widening* change —
--     every existing adminId stays valid and every existing query behaves
--     identically.
--   * No historical AdminAuditLog row is deleted or altered.
--
-- Verified before applying: 17 audit rows, 0 with a NULL adminId, 4 distinct
-- adminIds all resolving to real Users. Every existing row is therefore
-- classifiable as USER, which is exactly what the DEFAULT assigns.

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM');

-- AlterTable
ALTER TABLE "AdminAuditLog" ADD COLUMN     "actorType" "AuditActorType" NOT NULL DEFAULT 'USER',
ALTER COLUMN "adminId" DROP NOT NULL;

-- Pairing rule.
--
-- IMPORTANT: Prisma's schema language cannot express conditional nullability, so
-- this constraint exists ONLY in this file. `prisma migrate diff` and `db pull`
-- do not know about it, which means a future `migrate dev` that regenerated this
-- migration would silently drop it. Do not regenerate it; the assertion in
-- scripts/phaseA-rbac-verify.mjs fails loudly if it ever goes missing.
--
-- It makes the two states the design forbids unrepresentable at the database
-- level, so no application bug — and no hand-written SQL — can produce them:
--   actorType = 'SYSTEM' WITH an adminId  (a forged administrator identity)
--   actorType = 'USER'   WITHOUT one      (an unattributed human action)
--
-- Existing rows all have a non-NULL adminId and receive actorType = 'USER' from
-- the DEFAULT above, so they satisfy the constraint as written.
ALTER TABLE "AdminAuditLog"
  ADD CONSTRAINT "AdminAuditLog_actor_consistency_check"
  CHECK (
    ("actorType" = 'USER'   AND "adminId" IS NOT NULL) OR
    ("actorType" = 'SYSTEM' AND "adminId" IS NULL)
  );
