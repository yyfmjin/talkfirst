#!/usr/bin/env node
/**
 * 回填历史头像的宽高（2026-10-25）。
 *
 * 为什么需要：猜猜看的资格要求头像 ≥ 400×400，而这个字段是这次才加的。
 * 不回填的话，所有历史头像都是「尺寸未知」→ 全都不合格 → 题库是空的。
 *
 * 只读本地磁盘上的头像文件，读不到（外部 URL、文件已删）就跳过并把原因记下来，
 * 不改任何别的东西。可重复执行：只处理 avatarWidth 为空的行。
 *
 * 用法（服务器上，API 已 build 过）：
 *   cd /home/ubuntu/talkfirst
 *   node --env-file=.env scripts/backfill-avatar-size.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

// 复用 API 编译产物里的解析器，避免两份实现走偏。
const { readImageSize } = await import("../apps/api/dist/uploads/image-size.js");

const uploadRoot =
  process.env.UPLOAD_DIR?.trim() || join(process.cwd(), ".local-data", "uploads");

const prisma = new PrismaClient();

const users = await prisma.user.findMany({
  where: { avatarUrl: { not: null }, avatarWidth: null },
  select: { id: true, avatarUrl: true },
});

let filled = 0;
const skipped = [];

for (const user of users) {
  const match = /\/uploads\/(.+)$/.exec(user.avatarUrl ?? "");
  if (!match) {
    skipped.push([user.id, "外部 URL"]);
    continue;
  }
  try {
    const size = readImageSize(readFileSync(join(uploadRoot, match[1])));
    if (!size) {
      skipped.push([user.id, "无法识别格式"]);
      continue;
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { avatarWidth: size.width, avatarHeight: size.height },
    });
    filled += 1;
  } catch (error) {
    skipped.push([user.id, error instanceof Error ? error.message : String(error)]);
  }
}

const over400 = await prisma.user.count({
  where: { avatarWidth: { gte: 400 }, avatarHeight: { gte: 400 }, guessOptOut: false, avatarGuessExcluded: false },
});

console.log(`扫描 ${users.length} 个头像，回填 ${filled}，跳过 ${skipped.length}`);
for (const [id, reason] of skipped.slice(0, 10)) console.log(`  跳过 ${id}: ${reason}`);
console.log(`猜猜看题库（尺寸达标 + 未退出）: ${over400} 人`);

await prisma.$disconnect();
