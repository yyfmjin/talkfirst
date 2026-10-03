-- CreateTable
CREATE TABLE "DiscoverCategory" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(48) NOT NULL,
    "label" VARCHAR(48) NOT NULL,
    "labelZh" VARCHAR(48),
    "keywords" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscoverCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscoverCategory_slug_key" ON "DiscoverCategory"("slug");

-- CreateIndex
CREATE INDEX "DiscoverCategory_isActive_sort_idx" ON "DiscoverCategory"("isActive", "sort");
