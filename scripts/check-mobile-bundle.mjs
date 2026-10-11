#!/usr/bin/env node
/**
 * App bundle 体检 —— 把「类型检查全绿、真机才炸」的那几类问题在**出包前**查出来。
 *
 * ## 为什么是这几项
 *
 * 2026-10-08 ~ 10-10 连着三次线上事故，都属于同一个类别：`tsc` 与单测全过，打出来的包
 * 在真机上却打不开／白屏。问题都出在 **bundle 内容** 上，而不是源码上：
 *
 *   ① **bundle 里混进两份 React**（仓库根 19.3.0 抢进了 App，App 自己是 18.3.1）
 *      → `react` 解析成 null（`Cannot read property 'useState' of null`）、
 *        `Ionicons` 是 undefined（`Element type is invalid` / 读 `.font` 抛错）→ 打开空白；
 *   ② **图标字体没打进包** → 图标画不出来（按钮只有一个空底色）。
 *
 * 这个脚本 30 秒跑完，不需要真机、不需要 40 分钟云端构建 —— 上面两类都在它的射程内。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/check-mobile-bundle.mjs      # 退出码 0 = 通过
 * ```
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MOBILE = join(ROOT, "apps", "mobile");
const isWindows = process.platform === "win32";
const npx = isWindows ? "npx.cmd" : "npx";

const outDir = mkdtempSync(join(tmpdir(), "talkfirst-bundle-"));
const failures = [];
const log = (message) => console.log(`[bundle-check] ${message}`);

log("打包（--no-bytecode，几秒到一分钟）…");
try {
  execFileSync(
    npx,
    ["--yes", "expo", "export", "--platform", "android", "--no-bytecode", "--output-dir", outDir],
    { cwd: MOBILE, stdio: "pipe", shell: isWindows, maxBuffer: 64 * 1024 * 1024 },
  );
} catch (error) {
  console.error("[bundle-check] 打包失败：");
  console.error(String(error.stdout ?? error.message).slice(-2000));
  rmSync(outDir, { recursive: true, force: true });
  process.exit(1);
}

const jsDir = join(outDir, "_expo", "static", "js", "android");
const bundleName = existsSync(jsDir) ? readdirSync(jsDir).find((name) => name.endsWith(".js")) : undefined;
const bundlePath = bundleName ? join(jsDir, bundleName) : "";
if (!bundlePath || !existsSync(bundlePath)) {
  console.error("[bundle-check] 找不到打包产物");
  rmSync(outDir, { recursive: true, force: true });
  process.exit(1);
}

const bundle = readFileSync(bundlePath, "utf8");
log(`bundle：${(bundle.length / 1024 / 1024).toFixed(2)}MB`);

// ① 只允许一份 React。React 会把自身版本号写进产物，直接看出现了哪些版本即可。
const versions = [...new Set(bundle.match(/\b(1[6-9]\.\d{1,2}\.\d{1,2})\b/g) ?? [])].sort();
log(`bundle 里出现的版本号：${versions.join(", ") || "(无)"}`);
const wrongReact = versions.filter((v) => v.startsWith("19."));
if (wrongReact.length > 0) {
  failures.push(
    `bundle 里出现了 React ${wrongReact.join(", ")}（应为 18.3.x）—— Metro 把仓库根那一份 React 也打进来了。` +
      `修法见 apps/mobile/metro.config.js 的 disableHierarchicalLookup + extraNodeModules。`,
  );
}

// ② 图标字体是否在包里。@expo/vector-icons 靠自带字体渲染，字体不在包里时不报错、只是画不出来。
const hasIconFont = /Ionicons\.ttf|ionicons/i.test(bundle);
log(`图标字体引用：${hasIconFont ? "在" : "不在"}`);
if (!hasIconFont) {
  failures.push(
    "bundle 里找不到 Ionicons 字体引用 —— 图标会画不出来（有底色没图形）。" +
      "组件层已由 components/Icon.tsx 兜底成「不画」，所以应用不会崩，但图标是缺的。",
  );
}

rmSync(outDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error("\n[bundle-check] ✗ 发现问题：");
  for (const item of failures) console.error(`  - ${item}`);
  process.exit(1);
}

console.log("\n[bundle-check] ✓ 通过：单份 React（18.3.x）、图标字体就位。");
