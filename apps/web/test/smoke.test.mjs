import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("welcome screen renders TalkFirst branding", () => {
  const source = readFileSync(join(root, "src/app/page.tsx"), "utf8");
  assert.match(source, /Wordmark/);
  assert.match(source, /18\+ only/);
  const brand = readFileSync(join(root, "src/components/brand.tsx"), "utf8");
  assert.match(brand, /TalkFirst/);
  assert.match(brand, /先聊聊，再成为朋友/);
});

test("login screen offers email sign-in", () => {
  const source = readFileSync(join(root, "src/app/login/page.tsx"), "utf8");
  assert.match(source, /欢迎回来/);
  assert.match(source, /邮箱/);
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
  assert.match(compose, /apiFetch\("\/moments"/);
  const settings = readFileSync(join(root, "src/app/moments/settings/page.tsx"), "utf8");
  assert.match(settings, /\/moments\/bindings/);
  const detail = readFileSync(join(root, "src/app/moments/user/[id]/page.tsx"), "utf8");
  assert.match(detail, /\/moments\/user\//);
  const tabbar = readFileSync(join(root, "src/components/tab-bar.tsx"), "utf8");
  assert.match(tabbar, /\/moments/);
});
