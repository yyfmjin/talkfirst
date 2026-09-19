-- Phase 15: personal moments (multi-platform aggregated social feed).
ALTER TYPE "SocialPlatform" ADD VALUE IF NOT EXISTS 'YOUTUBE';
ALTER TYPE "SocialPlatform" ADD VALUE IF NOT EXISTS 'FACEBOOK';

ALTER TABLE "SocialAccount" ADD COLUMN IF NOT EXISTS "syncEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "MomentPlatformBinding" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "platform" "SocialPlatform" NOT NULL,
  "handle" VARCHAR(128) NOT NULL,
  "displayName" VARCHAR(128),
  "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MomentPlatformBinding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MomentPlatformBinding_userId_platform_key" ON "MomentPlatformBinding"("userId", "platform");
CREATE INDEX IF NOT EXISTS "MomentPlatformBinding_userId_idx" ON "MomentPlatformBinding"("userId");

CREATE TABLE IF NOT EXISTS "MomentSetting" (
  "userId" UUID NOT NULL,
  "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
  "visibleTo" VARCHAR(16) NOT NULL DEFAULT 'everyone',
  "filterSensitive" BOOLEAN NOT NULL DEFAULT true,
  "showPhotos" BOOLEAN NOT NULL DEFAULT true,
  "showVideos" BOOLEAN NOT NULL DEFAULT true,
  "showTexts" BOOLEAN NOT NULL DEFAULT true,
  "showReels" BOOLEAN NOT NULL DEFAULT true,
  "showLives" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MomentSetting_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE IF NOT EXISTS "Moment" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "platform" "SocialPlatform" NOT NULL,
  "platformName" VARCHAR(32),
  "content" VARCHAR(2000) NOT NULL,
  "images" TEXT[] NOT NULL DEFAULT '{}',
  "videoUrl" VARCHAR(2000),
  "durationSec" INTEGER,
  "tags" TEXT[] NOT NULL DEFAULT '{}',
  "likeCount" INTEGER NOT NULL DEFAULT 0,
  "commentCount" INTEGER NOT NULL DEFAULT 0,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Moment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Moment_userId_createdAt_idx" ON "Moment"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Moment_platform_createdAt_idx" ON "Moment"("platform", "createdAt");
CREATE INDEX IF NOT EXISTS "Moment_createdAt_idx" ON "Moment"("createdAt");

CREATE TABLE IF NOT EXISTS "MomentLike" (
  "momentId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MomentLike_pkey" PRIMARY KEY ("momentId", "userId")
);

CREATE INDEX IF NOT EXISTS "MomentLike_userId_idx" ON "MomentLike"("userId");

CREATE TABLE IF NOT EXISTS "MomentComment" (
  "id" UUID NOT NULL,
  "momentId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "content" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MomentComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MomentComment_momentId_createdAt_idx" ON "MomentComment"("momentId", "createdAt");
CREATE INDEX IF NOT EXISTS "MomentComment_userId_idx" ON "MomentComment"("userId");
