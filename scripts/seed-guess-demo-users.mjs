#!/usr/bin/env node
/**
 * 猜猜看的测试用户（2026-10-25）。
 *
 * 为什么需要：全站只有 3 张合格头像，而「同一对 7 天不重复」意味着一个玩家
 * 试两轮就没人可猜了 —— 功能没法验收。
 *
 * 做什么：造 8 个**不能登录**的测试账号（passwordHash 为 null），头像复用现有的
 * 三张合格头像（同一个 URL，不复制文件），国家分散在亚洲/欧洲/美洲/非洲，
 * 这样三选一的干扰项才有意义。
 *
 * 幂等：按 email upsert，重复执行只更新资料，不重复插行。
 *
 * 清理（上架前务必执行，或改成你要的）：
 *   DELETE FROM "User" WHERE email LIKE 'guess-demo-%@talkfirst.ccwu.cc';
 *
 * 用法：
 *   cd /home/ubuntu/talkfirst
 *   node --env-file=.env scripts/seed-guess-demo-users.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** 这三张头像已经通过 ≥400×400 的门槛，直接复用它们的 URL。 */
const sources = await prisma.user.findMany({
  where: { avatarUrl: { not: null }, avatarWidth: { gte: 400 }, avatarHeight: { gte: 400 } },
  select: { avatarUrl: true, avatarWidth: true, avatarHeight: true },
  take: 3,
});

if (sources.length === 0) {
  console.error("没有可复用的合格头像，先跑 scripts/backfill-avatar-size.mjs");
  process.exit(1);
}

const people = [
  { nickname: "Yuki", countryCode: "JP", bio: "东京，喜欢摄影" },
  { nickname: "Jihoon", countryCode: "KR", bio: "首尔，学中文第三年" },
  { nickname: "Ploy", countryCode: "TH", bio: "曼谷，咖啡师" },
  { nickname: "Linh", countryCode: "VN", bio: "河内，爱看老电影" },
  { nickname: "Camille", countryCode: "FR", bio: "里昂，做设计" },
  { nickname: "Rafael", countryCode: "BR", bio: "圣保罗，踢球和吉他" },
  { nickname: "Youssef", countryCode: "EG", bio: "开罗，工程师" },
  { nickname: "Marta", countryCode: "ES", bio: "巴塞罗那，教西语" },
];

let created = 0;

for (const [index, person] of people.entries()) {
  const email = `guess-demo-${index + 1}@talkfirst.ccwu.cc`;
  const source = sources[index % sources.length];
  const data = {
    nickname: person.nickname,
    countryCode: person.countryCode,
    city: null,
    birthDate: new Date("1995-06-15"),
    bio: person.bio,
    avatarUrl: source.avatarUrl,
    avatarWidth: source.avatarWidth,
    avatarHeight: source.avatarHeight,
    emailVerified: true,
    status: "ACTIVE",
    guessOptOut: false,
    avatarGuessExcluded: false,
  };

  await prisma.user.upsert({
    where: { email },
    create: {
      email,
      username: `guessdemo${index + 1}`,
      // 不能登录：没有密码哈希，登录接口会直接拒绝。
      passwordHash: null,
      ...data,
    },
    update: data,
  });
  created += 1;
}

const pool = await prisma.user.count({
  where: {
    avatarUrl: { not: null },
    countryCode: { not: null },
    avatarWidth: { gte: 400 },
    avatarHeight: { gte: 400 },
    guessOptOut: false,
    avatarGuessExcluded: false,
  },
});

console.log(`已写入 ${created} 个测试用户；当前题库 ${pool} 人`);
await prisma.$disconnect();
