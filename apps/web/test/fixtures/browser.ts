import { expect, type Locator, type Page } from "@playwright/test";
import { PASSWORD } from "./profile";

/**
 * Shared browser helpers for the member profile suite.
 *
 * Kept in `test/fixtures/` rather than `test/e2e/` so Playwright does not treat
 * this file as a spec.
 *
 * Login goes through the real form on `/login` rather than injecting cookies:
 * the profile screens depend on the session the app itself establishes, so a
 * hand-built cookie jar would prove less than it appears to.
 */

export async function submitLogin(page: Page, email: string) {
  await page.goto("/login");
  // The label is 「邮箱或用户名」 and the match is EXACT: the page also renders
  // "Google 快捷登录", so a substring match would have to guess. This helper is the
  // sign-in path for nearly every authenticated spec, and it was renamed together
  // with the field when the form started accepting an account name (P0-02).
  await page.getByLabel("邮箱或用户名").fill(email);
  await page.getByLabel("密码").fill(PASSWORD);
  // "exact" matters: the page also renders "Google 登录" / "Apple 登录"
  // placeholders, which a substring match would also resolve to.
  await page.getByRole("button", { name: "登录", exact: true }).click();
}

export async function loginAndLand(page: Page, email: string) {
  await submitLogin(page, email);
  await expect(page.getByRole("heading", { name: "发现" })).toBeVisible({ timeout: 20_000 });
}

/** The one shared profile card (`data-testid="profile-preview-card"`). */
export function profileCard(page: Page): Locator {
  return page.getByTestId("profile-preview-card");
}

/** Opens `/me/edit` and waits for the server-side prefill to land. */
export async function openProfileEditor(page: Page, nickname: string) {
  await page.goto("/me/edit");
  await expect(page.getByLabel("昵称")).toHaveValue(nickname, { timeout: 20_000 });
}

export async function openAttributesPage(page: Page) {
  await page.goto("/me/attributes");
  await expect(page.getByTestId("attribute-count-ABOUT_ME")).toBeVisible({ timeout: 20_000 });
}

export async function openVisibilityPage(page: Page) {
  await page.goto("/me/visibility");
  await expect(page.getByTestId("visibility-row-bio")).toBeVisible({ timeout: 20_000 });
}
