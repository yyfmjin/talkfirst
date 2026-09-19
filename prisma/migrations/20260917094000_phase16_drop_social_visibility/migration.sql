-- Phase 2 follow-up: drop the account-global `SocialAccount.visibility` column.
--
-- Authorization to read a handle is now decided exclusively by
-- `SharedSocialAccount` (ownerId, viewerId, platform) rows created at the moment
-- an exchange is accepted. `visibility` was per-account (not per-viewer), so it
-- could never express "A shared this with B but not with C" — the exact gap that
-- caused the cross-conversation leak this phase fixed.
--
-- The column is now dead weight: the API neither reads nor writes it. It is
-- dropped here so no future code can reintroduce an account-global read rule by
-- accident.
--
-- Backup taken before this migration: .local-data/backups/pre_visibility_drop_20260917.sql

-- AlterTable
ALTER TABLE "SocialAccount" DROP COLUMN "visibility";

-- DropEnum
DROP TYPE "SocialVisibility";
