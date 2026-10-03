import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("welcome screen renders TalkFirst branding", () => {
  const source = readFileSync(join(root, "src/app/page.tsx"), "utf8");
  assert.match(source, /Wordmark/);
  assert.match(source, /仅限 18 岁以上使用/);
  // Phase B: the launch screen owns the product promise as its own <h1>. The
  // brand lockup below it is decorative, so the sentence moved out of
  // `brand.tsx` and into the page — the assertion follows the design change
  // rather than forcing the page to keep a heading-shaped logo caption.
  assert.match(source, /先聊聊/);
  assert.match(source, /再成为朋友/);
  // It must remain a Server Component: this is one of the few routes whose content
  // is in the first byte of HTML, which is what makes it indexable at all.
  //
  // Matched as a DIRECTIVE (own line, quoted, no leading prose) rather than as the
  // bare substring `"use client"`. The bare form also matches a comment that
  // explains why the route is not a client component — i.e. it would fail the test
  // for documenting the very rule the test enforces. `apps/admin/test/smoke.test.mjs`
  // already matches call positions for exactly this reason; this brings the web
  // suite in line with it.
  assert.doesNotMatch(source, /^\s*["']use client["']\s*;?\s*$/m, "must stay a Server Component");
  const brand = readFileSync(join(root, "src/components/brand.tsx"), "utf8");
  assert.match(brand, /TalkFirst/);
  assert.match(brand, /Talk First\. Connect Later\./);
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
