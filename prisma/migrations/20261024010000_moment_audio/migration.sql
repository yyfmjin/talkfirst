-- 语音动态（2026-10-24）
--
-- 一条动态最多一段录音，和 videoUrl 并列存放；durationSec 复用（播放器显示时长）。
-- 用可空列而不是新表：语音动态与普通动态共享全部的可见性、审核、点赞、评论逻辑，
-- 单独开表会让这些规则各写两份。
ALTER TABLE "Moment" ADD COLUMN "audioUrl" VARCHAR(2000);
