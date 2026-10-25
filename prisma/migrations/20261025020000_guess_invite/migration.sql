-- 猜猜看改邀请制（2026-10-25）
--
-- 背景：原设计是「默认参与 + 合格真人头像」。用真人照片做题目时，自动人脸检测
-- 既解决不了同意问题，也会把一批愿意参与的人挡在外面；而外国人尤其在意
-- 「我的照片被拿去干什么」。所以改成：默认不参与，我们挑合适的用户推送邀请，
-- 接受后才进题库。
--
-- guessOptOut（默认参与）随之废弃：它的语义和邀请制正好相反，留着两颗开关
-- 一定会有人读错。删掉，换成 guessOptIn + 三个邀请时间戳。

ALTER TABLE "User"
  DROP COLUMN IF EXISTS "guessOptOut",
  ADD COLUMN "guessOptIn" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "guessInvitedAt" TIMESTAMP(3),
  ADD COLUMN "guessInviteAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "guessInviteDeclinedAt" TIMESTAMP(3);

-- 之前的测试数据（guessTotal 等）保留：统计的是「被猜」的事实，与参与开关无关。
CREATE INDEX "User_guessOptIn_avatarIdx" ON "User"("guessOptIn");
