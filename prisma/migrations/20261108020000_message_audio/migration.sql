-- 聊天语音消息（2026-11-08）
--
-- 与图片/视频同一套结构：`type = 'AUDIO'` + `content` 存 m4a 的 URL。
-- 不加列：时长由客户端播放器从文件里读（expo-audio 的 status.duration），
-- 存一份秒数反而会和服务端拿到的文件对不上（转码/裁剪后长度会变）。
--
-- 回滚：枚举值无法安全删除，只提供向前迁移。

ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'AUDIO';
