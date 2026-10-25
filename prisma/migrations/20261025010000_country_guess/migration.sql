-- 猜猜看（2026-10-25）
--
-- 两件事：
--   1. User 上补六列：头像尺寸（真人头像的清晰度门槛）、出池标记、默认参与开关、被猜统计。
--   2. 新建 CountryGuess：一轮一题，正确答案只存在服务端，不下发给客户端。
--
-- 默认值都取「参与但合规」：guessOptOut=false（已定默认参与）、guessTotal/Correct=0、
-- avatarWidth/Height 为 NULL —— 历史头像没有尺寸记录，要等下一次上传才补上，
-- 在那之前它们按「尺寸未知」处理（见 GuessService 的 eligibility）。

ALTER TABLE "User"
  ADD COLUMN "avatarWidth" INTEGER,
  ADD COLUMN "avatarHeight" INTEGER,
  ADD COLUMN "avatarGuessExcluded" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "guessOptOut" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "guessTotal" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "guessCorrect" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "CountryGuess" (
  "id" TEXT NOT NULL,
  "viewerId" UUID NOT NULL,
  "targetId" UUID NOT NULL,
  "correctCode" CHAR(2) NOT NULL,
  "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "guessedCode" CHAR(2),
  "correct" BOOLEAN,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CountryGuess_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CountryGuess_viewerId_targetId_createdAt_idx" ON "CountryGuess"("viewerId", "targetId", "createdAt");
CREATE INDEX "CountryGuess_targetId_idx" ON "CountryGuess"("targetId");
CREATE INDEX "CountryGuess_viewerId_expiresAt_idx" ON "CountryGuess"("viewerId", "expiresAt");

ALTER TABLE "CountryGuess"
  ADD CONSTRAINT "CountryGuess_viewerId_fkey"
  FOREIGN KEY ("viewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CountryGuess"
  ADD CONSTRAINT "CountryGuess_targetId_fkey"
  FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
