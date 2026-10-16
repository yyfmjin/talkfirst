#!/usr/bin/env node
/**
 * 两个**临时聊天账号**：给真机 / 模拟器验证用（能登录、能互发消息的普通账号）。
 *
 * ```bash
 * # 必须显式声明「我知道这是哪个库」
 * ALLOW_SEED_CHAT_ACCOUNTS=1 node --env-file=.env scripts/seed-chat-test-accounts.cjs
 * ```
 *
 * ## 为什么要它
 *
 * 端到端验证实时消息需要两个能登录的账号：一个在手机上（打开会话），一个当
 * 「对方」（脚本发消息）。注册流程要收邮箱验证码，在验证环境里拿不到，所以只能
 * 直接落库 —— 与 `scripts/make-admin.cjs` 同一套路，只是不给人管理员权限。
 *
 * ## 它会改什么
 *
 * 只 upsert 两个固定邮箱（`tfrt-a@example.invalid` / `tfrt-b@example.invalid`）：
 * 密码、`emailVerified`、`status` 会被重置成可登录状态，并把 id 打印出来
 * （后面的验证脚本要用它建会话）。
 *
 * ## 收尾（跑完就删，别留着）
 *
 * 用 psql 清掉这两个邮箱（`DATABASE_URL` 见服务器上的 .env），schema 里 User
 * 的关联（会话/消息/连接请求）是级联删除：
 *
 *     delete from "User" where email like 'tfrt-%';
 *
 * 没有 `ALLOW_SEED_CHAT_ACCOUNTS=1` 时**什么都不做**：这个脚本会给已知邮箱设置已知密码，
 * 误跑到线上就是两个可登录账号，所以默认拒绝执行。
 */

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const PASSWORD = "TfChat2026!";
const ACCOUNTS = [
  { email: "tfrt-a@example.invalid", username: "tfrtchat_a", nickname: "阿明", countryCode: "CN" },
  { email: "tfrt-b@example.invalid", username: "tfrtchat_b", nickname: "Ben", countryCode: "US" },
];

async function main() {
  if (process.env.ALLOW_SEED_CHAT_ACCOUNTS !== "1") {
    console.error(
      "拒绝执行：这是给验证环境用的临时账号脚本。确认目标库后加 ALLOW_SEED_CHAT_ACCOUNTS=1 再跑。",
    );
    process.exit(2);
  }

  const prisma = new PrismaClient();
  const users = [];

  for (const account of ACCOUNTS) {
    const passwordHash = await bcrypt.hash(PASSWORD, 12);
    const user = await prisma.user.upsert({
      where: { email: account.email },
      update: {
        passwordHash,
        emailVerified: true,
        status: "ACTIVE",
        bannedAt: null,
        banReason: null,
      },
      create: {
        email: account.email,
        username: account.username,
        nickname: account.nickname,
        passwordHash,
        emailVerified: true,
        status: "ACTIVE",
        countryCode: account.countryCode,
        birthDate: new Date("1996-01-01"),
        isAdmin: false,
      },
      select: { id: true, email: true, nickname: true },
    });
    users.push(user);
  }

  console.log(JSON.stringify({ password: PASSWORD, users }, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("FAILED", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
