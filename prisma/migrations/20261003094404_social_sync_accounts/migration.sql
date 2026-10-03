-- CreateEnum
CREATE TYPE "SocialSyncProvider" AS ENUM ('YOUTUBE', 'X', 'TIKTOK', 'INSTAGRAM', 'DOUYIN');

-- CreateEnum
CREATE TYPE "SocialSyncStatus" AS ENUM ('ACTIVE', 'NEEDS_REAUTH', 'REVOKED');

-- CreateEnum
CREATE TYPE "SocialSyncMediaType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'LINK');

-- CreateTable
CREATE TABLE "SocialSyncPost" (
    "id" UUID NOT NULL,
    "socialAccountId" UUID NOT NULL,
    "provider" "SocialSyncProvider" NOT NULL,
    "externalPostId" VARCHAR(255) NOT NULL,
    "externalUrl" VARCHAR(1000) NOT NULL,
    "authorId" VARCHAR(255),
    "authorName" VARCHAR(255),
    "authorAvatar" VARCHAR(1000),
    "text" TEXT,
    "title" VARCHAR(500),
    "mediaType" "SocialSyncMediaType" NOT NULL DEFAULT 'TEXT',
    "thumbnailUrl" VARCHAR(1000),
    "mediaUrl" VARCHAR(1000),
    "embedUrl" VARCHAR(1000),
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "rawData" JSONB,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "importedMomentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialSyncPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialSyncAccount" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "SocialSyncProvider" NOT NULL,
    "providerUserId" VARCHAR(255) NOT NULL,
    "handle" VARCHAR(255),
    "displayName" VARCHAR(255),
    "avatarUrl" VARCHAR(1000),
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "scope" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "syncLimit" INTEGER NOT NULL DEFAULT 3,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "SocialSyncStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialSyncAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialSyncPost_socialAccountId_publishedAt_idx" ON "SocialSyncPost"("socialAccountId", "publishedAt");

-- CreateIndex
CREATE INDEX "SocialSyncPost_socialAccountId_hidden_idx" ON "SocialSyncPost"("socialAccountId", "hidden");

-- CreateIndex
CREATE UNIQUE INDEX "SocialSyncPost_socialAccountId_provider_externalPostId_key" ON "SocialSyncPost"("socialAccountId", "provider", "externalPostId");

-- CreateIndex
CREATE INDEX "SocialSyncAccount_userId_idx" ON "SocialSyncAccount"("userId");

-- CreateIndex
CREATE INDEX "SocialSyncAccount_status_syncEnabled_lastSyncedAt_idx" ON "SocialSyncAccount"("status", "syncEnabled", "lastSyncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialSyncAccount_userId_provider_key" ON "SocialSyncAccount"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "SocialSyncAccount_provider_providerUserId_key" ON "SocialSyncAccount"("provider", "providerUserId");

-- AddForeignKey
ALTER TABLE "SocialSyncPost" ADD CONSTRAINT "SocialSyncPost_socialAccountId_fkey" FOREIGN KEY ("socialAccountId") REFERENCES "SocialSyncAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialSyncAccount" ADD CONSTRAINT "SocialSyncAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
