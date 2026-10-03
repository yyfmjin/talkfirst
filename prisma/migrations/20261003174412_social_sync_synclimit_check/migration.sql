-- The 1..3 range for `SocialSyncAccount.syncLimit`, enforced by the database.
--
-- Why this is hand-written SQL rather than part of the Prisma schema: Prisma has no
-- syntax for a CHECK constraint, so `@@`-level validation cannot express it. The
-- service layer validates the same range, but a service-layer check is bypassed by
-- any path that does not go through that service — a future admin tool, a data
-- import, a migration script or a manual `psql` session. The product promise is
-- "1 to 3 posts", so the invariant belongs where it cannot be skipped.
--
-- Added only when absent, matching the convention in
-- `20260917090000_phase15_foreign_keys_and_indexes`, so this is safe to re-run
-- against a database that already received the constraint out-of-band.
--
-- A NOT VALID / VALIDATE pair is deliberately NOT used: the table was created by
-- the preceding migration and is empty on every environment that has not yet run
-- application code, so there is no existing row to scan and no need to take a
-- weaker lock.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'SocialSyncAccount_syncLimit_range'
      AND conrelid = to_regclass('"SocialSyncAccount"')
  ) THEN
    ALTER TABLE "SocialSyncAccount"
      ADD CONSTRAINT "SocialSyncAccount_syncLimit_range"
      CHECK ("syncLimit" >= 1 AND "syncLimit" <= 3);
  END IF;
END $$;
