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
 * 在接 `expo-updates` 之前，每改一行 JS 都要走一遍：出包（约 40 分钟）→ 下载 →
 * 覆盖安装。功能/文案/UI 这类改动根本不该这么贵。
 *
 * ## 它**不能**做什么（重要）
 *
 * 只发 JS。**原生依赖的改动发不了**：加 `expo-video` 这种新原生模块、改权限、
 * 改图标/启动图、升 SDK —— 必须重新出包（`eas build`）并安装一次。
 *
 * 判断标准：`package.json` 的 dependencies 变了、或 `app.json` 的原生配置
 * （图标、权限、插件、version）变了 → 出包；只改了 `src/` 和文案 → 走 OTA。
 *
 * ## 版本边界
 *
 * `app.json` 用 `runtimeVersion: { policy: "appVersion" }`：OTA 只发给**同一个 app
 * version**（现在 0.1.2）的安装。迭代期间不要随手改 `version` —— 一改，老安装就
 * 收不到更新（这是故意的安全边界：原生不匹配的 JS 绝不能发下去）。
 *
 * 回滚：`npx eas-cli update:rollback --branch preview`。
 *
 * ## 为什么分两步（不用 `eas update` 的一步到位）
 *
 * 本机项目路径是 `D:\文件\网站\TalkFirst` —— 含中文。Windows 版 `hermesc.exe`
 * 处理不了这个路径：命令行里传中文路径时它以**退出码 6** 失败，报出来的信息只有
 * "Cannot find the hermesc executable"，很容易误判成"没装"（其实文件就在
 * `apps/mobile/node_modules/react-native/sdks/hermesc/win64-bin/`，连 ICU 依赖 DLL 都在）。
 *
 * 绕法：本地只打**不带 Hermes 字节码**的 JS 包（`--no-bytecode`，Hermes 照样能执行），
 * 再用 `eas update --skip-bundler --input-dir` 直接发布这个产物。
 * 服务器和 EAS 构建机上是纯 ASCII 路径（`/home/ubuntu/talkfirst`），不受影响。
 */

import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MOBILE_DIR = join(ROOT, "apps", "mobile");
/** `react-native` 留在移动端自己的 node_modules（版本敏感，没被 hoist 到仓库根）。 */
const MOBILE_NODE_MODULES = join(MOBILE_DIR, "node_modules");
const DIST = join(tmpdir(), "talkfirst-ota-dist");

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
 * 就启动 `.cmd` / `.bat`（CVE-2024-27980 的修复）—— 与 `scripts/sync-latest-apk.mjs`
 * 同一个坑。
 *
 * 但开着 `shell` 时参数会拼成命令行交给 `cmd.exe`，**带空格的值会被拆开**，
 * 所以带空格的参数要自己加引号。
 */
const isWindows = process.platform === "win32";
const npx = isWindows ? "npx.cmd" : "npx";
const quote = (value) => `"${value.replace(/"/g, '\\"')}"`;

/** `NODE_PATH` 补上移动端的 node_modules：打包器从仓库根找 `react-native` 会扑空。 */
const env = {
  ...process.env,
  NODE_PATH: [MOBILE_NODE_MODULES, process.env.NODE_PATH].filter(Boolean).join(";"),
};

console.log(`[ota] 说明：${message}`);

if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });

console.log("[ota] 1/2 打 JS 包（不带 Hermes 字节码，绕开中文路径下 hermesc 退出码 6）…");
const exportOutput = execFileSync(
  npx,
  ["--yes", "expo", "export", "--platform", "android", "--no-bytecode", "--output-dir", quote(DIST)],
  { cwd: MOBILE_DIR, encoding: "utf8", shell: isWindows, maxBuffer: 64 * 1024 * 1024, env },
);
process.stdout.write(exportOutput);

console.log("[ota] 2/2 发布到 preview 分支…");
const updateOutput = execFileSync(
  npx,
  [
    "--yes",
    "eas-cli@latest",
    "update",
    "--branch",
    "preview",
    "--input-dir",
    quote(DIST),
    "--skip-bundler",
    "--message",
    quote(message),
    "--non-interactive",
  ],
  { cwd: MOBILE_DIR, encoding: "utf8", shell: isWindows, maxBuffer: 64 * 1024 * 1024, env },
);
process.stdout.write(updateOutput);

console.log("[ota] 完成。手机上的 App 下次启动会自动拉取（`checkAutomatically: ON_LOAD`）。");
