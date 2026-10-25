#!/usr/bin/env node
/**
 * 猜猜看的邀请推送（2026-10-25 邀请制）。
 *
 * 为什么改邀请制：拿真人照片让别人猜「从哪来」，真正要紧的是**本人同意**，
 * 而不是自动识别他是不是真人。所以默认不参与，我们挑一批合适的用户发邀请，
 * 接受之后才进题库。
 *
 * 「合适」的判据（与 GuessService 的出题资格一致，少一条都会让池子里混进
 * 玩家根本看不到的人）：
 *   头像存在、且对陌生人公开可见 · 国家公开可见 · 资料完整（昵称 + 生日）
 *   头像 ≥ 400×400 · 账号 ACTIVE · 未被举报出池 · 从未被邀请过
 *
 * 用法：
 *   node --env-file=.env scripts/invite-guess.mjs --dry-run        # 只看会邀请谁
 *   node --env-file=.env scripts/invite-guess.mjs --limit 50        # 真发
 *
 * 幂等：只挑 `guessInvitedAt` 为空的人，重复执行不会重复打扰。
 */
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const dryRun = args.includes("--dry-run");
const limit = Number(readArg("limit", "50"));

const prisma = new PrismaClient();

const candidates = await prisma.user.findMany({
  where: {
    guessInvitedAt: null,
    status: "ACTIVE",
    avatarUrl: { not: null },
    countryCode: { not: null },
    avatarWidth: { gte: 400 },
    avatarHeight: { gte: 400 },
    avatarGuessExcluded: false,
    nickname: { not: null },
    birthDate: { not: null },
    // 自己已经玩过的人也算合适，反正是让他们当题目 —— 不需要额外条件。
  },
  select: { id: true, nickname: true, countryCode: true, locale: true },
  take: limit,
  orderBy: { createdAt: "asc" },
});

const text = (locale) =>
  (locale ?? "zh").startsWith("en")
    ? {
        title: "You're invited to Guess Where",
        body: "We'd like to feature your photo in the Guess game. Accept to join — you can leave anytime in settings.",
      }
    : {
        title: "邀请你参加「猜猜看」",
        body: "我们想把你选进猜猜看的题目池：别人看你的头像猜你从哪来。接受后才生效，随时可以在设置里退出。",
      };

console.log(`候选 ${candidates.length} 人（上限 ${limit}）${dryRun ? "，dry-run 不发" : ""}`);

let invited = 0;
for (const user of candidates) {
  if (dryRun) {
    console.log(`  会邀请 ${user.nickname ?? user.id}（${user.countryCode}）`);
    continue;
  }
  const copy = text(user.locale);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { guessInvitedAt: new Date() } }),
    prisma.notification.create({
      data: {
        userId: user.id,
        type: "GUESS_INVITE",
        title: copy.title,
        body: copy.body,
        data: JSON.stringify({ screen: "guess-invite" }),
      },
    }),
  ]);
  invited += 1;
}

if (!dryRun) {
  const pool = await prisma.user.count({ where: { guessOptIn: true, avatarGuessExcluded: false } });
  console.log(`已邀请 ${invited} 人；当前已接受（题库）${pool} 人`);
}

await prisma.$disconnect();
