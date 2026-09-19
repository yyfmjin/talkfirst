-- Phase 15 follow-up: add foreign keys and indexes that the Prisma schema
-- declares but that were never emitted into the earlier migrations.
--
-- Before this migration the moments tables had no FK to "User"/"Moment", so
-- deleting a user orphaned their moments, likes, comments, settings and
-- platform bindings instead of cascading. "Connection.conversationId" and
-- "MessageTranslation.messageId" had the same problem.
--
-- Constraints are added only when absent, so the migration is safe to re-run
-- against databases that already received these keys out-of-band.
-- Note: table names are passed unquoted and resolved through to_regclass so
-- mixed-case identifiers ("Moment") resolve correctly.

-- Missing index declared by @@index([senderId, receiverId, createdAt]).
CREATE INDEX IF NOT EXISTS "ConnectionRequest_senderId_receiverId_createdAt_idx"
  ON "ConnectionRequest"("senderId", "receiverId", "createdAt");

-- SchemaMeta.phase default drifted from "4-discover" to "15-moments".
ALTER TABLE "SchemaMeta" ALTER COLUMN "phase" SET DEFAULT '15-moments';

-- Add a foreign key only when it is not already present.
-- Identifiers are passed through format('%I')/quote_ident for the DDL, and
-- wrapped in double quotes for to_regclass so mixed-case names ("Moment")
-- resolve to the real table instead of being folded to lowercase.
CREATE OR REPLACE FUNCTION pg_temp.add_fk_if_missing(
  tbl TEXT,
  con TEXT,
  cols TEXT,
  ref_tbl TEXT,
  ref_cols TEXT,
  del_action TEXT
) RETURNS void AS $$
DECLARE
  tbl_ident TEXT := format('%I', tbl);
  ref_ident TEXT := format('%I', ref_tbl);
BEGIN
  IF to_regclass('"' || tbl || '"') IS NULL THEN
    RAISE EXCEPTION 'table % does not exist', tbl;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = con
      AND conrelid = to_regclass('"' || tbl || '"')
  ) THEN
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES %s(%s) ON DELETE %s ON UPDATE CASCADE',
      tbl_ident, con, cols, ref_ident, ref_cols, del_action
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

SELECT pg_temp.add_fk_if_missing('MomentPlatformBinding', 'MomentPlatformBinding_userId_fkey', '"userId"', 'User', 'id', 'CASCADE');
SELECT pg_temp.add_fk_if_missing('MomentSetting', 'MomentSetting_userId_fkey', '"userId"', 'User', 'id', 'CASCADE');
SELECT pg_temp.add_fk_if_missing('Moment', 'Moment_userId_fkey', '"userId"', 'User', 'id', 'CASCADE');
SELECT pg_temp.add_fk_if_missing('MomentLike', 'MomentLike_momentId_fkey', '"momentId"', 'Moment', 'id', 'CASCADE');
SELECT pg_temp.add_fk_if_missing('MomentLike', 'MomentLike_userId_fkey', '"userId"', 'User', 'id', 'CASCADE');
SELECT pg_temp.add_fk_if_missing('MomentComment', 'MomentComment_momentId_fkey', '"momentId"', 'Moment', 'id', 'CASCADE');
SELECT pg_temp.add_fk_if_missing('MomentComment', 'MomentComment_userId_fkey', '"userId"', 'User', 'id', 'CASCADE');
SELECT pg_temp.add_fk_if_missing('Connection', 'Connection_conversationId_fkey', '"conversationId"', 'Conversation', 'id', 'SET NULL');
SELECT pg_temp.add_fk_if_missing('MessageTranslation', 'MessageTranslation_messageId_fkey', '"messageId"', 'Message', 'id', 'CASCADE');
