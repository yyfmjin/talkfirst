-- Phase 16: record the TALKFIRST value on the SocialPlatform enum.
--
-- The value already exists in every environment (moments and social accounts
-- use it), but no migration ever emitted it, so the migration history did not
-- reproduce the schema. This migration closes that gap.
--
-- ALTER TYPE ... ADD VALUE is idempotent here via IF NOT EXISTS, and the value
-- is never removed (PostgreSQL cannot drop a single enum value safely).
ALTER TYPE "SocialPlatform" ADD VALUE IF NOT EXISTS 'TALKFIRST';
