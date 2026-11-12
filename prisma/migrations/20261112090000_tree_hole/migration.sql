-- 树洞：匿名吐槽板（2026-11-12）

CREATE TABLE "TreeHolePost" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "alias" VARCHAR(24) NOT NULL,
  "content" VARCHAR(500) NOT NULL,
  "commentCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "TreeHolePost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TreeHolePost_createdAt_idx" ON "TreeHolePost"("createdAt");
CREATE INDEX "TreeHolePost_userId_idx" ON "TreeHolePost"("userId");

ALTER TABLE "TreeHolePost"
  ADD CONSTRAINT "TreeHolePost_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TreeHoleComment" (
  "id" UUID NOT NULL,
  "postId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "alias" VARCHAR(24) NOT NULL,
  "content" VARCHAR(300) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "TreeHoleComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TreeHoleComment_postId_createdAt_idx" ON "TreeHoleComment"("postId", "createdAt");

ALTER TABLE "TreeHoleComment"
  ADD CONSTRAINT "TreeHoleComment_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "TreeHolePost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
