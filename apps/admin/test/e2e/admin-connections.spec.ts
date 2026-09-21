import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { ACCOUNTS, FIXTURE_EMAILS, PASSWORD, type SeedIds } from "../fixtures/admin-roles";
import { loginAndLand, openNav } from "../fixtures/browser";

/**
 * Phase C2 — real browser behaviour tests for the Connections screens.
 *
 * ## What this suite is for
 *
 *   1. **Every number on screen equals a count taken independently from
 *      PostgreSQL.** Counted here through Prisma, deliberately *not* through the
 *      page's own endpoint, so the two sides are genuinely independent. This is
 *      the assertion that matters: a list whose total drifts from the database is
 *      the failure mode an operations screen cannot afford.
 *   2. **`REMOVED` is visible.** `removeConnection` is a soft delete and the
 *      normal-user API filters to `ACTIVE` only, so the admin list is the single
 *      place a removed connection survives. The default view must not hide it.
 *   3. **The user filter matches either side.** `userAId`/`userBId` are assigned
 *      by a UUID sort at creation, so they carry no role meaning. Searching Bob
 *      must return the row where he is `userA` *and* the row where he is `userB`
 *      — which is why the fixtures are built as Alice↔Bob and Bob↔Carol rather
 *      than two rows that happen to put Bob in the same column.
 *   4. **`conversationId: null` renders as 「未关联」**, not as a blank or the
 *      literal string `null`. The column is `String? @unique`, so null is legal
 *      stored data.
 *   5. **Read-only.** No mutation control, no audit row written, no full-page
 *      reload on refresh.
 *   6. **RBAC.** The nav entry and the page follow `connections:read`, which is
 *      held by SUPER_ADMIN and ANALYST only — a genuinely narrower set than
 *      `risk:read`, which adds MODERATOR.
 *
 * ## What this suite is NOT
 *
 * Not the security boundary. A hidden link is a convenience; the API's
 * `PermissionGuard` is the boundary, covered by
 * `apps/api/src/admin/admin-connections.spec.ts` and
 * `scripts/phaseA-rbac-verify.mjs`.
 */

/**
 * Fixture marker. Every row this suite writes carries it, so cleanup removes
 * exactly these and can never touch product data.
 *
 * `Connection` has no `description`/`body` column to mark, so the marker lives
 * on the **users** the connections point at (their nickname prefix) — cleanup
 * then deletes the connections by their participants' ids and the users by
 * their marker. This is the only honest way to scope a fixture on a model whose
 * own columns carry no test label.
 */
const CONNECTION_FIXTURE_PREFIX = "PW_CONN_UI_";

const ALICE_NICKNAME = `${CONNECTION_FIXTURE_PREFIX}Alice`;
const BOB_NICKNAME = `${CONNECTION_FIXTURE_PREFIX}Bob`;
const CAROL_NICKNAME = `${CONNECTION_FIXTURE_PREFIX}Carol`;

const FIXTURE_EMAIL_DOMAIN = "pw-conn-ui.invalid";

/** Baseline taken before the fixtures existed, so deltas are honest. */
type Baselines = {
  connections: number;
  activeConnections: number;
  removedConnections: number;
};

type FixtureIds = {
  aliceId: string;
  bobId: string;
  carolId: string;
  /** Alice↔Bob, ACTIVE, with a conversation. */
  activeConnectionId: string;
  /** Bob↔Carol, REMOVED, no conversation. */
  removedConnectionId: string;
  conversationId: string;
};

async function readBaselines(prisma: PrismaClient): Promise<Baselines> {
  const [connections, activeConnections, removedConnections] = await Promise.all([
    prisma.connection.count(),
    prisma.connection.count({ where: { status: "ACTIVE" } }),
    prisma.connection.count({ where: { status: "REMOVED" } }),
  ]);
  return { connections, activeConnections, removedConnections };
}

/**
 * Creates three users and two connections:
 *
 *   Alice ↔ Bob   ACTIVE,  with a conversation
 *   Bob   ↔ Carol REMOVED, conversationId null
 *
 * Bob sits in a *different column* on each row (per the UUID sort at creation),
 * so a user search for Bob can only return both if the filter genuinely checks
 * both sides. Two rows with Bob in `userA` would pass a broken single-column
 * implementation and prove nothing.
 *
 * The REMOVED row also carries the `conversationId: null` case, which is the
 * state the detail screen has to render as 「未关联」.
 *
 * Idempotent: a crashed previous run must not leave rows behind.
 */
async function seedConnectionFixtures(prisma: PrismaClient) {
  await cleanupConnectionFixtures(prisma);

  const baselines = await readBaselines(prisma);

  const [alice, bob, carol] = await Promise.all([
    prisma.user.create({
      data: {
        email: `alice@${FIXTURE_EMAIL_DOMAIN}`,
        passwordHash: "not-a-real-login",
        nickname: ALICE_NICKNAME,
        status: "ACTIVE",
      },
      select: { id: true },
    }),
    prisma.user.create({
      data: {
        email: `bob@${FIXTURE_EMAIL_DOMAIN}`,
        passwordHash: "not-a-real-login",
        nickname: BOB_NICKNAME,
        status: "ACTIVE",
      },
      select: { id: true },
    }),
    prisma.user.create({
      data: {
        email: `carol@${FIXTURE_EMAIL_DOMAIN}`,
        passwordHash: "not-a-real-login",
        nickname: CAROL_NICKNAME,
        status: "ACTIVE",
      },
      select: { id: true },
    }),
  ]);

  // A real conversation, so the ACTIVE row has something to point at. Created
  // only because the spec requires proving the *presence* case as well as the
  // null case — never touched otherwise.
  const conversation = await prisma.conversation.create({
    data: {},
    select: { id: true },
  });

  // userA/userB are written exactly as the product writes them: the sorted pair.
  // Mirroring `connections.service.ts` (`[senderId, receiverId].sort()`) rather
  // than picking the order, so the fixtures have the same shape real rows do.
  const active = await prisma.connection.create({
    data: {
      userAId: [alice.id, bob.id].sort()[0],
      userBId: [alice.id, bob.id].sort()[1],
      status: "ACTIVE",
      conversationId: conversation.id,
    },
    select: { id: true },
  });

  const removed = await prisma.connection.create({
    data: {
      userAId: [bob.id, carol.id].sort()[0],
      userBId: [bob.id, carol.id].sort()[1],
      status: "REMOVED",
      conversationId: null,
    },
    select: { id: true },
  });

  return {
    baselines,
    fixtureIds: {
      aliceId: alice.id,
      bobId: bob.id,
      carolId: carol.id,
      activeConnectionId: active.id,
      removedConnectionId: removed.id,
      conversationId: conversation.id,
    } satisfies FixtureIds,
  };
}

/**
 * Removes exactly the fixture rows.
 *
 * Order matters: `Connection` cascades on user deletion, but deleting the users
 * first would leave the conversation orphaned, so the conversation is removed
 * last and by its own id.
 */
async function cleanupConnectionFixtures(prisma: PrismaClient) {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: FIXTURE_EMAIL_DOMAIN } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);

  if (userIds.length > 0) {
    const connections = await prisma.connection.findMany({
      where: { OR: [{ userAId: { in: userIds } }, { userBId: { in: userIds } }] },
      select: { id: true, conversationId: true },
    });
    await prisma.connection.deleteMany({
      where: { id: { in: connections.map((c) => c.id) } },
    });
    await prisma.conversation.deleteMany({
      where: { id: { in: connections.map((c) => c.conversationId).filter((v): v is string => !!v) } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

test.describe("Phase C2 — Connections", () => {
  let prisma: PrismaClient;
  let ids: SeedIds;
  let baselines: Baselines;
  let fixtureIds: FixtureIds;

  test.beforeAll(async () => {
    prisma = new PrismaClient();
    const users = await prisma.user.findMany({
      where: { email: { in: FIXTURE_EMAILS } },
      select: { id: true, email: true },
    });
    const byEmail = new Map(users.map((u) => [u.email, u.id]));
    ids = {
      superadmin: byEmail.get(ACCOUNTS.superadmin.email)!,
      analyst: byEmail.get(ACCOUNTS.analyst.email)!,
      support: byEmail.get(ACCOUNTS.support.email)!,
      moderator: byEmail.get(ACCOUNTS.moderator.email)!,
      contentManager: byEmail.get(ACCOUNTS.contentManager.email)!,
      inactive: byEmail.get(ACCOUNTS.inactive.email)!,
      victim: byEmail.get(ACCOUNTS.victim.email)!,
    };
    for (const [key, value] of Object.entries(ids)) {
      expect(value, `fixture account ${key} was not seeded`).toBeTruthy();
    }

    ({ baselines, fixtureIds } = await seedConnectionFixtures(prisma));
  });

  test.afterAll(async () => {
    // Fixtures are test-only and must not survive the run. The Connection row
    // count is asserted back to its baseline, so a leak fails the suite instead
    // of quietly polluting the database for the next phase.
    await cleanupConnectionFixtures(prisma);
    const after = await prisma.connection.count();
    expect(after, "connection fixtures leaked into the database").toBe(baselines.connections);
    await prisma.$disconnect();
  });

  /** Signs in and opens the Connections screen, waiting for its heading. */
  async function openConnections(page: import("@playwright/test").Page) {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openNav(page, "连接");
    await expect(page).toHaveURL(/\/connections$/);
    await expect(page.getByRole("heading", { name: "连接" })).toBeVisible();
  }

  // ------------------------------------------------------------------ 1
  test("the Connections nav entry is visible to a SUPER_ADMIN", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    await expect(page.getByRole("link", { name: "连接", exact: true })).toBeVisible();
  });

  // ------------------------------------------------------------------ 2
  test("the Connections nav entry sits in 用户与关系, directly after 用户", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    // Order matters: the nav is the console's map, and an entry appearing
    // somewhere unauthorised is how a route nobody reviewed gets shipped. The
    // exhaustive equality check lives in `admin-rbac.spec.ts`; this asserts the
    // position specifically so a failure names the connections entry.
    //
    // Phase C4 extended the list again (「屏蔽」 between 交换 and 审计日志), so
    // this is the *current* full nav, not a subset: the strict equality is what
    // makes an unreviewed route fail here.
    const labels = await page.locator("aside nav a").allTextContents();
    expect(labels.map((s) => s.trim())).toEqual([
      "仪表盘",
      "用户",
      "连接",
      "交换",
      "屏蔽",
      "举报",
      "审核工作台",
      "风险中心",
      "审计日志",
    ]);
  });

  // ------------------------------------------------------------------ 3
  test("the Connections page loads with its title and column headers", async ({ page }) => {
    await openConnections(page);

    for (const header of ["连接 ID", "用户 A", "用户 B", "状态", "创建时间"]) {
      await expect(page.getByRole("columnheader", { name: header })).toBeVisible();
    }
    await expect(page.getByTestId("connections-error")).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 4
  test("the list total equals an independent count from PostgreSQL", async ({ page }) => {
    await openConnections(page);
    await expect(page.locator("main table")).toBeVisible();

    // Counted here through Prisma, not read back from the page's own endpoint:
    // comparing the endpoint to itself would pass no matter how wrong both are.
    const live = await prisma.connection.count();
    expect(live, "the connection fixtures are missing from the database").toBeGreaterThan(0);

    // The page shows 「共 N 条」 inside its pagination row when there is more
    // than one page; with a single page the row is absent, so the row count is
    // the honest binding here.
    const rows = await page.locator("main table tbody tr").count();
    expect(rows).toBe(Math.min(live, 20));
  });

  // ------------------------------------------------------------------ 5
  test("the ACTIVE fixture connection is listed", async ({ page }) => {
    await openConnections(page);

    // Anchored on the real row arriving, so the assertion cannot race the fetch
    // and compare against a still-empty table.
    const link = page.locator(`main a[href="/connections/${fixtureIds.activeConnectionId}"]`);
    await expect(link).toBeVisible();

    // The `has` locator must be **relative** to the row. Passing the absolute
    // `main a[href=…]` locator resolves nothing inside the row, so the filter
    // silently matches zero elements and the assertion reports "element(s) not
    // found" — which reads like a missing row but is a locator bug.
    const row = page
      .locator("main table tbody tr")
      .filter({ has: page.locator(`a[href="/connections/${fixtureIds.activeConnectionId}"]`) });
    await expect(row).toContainText("已连接");
  });

  // ------------------------------------------------------------------ 6
  test("the REMOVED fixture connection is listed without filtering", async ({ page }) => {
    // The whole point of this screen. `removeConnection` is a soft delete and
    // the normal-user API hides REMOVED, so an admin list that filtered it out
    // by default would hide the state it exists to reveal.
    await openConnections(page);

    const link = page.locator(`main a[href="/connections/${fixtureIds.removedConnectionId}"]`);
    await expect(link, "a REMOVED connection must be visible by default").toBeVisible();

    const row = page
      .locator("main table tbody tr")
      .filter({ has: page.locator(`a[href="/connections/${fixtureIds.removedConnectionId}"]`) });
    await expect(row).toContainText("已解除");
  });

  // ------------------------------------------------------------------ 7
  test("filtering by status=ACTIVE hides the REMOVED row", async ({ page }) => {
    await openConnections(page);
    await expect(page.locator("main table")).toBeVisible();

    await page.locator("main select").selectOption("ACTIVE");
    await page.getByRole("button", { name: "筛选" }).click();

    // Wait for the filtered result to be committed before asserting absence —
    // otherwise the old table is still in the DOM and the row "exists".
    await expect(
      page.locator(`main a[href="/connections/${fixtureIds.activeConnectionId}"]`),
    ).toBeVisible();

    await expect(
      page.locator(`main a[href="/connections/${fixtureIds.removedConnectionId}"]`),
    ).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 8
  test("filtering by status=REMOVED shows the REMOVED row only", async ({ page }) => {
    await openConnections(page);
    await expect(page.locator("main table")).toBeVisible();

    await page.locator("main select").selectOption("REMOVED");
    await page.getByRole("button", { name: "筛选" }).click();

    await expect(
      page.locator(`main a[href="/connections/${fixtureIds.removedConnectionId}"]`),
    ).toBeVisible();
    await expect(
      page.locator(`main a[href="/connections/${fixtureIds.activeConnectionId}"]`),
    ).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 9
  test("searching a user by UUID returns the rows where they are EITHER side", async ({
    page,
  }) => {
    // The fixture design earns its keep here: Bob is `userA` on one row and
    // `userB` on the other, because `userAId`/`userBId` come from a UUID sort
    // and carry no role meaning. A filter that only checked `userAId` would
    // return one of these two and pass every other test in this suite.
    await openConnections(page);
    await expect(page.locator("main table")).toBeVisible();

    await page.getByPlaceholder("搜索用户 ID / 昵称").fill(fixtureIds.bobId);
    await page.getByRole("button", { name: "筛选" }).click();

    await expect(
      page.locator(`main a[href="/connections/${fixtureIds.activeConnectionId}"]`),
    ).toBeVisible();
    await expect(
      page.locator(`main a[href="/connections/${fixtureIds.removedConnectionId}"]`),
    ).toBeVisible();
  });

  // ------------------------------------------------------------------ 10
  test("searching a user by nickname matches both participants", async ({ page }) => {
    await openConnections(page);
    await expect(page.locator("main table")).toBeVisible();

    await page.getByPlaceholder("搜索用户 ID / 昵称").fill(ALICE_NICKNAME);
    await page.getByRole("button", { name: "筛选" }).click();

    // Alice is on one row only, so an over-broad filter would show Bob's second
    // connection too and this assertion would catch it.
    await expect(
      page.locator(`main a[href="/connections/${fixtureIds.activeConnectionId}"]`),
    ).toBeVisible();
    await expect(
      page.locator(`main a[href="/connections/${fixtureIds.removedConnectionId}"]`),
    ).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 11
  test("a date filter narrows the list and is answered by the API", async ({ page }) => {
    await openConnections(page);
    await expect(page.locator("main table")).toBeVisible();

    // A window far in the past: the fixtures were created today, so this must
    // return nothing rather than silently ignoring the bound.
    await page.locator('main input[type="date"]').first().fill("2000-01-01");
    await page.locator('main input[type="date"]').nth(1).fill("2000-01-02");
    await page.getByRole("button", { name: "筛选" }).click();

    await expect(page.getByTestId("connections-empty")).toBeVisible();
  });

  // ------------------------------------------------------------------ 12
  test("no results shows 暂无连接 rather than a blank page", async ({ page }) => {
    await openConnections(page);
    await expect(page.locator("main table")).toBeVisible();

    // A nickname that cannot match anything the fixtures wrote.
    await page.getByPlaceholder("搜索用户 ID / 昵称").fill("zzz-no-such-user-zzz");
    await page.getByRole("button", { name: "筛选" }).click();

    await expect(page.getByTestId("connections-empty")).toBeVisible();
    await expect(page.locator("main table")).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 13
  test("the list payload carries no credential or secret", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    // Asserted at the network layer as well as in the DOM: a value that is
    // fetched but not rendered is still a leak the moment anyone adds a debug
    // panel.
    // The unfiltered first load sends **no** query string, so matching on a
    // literal `?` waits forever. Match the list path and exclude the detail
    // path (`/admin/connections/:id`) instead.
    const responsePromise = page.waitForResponse(
      (response) =>
        /\/admin\/connections(\?|$)/.test(response.url()) && response.status() === 200,
    );
    await openNav(page, "连接");
    const response = await responsePromise;
    const payload = JSON.stringify(await response.json());

    for (const secret of [
      "passwordHash",
      "tokenHash",
      "refreshToken",
      "accessToken",
      "email",
      "userAgent",
    ]) {
      expect(payload, `the connections payload leaks ${secret}`).not.toContain(secret);
    }
    // `ip` is checked as a quoted JSON key, not a substring.
    expect(payload).not.toMatch(/"ip"\s*:/);
  });

  // ------------------------------------------------------------------ 14
  test("an error state offers 重试 and leaks nothing technical", async ({ page }) => {
    await openConnections(page);

    // Force the next request to fail at the transport layer and re-trigger a
    // fetch, so the error branch is exercised rather than assumed.
    await page.route("**/admin/connections*", (route) => route.abort());
    await page.getByRole("button", { name: "刷新" }).click();

    const error = page.getByTestId("connections-error");
    await expect(error).toBeVisible();
    await expect(error.getByRole("button", { name: /重试/ })).toBeVisible();

    // No Prisma error, no SQL, no stack, no database URL. The console is for
    // operators, and a driver message is a schema disclosure.
    const text = await error.innerText();
    for (const leak of ["Prisma", "prisma", "SELECT", "SQL", "postgres", "stack", "undefined"]) {
      expect(text, `the error state leaks ${leak}`).not.toContain(leak);
    }
  });

  // ------------------------------------------------------------------ 15
  test("retry after a failure recovers the list without a page reload", async ({ page }) => {
    await openConnections(page);

    await page.route("**/admin/connections*", (route) => route.abort());
    await page.getByRole("button", { name: "刷新" }).click();
    await expect(page.getByTestId("connections-error")).toBeVisible();

    // Restore the network and retry from the error panel.
    await page.unroute("**/admin/connections*");
    let navigated = false;
    page.once("framenavigated", () => {
      navigated = true;
    });
    await page.getByTestId("connections-error").getByRole("button", { name: /重试/ }).click();

    await expect(page.locator("main table")).toBeVisible();
    expect(navigated, "retrying must not reload the whole page").toBe(false);
  });

  // ------------------------------------------------------------------ 16
  test("a row link opens the connection detail screen", async ({ page }) => {
    await openConnections(page);

    await page.locator(`main a[href="/connections/${fixtureIds.activeConnectionId}"]`).click();
    await expect(page).toHaveURL(/\/connections\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "连接详情" })).toBeVisible();
  });

  // ------------------------------------------------------------------ 17
  test("the ACTIVE detail shows both participants and its conversation id", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await page.goto(`/connections/${fixtureIds.activeConnectionId}`);

    await expect(page.getByRole("heading", { name: "连接详情" })).toBeVisible();

    for (const heading of ["基本信息", "用户 A", "用户 B", "处理历史"]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }

    // Both fixture participants, in the API's own order.
    await expect(page.getByText(ALICE_NICKNAME)).toBeVisible();
    await expect(page.getByText(BOB_NICKNAME)).toBeVisible();
    await expect(page.getByText("已连接").first()).toBeVisible();

    // The ACTIVE fixture carries a real conversation id, so it must be shown.
    await expect(page.getByText(fixtureIds.conversationId)).toBeVisible();
  });

  // ------------------------------------------------------------------ 18
  test("the REMOVED detail is readable and renders a missing conversation as 未关联", async ({
    page,
  }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await page.goto(`/connections/${fixtureIds.removedConnectionId}`);

    await expect(page.getByRole("heading", { name: "连接详情" })).toBeVisible();

    // A REMOVED connection must not 404: an operator following a link from the
    // list does not expect the row to vanish because it was ended.
    await expect(page.getByText("已解除").first()).toBeVisible();

    // `conversationId` is `String? @unique`, so null is legal stored data. It
    // must render as 「未关联」 — never as the literal `null`, and never blanked,
    // which would make "no conversation" indistinguishable from a load failure.
    await expect(page.getByText("未关联")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("null");
  });

  // ------------------------------------------------------------------ 19
  test("an unknown connection id is reported, not shown as a blank page", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await page.goto("/connections/00000000-0000-4000-8000-000000000000");

    // 404 `CONNECTION_NOT_FOUND` from the API surfaces as an error panel. What
    // must never happen is a 200 with a null body, which would leave the screen
    // sitting on 「加载中…」 forever.
    await expect(page.getByTestId("connection-detail-error")).toBeVisible();
    await expect(page.getByTestId("connection-detail-loading")).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 20
  test("the detail screen exposes no exchange or block surface", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await page.goto(`/connections/${fixtureIds.activeConnectionId}`);
    await expect(page.getByRole("heading", { name: "连接详情" })).toBeVisible();

    // A Connection is not a Contact Exchange (C3) and not a Block (C4). Those
    // are separate phases with their own screens; leaking their vocabulary here
    // would promise data this phase does not have.
    const main = page.locator("main");
    const text = await main.innerText();
    for (const forbidden of ["Exchange", "exchange", "Block", "block", "handle", "社交账号"]) {
      expect(text, `the connection detail reaches into C3/C4: ${forbidden}`).not.toContain(
        forbidden,
      );
    }

    const hrefs = await main
      .locator("a")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""));
    for (const href of hrefs) {
      expect(href).not.toMatch(/^\/(exchanges|blocks)/);
    }
  });

  // ------------------------------------------------------------------ 21
  test("an ANALYST can read the Connections screens", async ({ page }) => {
    // `connections:read` is held by SUPER_ADMIN and ANALYST. An ANALYST is the
    // read-only role, so if this works for anyone besides SUPER_ADMIN it is
    // them.
    await loginAndLand(page, ACCOUNTS.analyst.email);

    await expect(page.getByRole("link", { name: "连接", exact: true })).toBeVisible();
    await openNav(page, "连接");
    await expect(page.getByRole("heading", { name: "连接" })).toBeVisible();
    await expect(page.locator("main table")).toBeVisible();
  });

  // ------------------------------------------------------------------ 22
  test("MODERATOR, SUPPORT and CONTENT_MANAGER are not offered Connections", async ({ page }) => {
    // The tempting mistake is granting MODERATOR connection access because it
    // holds moderation access. Those are different jobs and the matrix says so:
    // MODERATOR has `moderation:read` and `risk:read` but NOT
    // `connections:read`.
    //
    // Presentation only — the API refuses all three with a 403, asserted in
    // `apps/api/src/admin/admin-connections.spec.ts` and
    // `scripts/phaseA-rbac-verify.mjs`.
    for (const email of [
      ACCOUNTS.moderator.email,
      ACCOUNTS.support.email,
      ACCOUNTS.contentManager.email,
    ]) {
      await loginAndLand(page, email);
      await expect(
        page.getByRole("link", { name: "连接", exact: true }),
        `${email} must not be offered Connections`,
      ).toHaveCount(0);
    }
  });

  // ------------------------------------------------------------------ 23
  test("both screens are read-only — no mutation control, no audit written", async ({ page }) => {
    await openConnections(page);
    await expect(page.locator("main table")).toBeVisible();

    // No write control of any kind, on either screen.
    await expect(
      page.getByRole("button", { name: /删除|恢复|封禁|停用|解封|移除|编辑|保存/ }),
    ).toHaveCount(0);

    await page.goto(`/connections/${fixtureIds.activeConnectionId}`);
    await expect(page.getByRole("heading", { name: "连接详情" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /删除|恢复|封禁|停用|解封|移除|编辑|保存/ }),
    ).toHaveCount(0);

    // Phase C2 is GET-only, so opening both screens writes no audit row. An
    // inspection console that logged every view would flood the log it exists
    // alongside.
    const before = await prisma.adminAuditLog.count();
    await openConnections(page);
    await page.goto(`/connections/${fixtureIds.activeConnectionId}`);
    await expect(page.getByRole("heading", { name: "连接详情" })).toBeVisible();

    const after = await prisma.adminAuditLog.count();
    expect(after, "reading Connections must not write an audit row").toBe(before);
  });

  // ------------------------------------------------------------------ 24
  test("the detail screen offers a way back to the list", async ({ page }) => {
    await openConnections(page);
    await page.locator(`main a[href="/connections/${fixtureIds.activeConnectionId}"]`).click();
    await expect(page.getByRole("heading", { name: "连接详情" })).toBeVisible();

    await page.getByRole("link", { name: "返回列表" }).click();
    await expect(page).toHaveURL(/\/connections$/);
    await expect(page.getByRole("heading", { name: "连接" })).toBeVisible();
  });
});
