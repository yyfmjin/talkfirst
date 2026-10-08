#!/usr/bin/env node
/**
 * 一键 OTA：把当前 JS 发到 `preview` 分支，已装 App 下次启动自动生效。
 *
 * ```bash
 * npm run ota               # 用最近的 git 提交标题当说明
 * npm run ota -- "改了什么"  # 自定义说明
 * ```
 *
 * ## 它解决什么
 *
 * 在接 `expo-updates` 之前，每改一行 JS 都要走一遍：出包（约 40 分钟）→ 你来下载 →
 * 卸载/覆盖安装。功能/文案/UI 这类改动根本不该这么贵。
 *
 * ## 它**不能**做什么（重要）
 *
 * 只发 JS。**原生依赖的改动发不了**：加 `expo-video` 这种新原生模块、改权限、
 * 改图标/启动图、升 SDK —— 这些必须重新出包（`eas build`）并安装一次。
 *
 * 判断标准很简单：`package.json` 的 dependencies 变了、或 `app.json` 的原生配置
 * （图标、权限、插件、version）变了 → 出包；只改了 `src/` 和文案 → 走 OTA。
 *
 * ## 版本边界
 *
 * `app.json` 用的是 `runtimeVersion: { policy: "appVersion" }`：OTA 只发给**同一个
 * app version**（现在是 0.1.2）的安装。所以迭代期间不要随手改 `version` ——
 * 一改，老安装就收不到这个更新了（这是故意的安全边界：原生不匹配的 JS 绝不能发下去）。
 *
 * 回滚：`npx eas-cli update:rollback --branch preview`（或 `update:list` 挑一个）。
 */

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MOBILE_DIR = join(ROOT, "apps", "mobile");

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const message = args.join(" ").trim() || latestCommitSubject();

function latestCommitSubject() {
  try {
    return execFileSync("git", ["log", "-1", "--pretty=%s"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "OTA update";
  }
}

/*
 * Windows 上 `npx` 是 `.cmd`，而 Node 从 18.20 / 20.12 起不允许没有 `shell: true`
 * 就启动 `.cmd` / `.bat`（CVE-2024-27980 的修复）—— 这里和 `scripts/sync-latest-apk.mjs`
 * 踩的是同一个坑，所以同样要开 shell。
 */
const isWindows = process.platform === "win32";
const npx = isWindows ? "npx.cmd" : "npx";

console.log(`[ota] 发布分支 preview，说明：${message}`);
execFileSync(npx, ["--yes", "eas-cli@latest", "update", "--branch", "preview", "--message", message], {
  cwd: MOBILE_DIR,
  stdio: "inherit",
  shell: isWindows,
});
console.log("[ota] 完成。手机上的 App 下次启动会自动拉取（设置里是 ON_LOAD）。");
