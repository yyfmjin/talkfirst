#!/usr/bin/env node
/**
 * 商店截图（Play 要求 ≥2 张手机截图）。
 *
 * ## 怎么跑
 *
 * ```bash
 * # 1) 本地起网页端（接口地址指向一个"假 API"，下面的 route 会全部拦掉）
 * NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1 npm run dev -w @talkfirst/web
 * # 2) 另开一个终端
 * node scripts/play-screenshots.mjs
 * ```
 *
 * ## 为什么这么做
 *
 * 这台构建机驱动不了模拟器（`adb` 启动就把终端挂住），而到生产 API 的网络又经常几十秒
 * 无响应 —— 页面会一直停在「正在加载」，截出来是空页。所以：
 *
 *   1. 页面用**本地**开发服务器渲染（不依赖外网拿 HTML）；
 *   2. `/api/v1/*` 全部被拦截，返回 `docs/play-assets/fixtures.json` —— 那是从**真实接口**
 *      抓下来的演示账号数据（Mia、4 条动态、和 Ben 的会话、AI 朋友小暖）。
 *
 * 画面是真实组件 + 真实数据形状，只是数据固定、可复现。不是画出来的 mockup。
 *
 * ## 想换成严格的手机端截图
 *
 * 在手机上用同一个演示账号（review@talkfirst.ccwu.cc）拍同样的界面，文件命名保持一致，
 * 在 Play 后台直接替换即可。
 */

import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SITE = process.env.SCREENSHOT_SITE ?? "http://localhost:3000";
const API = process.env.SCREENSHOT_API ?? "http://localhost:4000";
const OUT = join(process.cwd(), "docs/play-assets");
mkdirSync(OUT, { recursive: true });

const FIXTURES = JSON.parse(readFileSync(join(OUT, "fixtures.json"), "utf8"));
/** 演示账号的会话与其中的真人会话 id（fixtures 里带）。 */
const HUMAN_CONVERSATION = FIXTURES.__humanId;

function fixtureFor(rawUrl) {
  const url = new URL(rawUrl);
  const path = url.pathname.replace("/api/v1", "");
  const exact = FIXTURES[path + url.search];
  if (exact) return exact;
  const key = Object.keys(FIXTURES).find((k) => k.startsWith("/") && k.split("?")[0] === path);
  return key ? FIXTURES[key] : null;
}

/**
 * 没抓到的接口按**各自的形状**给空值。
 *
 * 形状不对会让页面在 `.map` 上直接崩（第一次跑 `platforms.map is not a function` 就是这么来的），
 * 截图就变成一张 "Application error"。
 */
function emptyBody(path, method) {
  if (path === "/moments/topics") return { items: [] };
  if (path === "/moments/platforms" || path === "/moments/bindings") return [];
  if (path === "/notifications") return { items: [], unread: 0 };
  if (path.startsWith("/moments")) return { items: [], nextCursor: null };
  return method === "GET" ? [] : {};
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  locale: "zh-CN",
  timezoneId: "Asia/Shanghai",
});
const page = await context.newPage();

await context.route(`${API}/**`, async (route) => {
  const request = route.request();
  const url = request.url();
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": SITE,
    "access-control-allow-credentials": "true",
  };
  if (request.method() === "OPTIONS") {
    return route.fulfill({
      status: 204,
      headers: { ...headers, "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE", "access-control-allow-headers": "*" },
    });
  }
  if (url.includes("/api/v1/auth/login")) {
    return route.fulfill({
      status: 200,
      headers,
      body: JSON.stringify({ success: true, accessToken: "screenshot", refreshToken: "screenshot", data: JSON.parse(FIXTURES["/users/me"].body).data }),
    });
  }
  const hit = fixtureFor(url);
  if (hit) return route.fulfill({ status: hit.status, headers, body: hit.body });
  const path = new URL(url).pathname.replace("/api/v1", "");
  return route.fulfill({ status: 200, headers, body: JSON.stringify({ success: true, data: emptyBody(path, request.method()) }) });
});

async function capture(name) {
  const text = (await page.innerText("body")).replace(/\s+/g, " ").slice(0, 300);
  writeFileSync(join(OUT, `${name}.txt`), text, "utf8");
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`✓ ${name}｜${text.slice(0, 70)}`);
}

async function open(path, settle = 3000) {
  await page.goto(`${SITE}${path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(settle);
}

try {
  await open("/login", 2500);
  await capture("screenshot-1-login");

  await open("/moments");
  await capture("screenshot-2-moments");

  await open("/discover");
  await capture("screenshot-3-discover");

  await open("/messages");
  await capture("screenshot-4-messages");

  await open(`/messages/${HUMAN_CONVERSATION}`, 3500);
  await capture("screenshot-5-chat");

  await open("/ai");
  await capture("screenshot-6-ai");

  console.log(`\n完成：${OUT}`);
} catch (error) {
  console.error(`\n失败：${String(error.message).split("\n")[0]}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
