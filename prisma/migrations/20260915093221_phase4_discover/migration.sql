-- AlterTable
ALTER TABLE "SchemaMeta" ALTER COLUMN "phase" SET DEFAULT '4-discover';

-- CreateTable
CREATE TABLE "DiscoverView" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "viewedUserId" UUID NOT NULL,
    "viewDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoverView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoverView_userId_viewDate_idx" ON "DiscoverView"("userId", "viewDate");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoverView_userId_viewedUserId_viewDate_key" ON "DiscoverView"("userId", "viewedUserId", "viewDate");
