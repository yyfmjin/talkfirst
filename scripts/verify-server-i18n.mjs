#!/usr/bin/env node
/**
 * 服务端下发文案的多语言 —— 端到端验证（真实 HTTP + 真实 PostgreSQL）。
 *
 * ## 为什么需要它
 *
 * 通知的语言由**收件人**决定，而收件人通常不是发起请求的人（给你发消息的是对方）。
 * 单元测试能证明词条与语言判定，证明不了「HTTP → JWT → 服务层 → 写库」这一整条链
 * 上语言确实跟着收件人走。这个脚本用三个临时账号把三条规则各跑一遍：
 *
 *   1. **母语兜底**：`locale` 为空、母语英文 → 英文通知（老账号走的就是这条）；
 *   2. **显式语言优先于母语**：`locale = zh`、母语英文 → 中文通知；
 *   3. **用户自己写的内容不翻译**：打招呼的自定义消息原样出现在通知正文里。
 *
 * 顺带钉住 `PATCH /users/me { locale }` 这个新契约（客户端切换语言时上报）。
 *
 * ## 它在库里留下什么
 *
 * 三个临时账号（邮箱域名 `@i18n-check.invalid`），跑完即删；失败也会在 `finally` 里删。
 * **只对本地 / 测试库运行**，不要指向生产库。
 *
 * ## 用法
 *
 *   # 终端 A：起本地库（项目惯例的封装脚本，起 PG → 跑 payload → 停 PG）
 *   bash .local-data/pc12/withpg.sh /tmp/run-i18n-e2e.sh
 *   # 其中 payload 负责 build + 起 API + 调用本脚本
 *
 *   node --env-file=.env scripts/verify-server-i18n.mjs http://127.0.0.1:4100
 */

import { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";

const require = createRequire(import.meta.url);
const bcrypt = require("bcryptjs");

const baseUrl = process.argv[2] ?? "http://127.0.0.1:4100";
const api = `${baseUrl}/api/v1`;
const PASSWORD = "I18nVerify!2026";
const EMAIL_DOMAIN = "i18n-check.invalid";

const prisma = new PrismaClient();
const results = [];

function check(label, actual, expected) {
  const pass = actual === expected;
  results.push({ label, pass, actual, expected });
  console.log(`${pass ? "✅" : "❌"} ${label}${pass ? "" : `\n     期望：${expected}\n     实际：${actual}`}`);
}

async function call(path, { method = "GET", body, token, acceptLanguage } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(acceptLanguage ? { "Accept-Language": acceptLanguage } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

async function seedUser({ key, nickname, nativeLanguage, locale }) {
  const user = await prisma.user.create({
    data: {
      email: `i18n-${key}@${EMAIL_DOMAIN}`,
      username: `i18ncheck${key}`,
      nickname,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      emailVerified: true,
      status: "ACTIVE",
      locale: locale ?? null,
    },
  });
  await prisma.userLanguage.create({
    data: {
      userId: user.id,
      languageCode: nativeLanguage,
      type: "NATIVE",
      level: "NATIVE",
    },
  });
  return user;
}

async function signIn(email) {
  const { status, payload } = await call("/auth/login", {
    method: "POST",
    body: { email, password: PASSWORD },
  });
  if (status !== 200 || !payload?.accessToken) {
    throw new Error(`登录失败（${status}）：${JSON.stringify(payload)?.slice(0, 200)}`);
  }
  return payload.accessToken;
}

async function notificationsOf(token, type) {
  const { payload } = await call(`/notifications?type=${type}`, { token });
  const items = payload?.data?.items ?? payload?.data ?? [];
  return Array.isArray(items) ? items : [];
}

/** 上一次跑到一半留下的账号（同一邮箱域名）—— 不先清掉，重跑就撞唯一索引。 */
async function cleanupStaleAccounts() {
  const stale = await prisma.user.findMany({
    where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
    select: { id: true },
  });
  if (stale.length > 0) {
    console.log(`（清理上次残留的 ${stale.length} 个临时账号）`);
    await cleanup(stale.map((row) => row.id));
  }
}

async function cleanup(userIds) {
  // 顺序按外键依赖来，尽量不依赖级联是否配齐。
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  const memberships = await prisma.conversationMember.findMany({
    where: { userId: { in: userIds } },
    select: { conversationId: true },
  });
  const conversationIds = memberships.map((row) => row.conversationId);
  if (conversationIds.length > 0) {
    await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await prisma.conversationMember.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  }
  await prisma.connectionRequest.deleteMany({
    where: { OR: [{ senderId: { in: userIds } }, { receiverId: { in: userIds } }] },
  });
  await prisma.connection.deleteMany({
    where: { OR: [{ userAId: { in: userIds } }, { userBId: { in: userIds } }] },
  });
  await prisma.userLanguage.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main() {
  console.log(`\n== 服务端文案多语言 · 端到端验证（${api}）==\n`);

  await cleanupStaleAccounts();

  // A：母语中文、没上报过界面语言 —— 老账号的样子。
  // B：母语英文、没上报过 —— 必须靠母语兜底拿到英文通知。
  // C：母语英文、界面语言中文 —— 显式选择优先于母语。
  const a = await seedUser({ key: "a", nickname: "阿明", nativeLanguage: "zh" });
  const b = await seedUser({ key: "b", nickname: "Ben", nativeLanguage: "en" });
  const c = await seedUser({ key: "c", nickname: "Chen", nativeLanguage: "en", locale: "zh" });

  try {
    const [tokenA, tokenB, tokenC] = await Promise.all([
      signIn(a.email),
      signIn(b.email),
      signIn(c.email),
    ]);

    // ① A 向 B 打招呼（带一句自己写的话）
    const hello = await call("/connections/requests", {
      method: "POST",
      token: tokenA,
      body: { receiverId: b.id, message: "你好，我叫阿明" },
    });
    if (hello.status !== 201) {
      throw new Error(`打招呼失败（${hello.status}）：${JSON.stringify(hello.payload)?.slice(0, 200)}`);
    }
    const requestId = hello.payload.data.id;

    const bNotifications = await notificationsOf(tokenB, "SAY_HELLO");
    check("母语英文的收件人收到英文标题", bNotifications[0]?.title, "阿明 said hello");
    check("用户自己写的内容原样保留（不翻译）", bNotifications[0]?.body, "你好，我叫阿明");

    // ② B 接受 → 通知发给 A（母语中文、没上报过界面语言）
    const accepted = await call(`/connections/requests/${requestId}/respond`, {
      method: "POST",
      token: tokenB,
      body: { action: "accept" },
    });
    if (accepted.status !== 201) {
      throw new Error(`接受失败（${accepted.status}）：${JSON.stringify(accepted.payload)?.slice(0, 200)}`);
    }
    const aNotifications = await notificationsOf(tokenA, "REQUEST_ACCEPTED");
    check("母语中文的收件人收到中文标题", aNotifications[0]?.title, "🎉 连接成功！");

    // ③ B 在新建的会话里发一条消息 → A 收到消息通知
    const conversations = await call("/conversations", { token: tokenB });
    const conversationId = (conversations.payload?.data ?? [])[0]?.id;
    if (!conversationId) throw new Error("接受后没找到会话");
    const sent = await call(`/conversations/${conversationId}/messages`, {
      method: "POST",
      token: tokenB,
      body: { content: "Nice to meet you, 阿明" },
    });
    if (sent.status !== 201) {
      throw new Error(`发消息失败（${sent.status}）：${JSON.stringify(sent.payload)?.slice(0, 200)}`);
    }
    const messageNotifications = await notificationsOf(tokenA, "NEW_MESSAGE");
    check("消息通知按收件人语言（中文）", messageNotifications[0]?.title, "新消息");
    check("消息预览是原文", messageNotifications[0]?.body, "Nice to meet you, 阿明");

    // ④ 显式选择的界面语言优先于母语：C（母语英文、locale=zh）
    const helloToC = await call("/connections/requests", {
      method: "POST",
      token: tokenA,
      body: { receiverId: c.id, templateId: "language" },
    });
    if (helloToC.status !== 201) {
      throw new Error(`向 C 打招呼失败（${helloToC.status}）`);
    }
    const cNotifications = await notificationsOf(tokenC, "SAY_HELLO");
    check("显式选择优先于母语（locale=zh → 中文标题）", cNotifications[0]?.title, "阿明 想和你打个招呼");
    check("模板招呼语也按收件人语言渲染", cNotifications[0]?.body, "🗣️ 我想练练口语");

    // ⑤ 新契约：客户端上报语言
    const patched = await call("/users/me", { method: "PATCH", token: tokenC, body: { locale: "en" } });
    check("PATCH /users/me { locale } 返回 200", patched.status, 200);
    const stored = await prisma.user.findUnique({
      where: { id: c.id },
      select: { locale: true },
    });
    check("语言已写入账号", stored?.locale, "en");
    const rejected = await call("/users/me", { method: "PATCH", token: tokenC, body: { locale: "ja" } });
    check("不支持的语言被拒（400）", rejected.status, 400);
    const untouched = await prisma.user.findUnique({
      where: { id: c.id },
      select: { locale: true },
    });
    check("被拒的写入没有落库", untouched?.locale, "en");
  } finally {
    await cleanup([a.id, b.id, c.id]).catch((error) => {
      console.error(`清理临时账号失败：${error.message}`);
    });
  }

  const failed = results.filter((row) => !row.pass);
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(`\n验证中断：${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
