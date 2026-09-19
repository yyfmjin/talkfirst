-- PC-1.2 PROFILE ATTRIBUTE MIGRATION PLAN (NOT A MIGRATION)
--
-- This file is a PLAN ARTIFACT for review. It is deliberately NOT placed in
-- prisma/migrations, so no tool will ever apply it automatically.
--
-- It has NOT been executed. `prisma migrate dev` and `prisma migrate deploy`
-- were NOT run in this phase.
--
-- Generated with:
--   npx prisma migrate diff \
--     --from-schema-datasource prisma/schema.prisma \
--     --to-schema-datamodel  prisma/schema.prisma \
--     --script
--
-- The `--from-schema-datasource` side reads the database at localhost:5433,
-- the local development database, NOT production. This proves only that the
-- localhost:5433 delta is verified. Production DB status is UNKNOWN.
--
-- Properties verified in this output:
--   * ADDITIVE ONLY — there is no DROP TABLE, DROP COLUMN, ALTER COLUMN TYPE,
--     or DROP INDEX anywhere in this script.
--   * Exactly one existing table is touched: "User" gains one NULLABLE column
--     with no default (metadata-only in PostgreSQL 11+, no table rewrite).
--   * No existing enum is altered, so no ALTER TYPE is present.
--   * No existing row is read, rewritten, backfilled, or deleted.
--
-- ============================================================================
-- BEGIN GENERATED DDL
-- ============================================================================

-- CreateEnum
CREATE TYPE "AttributeKind" AS ENUM ('ABOUT_ME', 'LOOKING_FOR');

-- CreateEnum
CREATE TYPE "AttributeSource" AS ENUM ('SYSTEM', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AttributeValueType" AS ENUM ('BOOLEAN', 'TEXT', 'SINGLE_SELECT', 'MULTI_SELECT');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PUBLIC', 'CONNECTIONS', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'HIDDEN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "region" VARCHAR(80);

-- CreateTable
CREATE TABLE "AttributeDefinition" (
    "id" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "scope" "AttributeSource" NOT NULL DEFAULT 'SYSTEM',
    "kind" "AttributeKind" NOT NULL,
    "category" VARCHAR(32) NOT NULL,
    "label" VARCHAR(32) NOT NULL,
    "labelZh" VARCHAR(32),
    "valueType" "AttributeValueType" NOT NULL DEFAULT 'BOOLEAN',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSearchable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttributeDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAttribute" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "AttributeKind" NOT NULL,
    "definitionId" UUID,
    "label" VARCHAR(32),
    "labelKey" VARCHAR(32),
    "value" VARCHAR(80),
    "visibility" "Visibility" NOT NULL DEFAULT 'PUBLIC',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'APPROVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileFieldVisibility" (
    "userId" UUID NOT NULL,
    "fieldKey" VARCHAR(32) NOT NULL,
    "visibility" "Visibility" NOT NULL DEFAULT 'PUBLIC',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileFieldVisibility_pkey" PRIMARY KEY ("userId","fieldKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttributeDefinition_key_key" ON "AttributeDefinition"("key");

-- CreateIndex
CREATE INDEX "AttributeDefinition_kind_isActive_idx" ON "AttributeDefinition"("kind", "isActive");

-- CreateIndex
CREATE INDEX "AttributeDefinition_category_idx" ON "AttributeDefinition"("category");

-- CreateIndex
CREATE INDEX "UserAttribute_userId_kind_idx" ON "UserAttribute"("userId", "kind");

-- CreateIndex
CREATE INDEX "UserAttribute_reviewStatus_idx" ON "UserAttribute"("reviewStatus");

-- CreateIndex
CREATE INDEX "UserAttribute_definitionId_idx" ON "UserAttribute"("definitionId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAttribute_userId_definitionId_key" ON "UserAttribute"("userId", "definitionId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAttribute_userId_kind_labelKey_key" ON "UserAttribute"("userId", "kind", "labelKey");

-- CreateIndex
CREATE INDEX "ProfileFieldVisibility_fieldKey_visibility_idx" ON "ProfileFieldVisibility"("fieldKey", "visibility");

-- AddForeignKey
ALTER TABLE "UserAttribute" ADD CONSTRAINT "UserAttribute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAttribute" ADD CONSTRAINT "UserAttribute_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "AttributeDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileFieldVisibility" ADD CONSTRAINT "ProfileFieldVisibility_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

