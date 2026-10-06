-- 2026-10-06 — 访问日志按渠道分流：后台默认只看成员流量。
--
-- 需求来自运营方：后台自己操作后台、服务器被自己探来探去（健康检查、部署自检、运维命令），
-- 这些行会把真实成员流量淹在噪音里。要求是「单独记录，但不要出现在访问日志里」——
-- 所以**不删行**，只加一个渠道字段并让默认视图过滤掉它们。
--
-- 三个取值：
--   USER   普通成员流量（默认视图）
--   ADMIN  命中后台路由的请求（与既有 `isAdmin` 同源，按路径判）
--   OPS    来自服务器自身 / 环回地址的请求（探针、运维命令、部署自检）
--
-- ## 历史行也要回填，否则「噪音」会永远留在默认视图里
--
-- 列默认值是 'USER'，如果不回填，此前所有 ADMIN/OPS 行会全部被当成成员流量。
-- 回填顺序与运行时分类函数的优先级一致：**先 OPS，再 ADMIN，最后剩下的才是 USER**。
-- 环回地址列表与 `src/security/access-channel.ts` 里的常量一致；服务器公网 IP
-- 无法写在迁移里（因环境而异），它靠运行时的 `OPS_IPS` 环境变量补上。
--
-- 这一步是纯加法：不删列、不改既有列、不重写任何业务数据。

ALTER TABLE "AccessLog" ADD COLUMN "channel" VARCHAR(8) NOT NULL DEFAULT 'USER';

-- 1) 来自服务器自身 / 环回的请求
UPDATE "AccessLog"
   SET "channel" = 'OPS'
 WHERE "ip" IN ('127.0.0.1', '::1', '::ffff:127.0.0.1');

-- 2) 命中后台路由的请求（`isAdmin` 是既有的按路径判断结果，这里直接复用）
UPDATE "AccessLog"
   SET "channel" = 'ADMIN'
 WHERE "channel" = 'USER'
   AND "isAdmin" = true;

-- 3) 默认视图的索引
CREATE INDEX "AccessLog_channel_createdAt_idx" ON "AccessLog" ("channel", "createdAt");
