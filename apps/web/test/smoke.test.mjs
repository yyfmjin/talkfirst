import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("home page is the official site and keeps the product promise", () => {
  const source = readFileSync(join(root, "src/app/page.tsx"), "utf8");
  const site = readFileSync(join(root, "src/marketing/official-site.tsx"), "utf8");
  const dictionary = readFileSync(join(root, "src/lib/i18n/dictionary.ts"), "utf8");

  /**
   * 2026-10-08：首页从「启动屏」改成**官网**（运营方要求：一打开就是介绍 + 下载 + 登录），
   * 启动屏组件已删除。页面本体在 `src/marketing/official-site.tsx`（中英文共用一份），
   * 文案在词典 —— 所以断言跟到它们现在真正在的文件，而不是把旧字串留在原处。
   */
  assert.match(source, /OfficialSite/);
  assert.match(site, /LogoMark/);
  assert.match(site, /ANDROID_APK_PATH/, "下载按钮必须走固定入口，而不是把某一次构建的地址写死");
  assert.match(dictionary, /先聊聊/, "产品那句话还在");
  assert.match(dictionary, /再成为朋友/);
  assert.match(dictionary, /仅限 18 岁以上使用/, "年龄声明还在（注册页渲染它）");
  assert.match(source, /localePath/, "中英文首页要互相声明 hreflang");

  // 首页必须仍是 Server Component：它是少数几个首屏就是真 HTML 的路由之一，
  // 也是整个站唯一真正会被搜索引擎收录的页面。
  //
  // 按**指令**匹配（独占一行、带引号），而不是裸子串 `"use client"` ——
  // 后者会命中「解释为什么这里不是客户端组件」的注释，等于因为写清楚规则而挂掉。
  assert.doesNotMatch(source, /^\s*["']use client["']\s*;?\s*$/m, "home must stay a Server Component");
  assert.doesNotMatch(site, /^\s*["']use client["']\s*;?\s*$/m, "shared site body must stay a Server Component");

  const brand = readFileSync(join(root, "src/components/brand.tsx"), "utf8");
  assert.match(brand, /TalkFirst/);
  assert.match(brand, /Talk First\. Connect Later\./);
});

test("login screen offers email sign-in", () => {
  const source = readFileSync(join(root, "src/app/login/page.tsx"), "utf8");
  /**
   * 文案在 2026-10-08 双语化时搬进了词典（`src/lib/i18n/dictionary.ts`）。
   * 断言因此分两半，合起来守的还是原来那件事：**登录页用邮箱登录，且成员界面的
   * 中文文案还在**。只断言词典会漏掉「页面不再引用它」；只断言页面则管不住文案本身。
   */
  const dictionary = readFileSync(join(root, "src/lib/i18n/dictionary.ts"), "utf8");
  assert.match(source, /t\("auth\.welcomeBack"\)/);
  assert.match(source, /t\("auth\.identifierLabel"\)/);
  assert.match(dictionary, /欢迎回来/);
  assert.match(dictionary, /邮箱/);
});

test("auth screens call the real API client", () => {
  const login = readFileSync(join(root, "src/app/login/page.tsx"), "utf8");
  const register = readFileSync(join(root, "src/app/register/page.tsx"), "utf8");
  assert.match(login, /apiFetch<SessionUser>\("\/auth\/login"/);
  assert.match(register, /apiFetch<SessionUser>\("\/auth\/register"/);
});

test("onboarding screens persist via users endpoints", () => {
  const interests = readFileSync(join(root, "src/app/onboarding/interests/page.tsx"), "utf8");
  assert.match(interests, /"\/users\/me\/interests"/);
});

test("moments module covers feed, publish, detail and settings", () => {
  const feed = readFileSync(join(root, "src/app/moments/page.tsx"), "utf8");
  assert.match(feed, /\/moments\/feed\?tab=/);
  assert.match(feed, /\/moments\/compose/);
  assert.match(feed, /\/moments\/settings/);
  const compose = readFileSync(join(root, "src/app/moments/compose/page.tsx"), "utf8");
  // An explicit type argument is allowed, and is now used: the composer reads the
  // review status off the response so it can tell the author a pending post is
  // queued instead of navigating to an empty feed. What is pinned is that the
  // composer publishes through the shared client and not a bare `fetch`.
  assert.match(compose, /apiFetch(?:<[^>]*>)?\("\/moments"/);
  const settings = readFileSync(join(root, "src/app/moments/settings/page.tsx"), "utf8");
  assert.match(settings, /\/moments\/bindings/);
  const detail = readFileSync(join(root, "src/app/moments/user/[id]/page.tsx"), "utf8");
  assert.match(detail, /\/moments\/user\//);
  const tabbar = readFileSync(join(root, "src/components/tab-bar.tsx"), "utf8");
  assert.match(tabbar, /\/moments/);
});
