-- 好友分组 + 每个用户对每个好友的分类（2026-11-10）

CREATE TABLE "FriendGroup" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" VARCHAR(24) NOT NULL,
  "kind" VARCHAR(16) NOT NULL DEFAULT 'CUSTOM',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FriendGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FriendGroup_userId_name_key" ON "FriendGroup"("userId", "name");
CREATE INDEX "FriendGroup_userId_sortOrder_idx" ON "FriendGroup"("userId", "sortOrder");

ALTER TABLE "FriendGroup"
  ADD CONSTRAINT "FriendGroup_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "FriendTag" (
  "connectionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" VARCHAR(16) NOT NULL DEFAULT 'FRIEND',
  "groupId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FriendTag_pkey" PRIMARY KEY ("connectionId", "userId")
);

CREATE INDEX "FriendTag_userId_idx" ON "FriendTag"("userId");
CREATE INDEX "FriendTag_groupId_idx" ON "FriendTag"("groupId");

ALTER TABLE "FriendTag"
  ADD CONSTRAINT "FriendTag_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FriendTag"
  ADD CONSTRAINT "FriendTag_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FriendTag"
  ADD CONSTRAINT "FriendTag_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "FriendGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
