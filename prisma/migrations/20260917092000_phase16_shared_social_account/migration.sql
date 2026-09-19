-- Phase 16: per-pair social account authorization.
--
-- Replaces the account-global SocialAccount.visibility == EXCHANGE_ONLY flag as
-- the basis for "who may see this handle" with an explicit owner/viewer pair.
-- SocialAccount rows are NOT deleted or rewritten here; visibility is left as-is
-- so the column keeps its meaning as the account's own default state.

-- CreateTable
CREATE TABLE "SharedSocialAccount" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "viewerId" UUID NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "socialAccountId" UUID NOT NULL,
    "exchangeId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedSocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SharedSocialAccount_viewerId_ownerId_idx" ON "SharedSocialAccount"("viewerId", "ownerId");

-- CreateIndex
CREATE INDEX "SharedSocialAccount_ownerId_idx" ON "SharedSocialAccount"("ownerId");

-- CreateIndex
CREATE INDEX "SharedSocialAccount_exchangeId_idx" ON "SharedSocialAccount"("exchangeId");

-- CreateIndex
CREATE UNIQUE INDEX "SharedSocialAccount_ownerId_viewerId_platform_key" ON "SharedSocialAccount"("ownerId", "viewerId", "platform");

-- AddForeignKey
ALTER TABLE "SharedSocialAccount" ADD CONSTRAINT "SharedSocialAccount_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSocialAccount" ADD CONSTRAINT "SharedSocialAccount_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSocialAccount" ADD CONSTRAINT "SharedSocialAccount_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSocialAccount" ADD CONSTRAINT "SharedSocialAccount_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "ExchangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Backfill: turn already-accepted exchanges into per-pair grants.
--
-- Before this migration every accepted exchange flipped the two parties'
-- accounts to a global EXCHANGE_ONLY, which is exactly the over-sharing bug.
-- Reconstruct the *correct* grants from the exchange records instead:
-- for each ACCEPTED exchange and each platform it covers, grant
--   requester -> receiver   and   receiver -> requester
-- for that one pair only. Rows are inserted with ON CONFLICT DO NOTHING so the
-- migration can be re-run safely.
--
-- Partners who never exchanged get nothing, which is the intended new behaviour.
-- ---------------------------------------------------------------------------
INSERT INTO "SharedSocialAccount" ("id", "ownerId", "viewerId", "platform", "socialAccountId", "exchangeId", "createdAt")
SELECT
  gen_random_uuid(),
  e."requesterId",
  e."receiverId",
  p.platform,
  sa.id,
  e.id,
  e."updatedAt"
FROM "ExchangeRequest" e
CROSS JOIN LATERAL unnest(e."platforms") AS p(platform)
JOIN "SocialAccount" sa
  ON sa."userId" = e."requesterId"
 AND sa."platform" = p.platform
WHERE e.status = 'ACCEPTED'
ON CONFLICT ("ownerId", "viewerId", "platform") DO NOTHING;

INSERT INTO "SharedSocialAccount" ("id", "ownerId", "viewerId", "platform", "socialAccountId", "exchangeId", "createdAt")
SELECT
  gen_random_uuid(),
  e."receiverId",
  e."requesterId",
  p.platform,
  sa.id,
  e.id,
  e."updatedAt"
FROM "ExchangeRequest" e
CROSS JOIN LATERAL unnest(e."platforms") AS p(platform)
JOIN "SocialAccount" sa
  ON sa."userId" = e."receiverId"
 AND sa."platform" = p.platform
WHERE e.status = 'ACCEPTED'
ON CONFLICT ("ownerId", "viewerId", "platform") DO NOTHING;
