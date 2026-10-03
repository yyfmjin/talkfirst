import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

/**
 * Google 快捷登录 —— 真实浏览器、真实 API、真实数据库。
 *
 * ## What is real here, and what is not
 *
 * The third party is local: `OAUTH_DEV_PROVIDER=true` makes the API serve a
 * stand-in OIDC provider (see `apps/api/src/auth/oauth/local-dev-provider.ts`).
 * Everything else is production code — the redirect out of our own start route,
 * the flow-state cookie, PKCE, the callback, account creation, and the session.
 *
 * That distinction is the point of the suite. The API-level integration spec
 * (`oauth-flow-http.spec.ts`) already proves the protocol; what only a browser can
 * prove is that the SCREEN offers the flow correctly — that the button is a real
 * navigation, that the session cookie lands and survives a reload, and that a
 * refusal comes back to the login page as readable Chinese.
 *
 * ## Why the button under test is `oauth-local`, not `oauth-google`
 *
 * This environment has **no Google credentials** (`GOOGLE_CLIENT_ID` is empty),
 * so the API correctly reports `["local"]` and the screen correctly offers one
 * button. The provider id is therefore data, not something the test may assume:
 * `GET /auth/oauth/providers` decides what renders, and asserting on a hard-coded
 * `oauth-google` would be testing a deployment this one is not. The first test
 * below pins that contract explicitly.
 *
 * ## Why the assertions are on the database
 *
 * "Signed in" is a claim about server state, not about pixels. A page that
 * re-rendered a stale session would still look right, so the account row and the
 * identity row are read back from PostgreSQL.
 */

/** Same origin the Playwright config boots the API on. */
const API_ORIGIN = "http://localhost:4000";

const prisma = new PrismaClient();

/** The dev provider's first account: a brand-new address, so it creates an account. */
const OAUTH_EMAIL = "local.new@example.test";
/** That account's subject claim, verbatim from `LOCAL_DEV_USERS` in the provider. */
const OAUTH_SUB = "local-new-user";

test.beforeEach(async ({ page }) => {
  /**
   * Clear the browser session as well as the database. `test.beforeEach` runs
   * before `page` is used, and without this the session cookie from the previous
   * test survives into the next one — which made "a refusal leaves no session"
   * fail by looking at a session that belonged to an earlier test rather than to
   * the refusal.
   */
  await page.context().clearCookies();

  // Remove what a previous run left, so each test starts from "never seen".
  const users = await prisma.user.findMany({
    where: { email: { startsWith: "local." } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  if (ids.length > 0) {
    await prisma.oAuthIdentity.deleteMany({ where: { userId: { in: ids } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

/** The enabled provider, as the API reports it. Fetched, never assumed. */
async function enabledProvider(page: Page): Promise<string> {
  const response = await page.request.get(`${API_ORIGIN}/api/v1/auth/oauth/providers`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { data: { providers: string[] } };
  expect(body.data.providers.length).toBeGreaterThan(0);
  return body.data.providers[0]!;
}

/**
 * Let the log in, then wait for the row the callback writes.
 *
 * The redirect is observable in the browser slightly before a SEPARATE database
 * connection is guaranteed to see the committed transaction — the API answers
 * `302` and Playwright resolves `toHaveURL` the moment the navigation lands, while
 * this suite reads through its own pool. Polling removes that race; a single
 * `findUnique` here was flaky for exactly that reason, not because the write was
 * missing.
 */
async function waitForAccount(email: string) {
  await expect
    .poll(async () => (await prisma.user.findUnique({ where: { email } })) !== null, { timeout: 10_000 })
    .toBe(true);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`account ${email} was not created`);
  return user;
}

/** Same idea, for the identity row that `resolve()` writes with the account. */
async function waitForIdentity(userId: string) {
  await expect
    .poll(
      async () => (await prisma.oAuthIdentity.findMany({ where: { userId } })).length,
      { timeout: 10_000 },
    )
    .toBe(1);
  const rows = await prisma.oAuthIdentity.findMany({ where: { userId } });
  return rows[0]!;
}

/** The consent step: click the dev provider's own "agree" button. */
async function consent(page: Page) {
  const submit = page.getByTestId("local-authorize-submit");
  await expect(submit).toBeVisible({ timeout: 20_000 });
  await submit.click();
}

test("登录页只提供 API 声明的 provider，且入口是指向本站 start 路由的真实链接", async ({ page }) => {
  const provider = await enabledProvider(page);

  await page.goto("/login");
  const button = page.getByTestId(`oauth-${provider}`);
  await expect(button).toBeVisible({ timeout: 20_000 });

  /**
   * A LINK, not a button with a handler: the authorization-code flow is a browser
   * navigation to the provider, which `fetch` cannot perform. Asserting the href
   * rather than only clicking is what catches a regression to a JS-only control.
   */
  const href = await button.getAttribute("href");
  expect(href).toContain(`${API_ORIGIN}/api/v1/auth/oauth/${provider}/start`);

  // The old placeholder claimed the feature was unavailable; nothing may say that
  // now that it works.
  await expect(page.getByText("第三方登录即将上线")).toHaveCount(0);
  await expect(page.getByText("即将上线，暂用邮箱登录")).toHaveCount(0);
});

test("没有配置的 provider 不渲染按钮（列表来自 API，不是写死的）", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('[data-testid^="oauth-"]').first()).toBeVisible({ timeout: 20_000 });

  /**
   * This deployment has no Google credentials, so a `google` button must NOT be
   * rendered — a live-looking control that leads to `OAUTH_PROVIDER_DISABLED` is
   * exactly what the previous 「即将上线」 placeholder was replaced to avoid.
   */
  await expect(page.getByTestId("oauth-google")).toHaveCount(0);
  // Apple sign-in was dropped entirely; it must not reappear.
  await expect(page.getByTestId("oauth-apple")).toHaveCount(0);
});

test("点击登录入口：真实跳转 -> 同意 -> 回调建号 -> 会话生效并能在刷新后保持", async ({ page }) => {
  const provider = await enabledProvider(page);

  await page.goto("/login");
  await page.getByTestId(`oauth-${provider}`).click();

  // We left our own origin for the provider's consent screen.
  await expect(page.getByTestId("local-authorize-submit")).toBeVisible({ timeout: 20_000 });
  const consentUrl = new URL(page.url());
  expect(consentUrl.pathname).toBe("/api/v1/auth/oauth/local/authorize");
  // The provider page must have received our PKCE challenge, state and nonce.
  expect(consentUrl.searchParams.get("code_challenge")).toBeTruthy();
  expect(consentUrl.searchParams.get("state")).toBeTruthy();
  expect(consentUrl.searchParams.get("nonce")).toBeTruthy();
  // …and it must say what it is.
  await expect(page.getByText("这不是 Google")).toBeVisible();

  await consent(page);

  // Back in the app, at the destination the start link asked for.
  await expect(page).toHaveURL(/\/discover/, { timeout: 20_000 });

  // A real account row, with no password.
  const created = await waitForAccount(OAUTH_EMAIL);
  expect(created.passwordHash).toBeNull();
  // Google already proved the address, so enforcement cannot lock them out.
  expect(created.emailVerified).toBe(true);

  const identity = await waitForIdentity(created.id);
  expect(identity.provider).toBe("GOOGLE");
  // The stable key is the provider's subject, not the e-mail.
  expect(identity.providerUserId).toBe(OAUTH_SUB);
  expect(identity.email).toBe(OAUTH_EMAIL);

  // The session survives a reload — that is what proves a cookie was set rather
  // than a value living in React state. `/discover` is the landmark the rest of
  // the suite uses for "signed in", so this stays consistent with it.
  await page.reload();
  await page.goto("/discover");
  await expect(page.getByRole("heading", { name: "发现" })).toBeVisible({ timeout: 20_000 });
});

test("第二次用同一个第三方账号登录：不重复建号", async ({ page }) => {
  const provider = await enabledProvider(page);

  await page.goto("/login");
  await page.getByTestId(`oauth-${provider}`).click();
  await consent(page);
  await expect(page).toHaveURL(/\/discover/, { timeout: 20_000 });

  const first = await waitForAccount(OAUTH_EMAIL);
  await waitForIdentity(first.id);

  // Sign out through the real control, then sign in again.
  await page.goto("/me");
  await page.getByRole("button", { name: /退出登录/ }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });

  await page.getByTestId(`oauth-${provider}`).click();
  await consent(page);
  await expect(page).toHaveURL(/\/discover/, { timeout: 20_000 });

  const users = await prisma.user.findMany({ where: { email: OAUTH_EMAIL } });
  expect(users).toHaveLength(1);
  const identities = await prisma.oAuthIdentity.findMany({ where: { userId: users[0]!.id } });
  expect(identities).toHaveLength(1);
  expect(identities[0]!.lastLoginAt).not.toBeNull();
});

test("在 provider 页面取消 -> 回到登录页并显示中文提示，且没有会话", async ({ page }) => {
  const provider = await enabledProvider(page);

  await page.goto("/login");
  await page.getByTestId(`oauth-${provider}`).click();
  await expect(page.getByTestId("local-authorize-submit")).toBeVisible({ timeout: 20_000 });

  // The provider's own "denied" reply, exactly as Google sends it on cancel.
  await page.goto(`${API_ORIGIN}/api/v1/auth/oauth/local/callback?error=access_denied`);

  /**
   * The error code is deliberately stripped from the address bar once read (see
   * the `useEffect` in `login/page.tsx`), so the URL assertion is on the final
   * clean form and the MESSAGE is what proves the code was understood.
   */
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  await expect(page.getByText("与 Google 的通信失败，请稍后重试。")).toBeVisible();

  // No account was created…
  expect(await prisma.user.findUnique({ where: { email: OAUTH_EMAIL } })).toBeNull();
  /**
   * …and no session exists. Asserted against the API rather than by navigating to
   * a protected page: a page can render its signed-out state for reasons that have
   * nothing to do with the session (a pending fetch, a redirect that has not run),
   * whereas `GET /auth/me` answers exactly the question being asked.
   */
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
  const me = await page.request.get(`${API_ORIGIN}/api/v1/auth/me`);
  expect(me.status()).toBe(401);
});

test("伪造 state 的回调 -> 中文提示，且不建号", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator('[data-testid^="oauth-"]').first()).toBeVisible({ timeout: 20_000 });

  await page.goto(`${API_ORIGIN}/api/v1/auth/oauth/local/callback?code=forged&state=forged`);

  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
  await expect(page.getByText("这次登录已超时或不是从这里发起的，请重新点击登录。")).toBeVisible();
  expect(await prisma.user.findUnique({ where: { email: OAUTH_EMAIL } })).toBeNull();
});

test("错误提示读一次就清除：地址栏不再带错误码，刷新也不重复显示", async ({ page }) => {
  await page.goto(`${API_ORIGIN}/api/v1/auth/oauth/local/callback?error=access_denied`);
  await expect(page.getByText("与 Google 的通信失败，请稍后重试。")).toBeVisible({ timeout: 20_000 });

  /**
   * The code is stripped from the address bar on mount, so a reload starts clean.
   * Without that, a member who retried successfully would still see the old
   * refusal sitting above a working app.
   */
  await expect(page).toHaveURL(/\/login$/, { timeout: 20_000 });
  await page.reload();
  await expect(page.getByText("与 Google 的通信失败，请稍后重试。")).toHaveCount(0);
});
test("「使用…注册」与「使用…登录」走同一条服务端流程", async ({ page }) => {
  const provider = await enabledProvider(page);

  await page.goto("/register");
  const button = page.getByTestId(`oauth-${provider}`);
  await expect(button).toBeVisible({ timeout: 20_000 });
  await expect(button).toContainText("注册");

  // Same start endpoint: the API decides whether the identity means "new account"
  // or "welcome back", so the two screens are two wordings of one flow.
  expect(await button.getAttribute("href")).toContain(`/api/v1/auth/oauth/${provider}/start`);
});
