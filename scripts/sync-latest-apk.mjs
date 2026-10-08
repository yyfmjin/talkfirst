#!/usr/bin/env node
/**
 * 把「固定下载入口」指向**最新一次的 Android 成功构建**。
 *
 * ```bash
 * npm run sync:apk              # 默认取 preview（就是那个 APK）
 * npm run sync:apk -- --profile production
 * npm run sync:apk -- --dry-run # 只看会改成什么，不落盘
 * ```
 *
 * ## 它为什么存在
 *
 * EAS 每次构建的产物地址都带一个新哈希，所以「把地址写进页面」等于**每出一版就改一次
 * 代码**：漏一次，官网上挂着的就是上一版 —— 而上一版很可能正是那个装完打不开的包
 * （已经发生过一次）。现在页面只引用 `/download/android`，地址收在这一个文件里，
 * 由本脚本更新。
 *
 * ## 它不做什么
 *
 * 不提交、不部署。原因：改的是线上站点的下载地址，应由人（或代理）看一眼 diff 再发布。
 * 脚本最后会把下一步命令打出来。
 *
 * ## 凭据
 *
 * 用的是**本机已登录的 Expo 凭据**（`npx eas-cli whoami` 能过就行）。它不读、也不打印
 * 任何 token —— 只是把 CLI 当成一个查询工具。
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MOBILE_DIR = join(ROOT, "apps/mobile");
const TARGET = join(ROOT, "apps", "web", "src", "lib", "downloads.ts");

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const profileIndex = argv.indexOf("--profile");
const profile = profileIndex >= 0 ? argv[profileIndex + 1] : "preview";

/** Windows 上 `npx` 是个 .cmd，直接 execFile 找不到 —— 按平台换名字。 */
function npx(args, options) {
  const bin = process.platform === "win32" ? "npx.cmd" : "npx";
  return execFileSync(bin, args, { encoding: "utf8", ...options });
}

console.log(`[sync:apk] 查询 EAS 最近的成功构建（profile=${profile}）…`);
const raw = npx(
  ["--yes", "eas-cli@latest", "build:list", "-p", "android", "--limit", "10", "--json", "--non-interactive"],
  { cwd: MOBILE_DIR, maxBuffer: 64 * 1024 * 1024 },
);

const jsonStart = raw.indexOf("[");
if (jsonStart < 0) {
  console.error("[sync:apk] 读不到构建列表。原始输出（前 400 字）：");
  console.error(raw.slice(0, 400));
  process.exit(1);
}

const builds = JSON.parse(raw.slice(jsonStart));
const latest = builds.find(
  (build) =>
    build.status === "FINISHED" &&
    (build.buildProfile ?? build.profile) === profile &&
    build.artifacts?.buildUrl,
);

if (!latest) {
  console.error(`[sync:apk] 没有 profile=${profile} 的成功构建（列表里共 ${builds.length} 条）。`);
  process.exit(1);
}

const url = latest.artifacts.buildUrl;
const commit = String(latest.gitCommitHash ?? "").slice(0, 7);

const source = readFileSync(TARGET, "utf8");
const updated = source.replace(
  /export const ANDROID_APK_URL =\s*\n?\s*"[^"]*";/,
  `export const ANDROID_APK_URL =\n  "${url}";`,
);

if (updated === source) {
  console.log(`[sync:apk] 已经是这一版了（构建 ${latest.id.slice(0, 8)} / 提交 ${commit}），无需改动。`);
  console.log(`[sync:apk] 地址：${url}`);
  process.exit(0);
}

console.log(`[sync:apk] 构建 ${latest.id.slice(0, 8)}（提交 ${commit}）`);
console.log(`[sync:apk] 新地址：${url}`);

if (dryRun) {
  console.log("[sync:apk] --dry-run：没有写入文件。");
  process.exit(0);
}

writeFileSync(TARGET, updated);
console.log(`[sync:apk] 已写入 ${TARGET.replace(ROOT + "/", "").replace(/\\/g, "/")}`);
console.log("[sync:apk] 下一步：git add -A && git commit，然后在服务器上跑 scripts/deploy-pull.sh");
console.log("[sync:apk]         （/download/android 是静态路由，必须重新构建才生效）");
