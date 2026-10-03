-- Phase O2 — site operations: access-log indexes.
--
-- The P1 Security Audit Center shipped `AccessLog` with five indexes chosen for
-- the queries an ops console would run, but five were missing:
--
--   * `requestId` is the ONLY correlation key between an access row and the
--     security event recorded for the same request (`SecurityEvent.requestId`).
--     Without an index, "what else happened on this request?" was a sequential
--     scan of the fastest-growing table in the schema.
--   * `deviceHash` is indexed on `SecurityEvent` but was not indexed here, so
--     device correlation over access history could not use an index.
--   * `riskLevel`, `isAdmin` and `authenticated` are all three offered as filters
--     by the ops console and had no supporting index.
--
-- Indexes only: no column, constraint or data change. Safe to apply on a live
-- table (CREATE INDEX takes a brief write lock; the table is small today).

CREATE INDEX "AccessLog_requestId_idx" ON "AccessLog"("requestId");

CREATE INDEX "AccessLog_deviceHash_createdAt_idx" ON "AccessLog"("deviceHash", "createdAt");

CREATE INDEX "AccessLog_riskLevel_createdAt_idx" ON "AccessLog"("riskLevel", "createdAt");

CREATE INDEX "AccessLog_isAdmin_createdAt_idx" ON "AccessLog"("isAdmin", "createdAt");

CREATE INDEX "AccessLog_authenticated_createdAt_idx" ON "AccessLog"("authenticated", "createdAt");
