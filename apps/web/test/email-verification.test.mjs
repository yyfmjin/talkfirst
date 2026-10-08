import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

/**
 * SEC-005 — the web side of e-mail verification enforcement.
 *
 * The member app has no runtime test harness (the API is the source of truth),
 * so these are source-level guards: they pin the contract that the login screen
 * reacts to `EMAIL_NOT_VERIFIED` with the right next steps, and — most
 * importantly — that no client code ever asserts `emailVerified` on its own.
 * Verification state belongs to the server.
 */
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "src");

function read(...segments) {
  return readFileSync(join(src, ...segments), "utf8");
}

test("login screen reacts to EMAIL_NOT_VERIFIED with verification next steps", () => {
  const source = read("app", "login", "page.tsx");
  /**
   * 这几条中文文案在 2026-10-08 双语化时搬进了词典（`src/lib/i18n/dictionary.ts`）。
   * 所以断言分两半：**页面**必须引用这几个键（引用了就不会退回硬编码中文、
   * 也不会在英文页面上出中文），**词典**必须给出中文原句（保住这条用例原本守的
   * 东西：成员界面是中文）。
   */
  const dictionary = read("lib", "i18n", "dictionary.ts");

  assert.match(source, /EMAIL_NOT_VERIFIED/, "must branch on the API error code");
  assert.match(source, /t\("auth\.errorEmailNotVerified"\)/, "must explain the state");
  assert.match(dictionary, /邮箱尚未验证/, "must explain the state in Chinese");
  assert.match(source, /t\("auth\.resendVerification"\)/, "must offer to resend the code");
  assert.match(dictionary, /重新发送验证邮件/, "must offer to resend the code in Chinese");
  assert.match(source, /t\("auth\.recheckVerification"\)/, "must offer to re-check verification");
  assert.match(dictionary, /我已完成验证，重新检查/, "must offer to re-check in Chinese");
  assert.match(source, /"\/auth\/send-verification-code"/, "resend hits the real endpoint");
  assert.match(source, /"\/users\/me"/, "re-check reads the caller's own profile");
  // The API client call the smoke test also pins must not regress.
  assert.match(source, /apiFetch<SessionUser>\("\/auth\/login"/);
});

test("login screen does not leak internal detail on failure", () => {
  const source = read("app", "login", "page.tsx");
  assert.doesNotMatch(source, /P2025|Prisma|SMTP|SecurityEvent/);
});

test("onboarding never asserts emailVerified from the client", () => {
  const source = read("app", "onboarding", "social", "page.tsx");
  assert.doesNotMatch(
    source,
    /emailVerified\s*:\s*true/,
    "verification state must come from the server, never the client",
  );
});

test("verify screen keeps the code-entry flow and reads no client-set flag", () => {
  const source = read("app", "verify", "page.tsx");
  assert.match(source, /"\/auth\/send-verification-code"/);
  assert.match(source, /"\/auth\/verify-email"/);
  assert.match(source, /"\/users\/me"/, "re-reads the profile after verifying");
  assert.match(source, /验证码/, "member-facing copy stays Chinese");
  assert.doesNotMatch(source, /emailVerified\s*:\s*true/);
});
