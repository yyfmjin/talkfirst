-- SEC-003-B: refresh-token reuse detection.
--
-- Distinguishes a token revoked *because it was rotated* (`replacedById` set)
-- from one revoked deliberately (`replacedById` NULL, e.g. logout / password
-- change / admin revoke). Replaying the former is a reuse signal; the latter
-- stays an ordinary invalid refresh token.
--
-- Additive and nullable: no data is rewritten. Existing rows keep NULL and keep
-- behaving exactly as before, and no backfill is required.
ALTER TABLE "RefreshToken" ADD COLUMN "replacedById" UUID;
