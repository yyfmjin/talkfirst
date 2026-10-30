#!/usr/bin/env node
/**
 * 发布前校验：这个 APK 到底能不能**自己热更新**。
 *
 * ```bash
 * node scripts/verify-apk.mjs /d/Android/talkfirst-local.apk
 * ```
 *
 * ## 它为什么存在（2026-10-30 的事故）
 *
 * 线上那个包（10-27 打的 37MB APK）里没有
 * `expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY` 这条 meta-data。
 * 后果不是「更新慢一点」，而是**一条都收不到**：
 *
 *   - `expo-updates` 把渠道当请求头发（`expo-channel-name`），只从 manifest 的
 *     meta-data 读；缺了它，请求不带这个头；
 *   - `u.expo.dev` 对不带渠道的请求一律 **400**；
 *   - 客户端把异常统一显示成「检查更新失败，请检查网络」——于是所有人（包括我们）
 *     都在查网络，而真因是包里少了一行 XML。
 *
 * 更糟的是：修这个问题的代码本身要靠 OTA 下发，形成死锁 —— 唯一的出口是重新出包。
 * 所以这条校验必须发生在**发布之前**，而不是用户报障之后。
 *
 * ## 为什么不用 `strings`
 *
 * AndroidManifest.xml 是二进制 XML，字符串以 UTF-16LE 存放。Git for Windows 不自带
 * `strings`，而 `unzip` 有 —— 所以这里用 `unzip -p` 取字节，用 Node 自己解码，
 * 跨平台都能跑。
 */

import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

const CHANNEL_KEY = "UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY";
const CHANNELS = ["preview", "production"];

const apkPath = process.argv[2];
if (!apkPath) {
  console.error("用法: node scripts/verify-apk.mjs <path-to.apk>");
  process.exit(2);
}
if (!existsSync(apkPath)) {
  console.error(`✗ 找不到 APK: ${apkPath}`);
  process.exit(2);
}

let manifest;
try {
  manifest = execFileSync("unzip", ["-p", apkPath, "AndroidManifest.xml"], {
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (error) {
  console.error("✗ 读不出 AndroidManifest.xml（unzip 不可用，或这不是一个 APK）");
  console.error(String(error.stderr ?? error.message).slice(0, 300));
  process.exit(2);
}

/* 二进制 XML 的字符串是 UTF-16LE；也顺带在 latin1 视图里找一遍，避免编码边界漏判。 */
const utf16 = manifest.toString("utf16le");
const latin1 = manifest.toString("latin1");
const has = (needle) => utf16.includes(needle) || latin1.includes(needle);

const sizeMb = (statSync(apkPath).size / 1024 / 1024).toFixed(1);
const channel = CHANNELS.find((name) => has(`expo-channel-name`) && utf16.includes(`"${name}"`));

if (!has(CHANNEL_KEY)) {
  console.error(`✗ 这个包收不到任何 OTA：manifest 里缺 ${CHANNEL_KEY}`);
  console.error("  现象：应用内「检查更新」永远报网络失败；线上改动永远到不了手机。");
  console.error("  处理：用 scripts/build-apk-locally.sh 重新出包（它会注入渠道），别再发这个包。");
  process.exit(1);
}
if (!channel) {
  console.error("✗ 有渠道键，但值不是 preview / production —— 服务端会拒绝这次更新请求。");
  process.exit(1);
}

console.log(`✓ 更新通道已烧进 manifest：expo-channel-name=${channel}`);
console.log(`✓ APK 大小 ${sizeMb} MB，可以发布。`);
