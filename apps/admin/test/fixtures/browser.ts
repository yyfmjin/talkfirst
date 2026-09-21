import { expect, type Page } from "@playwright/test";
import { PASSWORD } from "./admin-roles";

/**
 * Shared browser helpers for the admin console suites.
 *
 * Kept in `test/fixtures/` rather than `test/e2e/` so Playwright does not treat
 * this file as a spec. Both `admin-rbac.spec.ts` and `admin-user-detail.spec.ts`
 * drive the same login form, and a second copy of it would silently rot the day
 * the form changes.
 */

export async function submitLogin(page: Page, email: string) {
  await page.goto("/login");
  await page.locator('input[autocomplete="username"]').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "进入后台" }).click();
}

/**
 * Lands on the dashboard after signing in.
 *
 * ## Rate limiting: raised at the source, not papered over in the test
 *
 * The API limits requests per IP per minute and defaults to 120 in code. The
 * suites drive dozens of logins (two API calls each) plus per-screen fetches
 * from a single address, which exceeds that sustained — so `.env` sets
 * `THROTTLE_LIMIT` (`throttleLimit()` in `app.module.ts`; the production default
 * is unchanged when the variable is absent).
 *
 * Two earlier attempts to handle this in the test helper were both wrong and
 * were reverted:
 *
 *   1. **Retrying on a 429.** A short backoff cannot refill a bucket that is
 *      being drained continuously, and the retry relabelled a configuration
 *      problem as "flaky", hiding it.
 *   2. **Detecting a 429 to fail with a nicer message.** Written when a login
 *      genuinely was throttled; by the time it shipped the cause had moved on,
 *      and because it matched on page *text* it began firing whenever the
 *      dashboard simply had not appeared yet — reporting a rate limit that was
 *      never returned.
 *
 * The lesson recorded here: assert the thing you actually mean. This waits for
 * the dashboard heading. If that does not appear, the failure is reported as
 * exactly that, with Playwright's own trace showing the real page state —
 * instead of a bespoke message that guesses at a cause.
 */
export async function loginAndLand(page: Page, email: string) {
  await submitLogin(page, email);
  await expect(page.getByRole("heading", { name: "仪表盘" })).toBeVisible({ timeout: 20_000 });
}

export async function openNav(page: Page, label: string) {
  await page.getByRole("link", { name: label, exact: true }).click();
}

/** Opens `/users`, searches for `keyword`, and clicks through to the detail screen. */
export async function openUserDetail(page: Page, keyword: string) {
  await openNav(page, "用户");
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
  await page.getByPlaceholder("搜索邮箱 / 昵称 / 用户 ID").fill(keyword);
  await page.getByRole("button", { name: "搜索" }).click();
  await page.locator("main a[href^='/users/']").first().click();
  await expect(page).toHaveURL(/\/users\/[0-9a-f-]{36}$/);
}
