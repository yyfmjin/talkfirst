-- Phase 2 follow-up: tag every Moment row with its provenance.
--
-- Context: TalkFirst has no real OAuth/sync integration with Instagram, X,
-- TikTok, YouTube, or Facebook. When a user binds a handle,
-- `MomentsService.seedDemoMoments` fabricates placeholder rows (hardcoded copy,
-- Unsplash stock images, `Math.random()` engagement counts) so the Moments UI
-- has content to render. Those rows were previously indistinguishable from
-- genuine user posts.
--
-- This migration adds `Moment.source` and classifies existing rows correctly
-- instead of letting the column default blanket everything to 'USER'.
--
-- Classification of the rows present at migration time (verified before writing
-- this file):
--   - 22 rows on external platforms (INSTAGRAM), all carrying Unsplash stock
--     images -> these are demo seeds -> 'DEMO'
--   - 1 row on TALKFIRST -> published by a user in-app -> 'USER'
--
-- The predicate is deliberately conservative: a row is only treated as DEMO when
-- it is NOT a TALKFIRST in-app post. TALKFIRST is the platform used by
-- `MomentsService.create` for user-authored content, so anything on it is real.
-- Any external-platform row is demo by construction, since there is no sync path
-- that could have produced one.
--
-- Backup taken before this migration: .local-data/backups/pre_visibility_drop_20260917.sql

-- CreateEnum
CREATE TYPE "MomentSource" AS ENUM ('USER', 'DEMO');

-- AlterTable
ALTER TABLE "Moment" ADD COLUMN "source" "MomentSource" NOT NULL DEFAULT 'USER';

-- Classify existing rows: everything not authored in-app is placeholder content.
UPDATE "Moment"
SET "source" = 'DEMO'
WHERE "platform" <> 'TALKFIRST';
