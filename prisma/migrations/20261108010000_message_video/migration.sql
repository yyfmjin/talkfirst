-- 聊天视频消息（2026-11-08）
--
-- 背景：图片消息一直是 `type = 'IMAGE'` + `content` 存服务端 URL；视频沿用同一套
-- 结构，只是类型多一个档位，所以**不需要加列** —— `content` 是 VarChar(2000)，
-- 放一个 URL 绰绰有余。
--
-- Postgres 12+ 允许在事务里执行 ADD VALUE（Prisma 迁移默认包在事务里），
-- 所以这条不需要改 migration 的执行方式。
--
-- 回滚：枚举值无法安全删除（删除前得确认没有行在用），因此这里只提供向前迁移。

ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'VIDEO';
