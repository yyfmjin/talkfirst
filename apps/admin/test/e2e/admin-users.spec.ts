import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { expect, test, type Page } from "@playwright/test";
import { PASSWORD } from "../fixtures/admin-roles";
import { loginAndLand, openNav } from "../fixtures/browser";

/**
 * Phase B2 — the users list, driven in a real browser.
 *
 * These are behaviour tests. Every filter is asserted against what the page
 * actually shows after a real HTTP round trip, and the numbers are compared
 * with counts read straight from PostgreSQL — so a filter wired to the wrong
 * query parameter fails here even though the page still "looks fine".
 *
 * ## Why this file seeds its own users
 *
 * The list is the one screen where the *data* is the interface: search, country,
 * date range, sort and pagination are all meaningless without rows that differ
 * along every axis. So this spec creates 25 users under `pw.users.` with a
 * country code of its own (`ZZ`), a spread of `createdAt` days and four
 * different statuses. The `ZZ` filter isolates them from the other 168 accounts,
 * which is what makes `共 25 人 · 第 1 / 2 页` a deterministic assertion rather
 * than a number that drifts whenever someone adds a fixture.
 *
 * They are removed in `afterAll`, and re-created idempotently in `beforeAll` so
 * a crashed run cannot leave duplicates behind.
 *
 * ## What is deliberately not asserted
 *
 * Button visibility is presentation, not authorization. The API's
 * `PermissionGuard` + `AdminService` checks remain the only security boundary
 * (see `apps/api/src/admin/admin-users.spec.ts` and
 * `scripts/phaseA-rbac-verify.mjs`).
 */

const API_URL = "http://localhost:4000/api/v1";

const PREFIX = "pw.users.";
/** How many isolated fixture users this spec creates. */
const FIXTURE_COUNT = 25;
/** The country code only these fixtures use. */
const FIXTURE_COUNTRY = "ZZ";
const CONTENT_MANAGER_EMAIL = `${PREFIX}contentmgr@example.test`;

let prisma: PrismaClient;

/**
 * Creates the fixture users.
 *
 * `createdAt` is set explicitly rather than left to `now()`: the date-range
 * filter and the default sort are both assertions about *ordering*, and rows
 * created in the same millisecond cannot express one.
 */
async function seedUsers() {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  for (let i = 1; i <= FIXTURE_COUNT; i += 1) {
    const n = String(i).padStart(2, "0");
    const status = i === 1 ? "BANNED" : i === 2 ? "DISABLED" : i === 3 ? "SUSPENDED" : "ACTIVE";
    await prisma.user.create({
      data: {
        email: `${PREFIX}${n}@example.test`,
        passwordHash,
        emailVerified: true,
        status,
        nickname: `PWU ${n}`,
        countryCode: FIXTURE_COUNTRY,
        isAdmin: false,
        createdAt: new Date(`2026-01-${n}T12:00:00.000Z`),
        lastActiveAt: i % 2 === 0 ? new Date(`2026-02-${n}T08:00:00.000Z`) : null,
        ...(status === "BANNED"
          ? { bannedAt: new Date("2026-03-01T00:00:00.000Z"), banReason: "phase B2 fixture" }
          : {}),
        // A future deadline on purpose: the suspension-expiry sweep must never
        // pick this row up, in this suite or in any other.
        ...(status === "SUSPENDED"
          ? {
              suspendedUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              banReason: "phase B2 fixture",
            }
          : {}),
      },
    });
  }

  // A *second* administrator role the console must handle: there is no active
  // CONTENT_MANAGER in the shared fixtures (the existing one is soft-disabled so
  // it can prove ADMIN_INACTIVE), and read-only behaviour for this role cannot
  // be asserted without someone who can actually sign in.
  const contentManager = await prisma.user.create({
    data: {
      email: CONTENT_MANAGER_EMAIL,
      passwordHash,
      emailVerified: true,
      status: "ACTIVE",
      nickname: "PWU contentmgr",
      countryCode: "US",
      isAdmin: true,
    },
    select: { id: true },
  });
  await prisma.adminUser.create({
    data: { userId: contentManager.id, role: "CONTENT_MANAGER", isActive: true },
  });
}

/** Removes every fixture row this spec created, in FK-safe order. */
async function cleanupUsers() {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return 0;

  await prisma.adminAuditLog.deleteMany({
    where: { OR: [{ adminId: { in: ids } }, { targetId: { in: ids } }] },
  });
  await prisma.adminNote.deleteMany({
    where: { OR: [{ adminId: { in: ids } }, { userId: { in: ids } }] },
  });
  await prisma.report.deleteMany({
    where: { OR: [{ reporterId: { in: ids } }, { reportedUserId: { in: ids } }] },
  });
  await prisma.adminUser.deleteMany({ where: { userId: { in: ids } } });
  const removed = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  return removed.count;
}

test.beforeAll(async () => {
  prisma = new PrismaClient();
  await cleanupUsers();
  await seedUsers();
});

test.afterAll(async () => {
  if (!prisma) return;
  await cleanupUsers();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function openUsers(page: Page) {
  await openNav(page, "用户");
  await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
}

/** The summary line: 「共 N 人 · 第 X / Y 页」. */
function summary(page: Page) {
  return page.getByTestId("users-summary");
}

/** The pager's own page label, which is a different element from the summary. */
function pagerLabel(page: Page) {
  return page.getByTestId("users-pager");
}

function userRows(page: Page) {
  return page.locator("main div.rounded-2xl").filter({ has: page.getByTestId("status-badge") });
}

function rowLinks(page: Page) {
  return page.locator("main a[href^='/users/']");
}

function searchInput(page: Page) {
  return page.getByPlaceholder("搜索 email / nickname");
}

async function applyFilters(page: Page) {
  await page.getByRole("button", { name: "搜索", exact: true }).click();
}

/**
 * Clicks 搜索 and waits for the request it fires to come back.
 *
 * Asserting on the rendered DOM alone is not enough in this file: two
 * consecutive filters can produce *identical visible text* — DISABLED and
 * SUSPENDED each have exactly one fixture here — so a `toContainText` would be
 * satisfied by the previous response and the assertion would quietly prove
 * nothing. Waiting for the specific response removes the ambiguity.
 */
async function applyFiltersAndWait(page: Page, queryPart: string) {
  const response = page.waitForResponse(
    (r) => r.url().includes("/admin/users?") && r.url().includes(queryPart),
  );
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  await response;
}

/** Restricts the view to this spec's own fixtures. */
async function scopeToFixtures(page: Page) {
  await page.getByLabel("国家筛选").fill(FIXTURE_COUNTRY);
  await applyFilters(page);
}

test.describe("users list — filters, sort and pagination", () => {
  // ------------------------------------------------------------------ 1
  test("Test 1: the users screen opens and reports a real total", async ({ page }) => {
    await loginAndLand(page, "pw.superadmin@example.test");
    await openUsers(page);

    await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
    // The total comes from the database, not from the number of rendered rows.
    const total = await prisma.user.count();
    await expect(page.getByText(`共 ${total} 名用户。筛选、排序与分页都由后端执行。`)).toBeVisible();
    // At most one page worth of rows is rendered, whatever the total is.
    expect(await userRows(page).count()).toBeLessThanOrEqual(20);
  });

  // ------------------------------------------------------------------ 2
  test("Test 2: search finds a user by email, nickname and exact id", async ({ page }) => {
    await loginAndLand(page, "pw.superadmin@example.test");
    await openUsers(page);

    // email
    await searchInput(page).fill(`${PREFIX}07@example.test`);
    await applyFilters(page);
    await expect(summary(page)).toContainText("共 1 人");
    await expect(rowLinks(page).first()).toHaveText("PWU 07");

    // nickname
    await searchInput(page).fill("PWU 07");
    await applyFilters(page);
    await expect(summary(page)).toContainText("共 1 人");

    // exact id — the one lookup a fuzzy search could not express
    const fixture = await prisma.user.findUnique({
      where: { email: `${PREFIX}07@example.test` },
      select: { id: true },
    });
    await searchInput(page).fill(fixture!.id);
    await applyFilters(page);
    await expect(summary(page)).toContainText("共 1 人");
    await expect(rowLinks(page).first()).toHaveText("PWU 07");
  });

  test("Test 2b: a partial id is not treated as an id lookup", async ({ page }) => {
    await loginAndLand(page, "pw.superadmin@example.test");
    await openUsers(page);

    const fixture = await prisma.user.findUnique({
      where: { email: `${PREFIX}07@example.test` },
      select: { id: true },
    });
    await searchInput(page).fill(fixture!.id.slice(0, 8));
    await applyFilters(page);
    // No email or nickname contains that prefix, so the honest answer is none.
    await expect(page.getByText("暂无用户")).toBeVisible();
  });

  // ------------------------------------------------------------------ 3
  // PC-3.4 — the console renders statuses in Chinese, so the badge and the
  // filter label agree. The wire values below are still the raw enums.
  const STATUS_LABELS: Record<string, string> = {
    ACTIVE: "正常",
    DISABLED: "已停用",
    SUSPENDED: "已暂停",
    BANNED: "已封禁",
  };

  test("Test 3: the status filter reaches the API and matches the database", async ({ page }) => {
    await loginAndLand(page, "pw.superadmin@example.test");
    await openUsers(page);

    for (const status of ["ACTIVE", "DISABLED", "SUSPENDED", "BANNED"] as const) {
      const expected = await prisma.user.count({
        where: { countryCode: FIXTURE_COUNTRY, status },
      });
      await page.getByLabel("国家筛选").fill(FIXTURE_COUNTRY);
      await page.getByLabel("状态筛选").selectOption(status);
      // Waits for this exact query, not merely for "some text is on screen".
      await applyFiltersAndWait(page, `status=${status}`);

      await expect(summary(page)).toContainText(`共 ${expected} 人`);

      // The badge is the row's own statement of its status, so it must agree
      // with the filter that selected it. Both gates below retry, which is what
      // makes the assertion real when two statuses have the same row count.
      const badges = page.getByTestId("status-badge");
      await expect(badges).toHaveCount(Math.min(expected, 20));
      await expect(badges.first()).toHaveText(STATUS_LABELS[status]);
      expect((await badges.allTextContents()).every((text) => text.trim() === STATUS_LABELS[status])).toBe(true);
    }

    // 「全部」 restores the unfiltered set for this country.
    await page.getByLabel("状态筛选").selectOption("ALL");
    await applyFiltersAndWait(page, "status=ALL");
    await expect(summary(page)).toContainText(`共 ${FIXTURE_COUNT} 人`);
  });

  // ------------------------------------------------------------------ 4
  test("Test 4: the country filter is an exact match on countryCode", async ({ page }) => {
    await loginAndLand(page, "pw.superadmin@example.test");
    await openUsers(page);

    await scopeToFixtures(page);
    await expect(summary(page)).toContainText(`共 ${FIXTURE_COUNT} 人`);
    // Every rendered row really belongs to that country.
    const rows = await userRows(page).allTextContents();
    expect(rows.every((text) => text.includes(`国家 ${FIXTURE_COUNTRY}`))).toBe(true);

    // A different code returns a different, database-derived set.
    const usTotal = await prisma.user.count({ where: { countryCode: "US" } });
    await page.getByLabel("国家筛选").fill("US");
    await applyFilters(page);
    await expect(summary(page)).toContainText(`共 ${usTotal} 人`);
  });

  // ---------------------------------------------------------------- 5 & 6
  test("Test 5-6: the creation-date range is inclusive at both ends", async ({ page }) => {
    await loginAndLand(page, "pw.superadmin@example.test");
    await openUsers(page);
    await scopeToFixtures(page);

    // Fixtures are dated 2026-01-01 .. 2026-01-25, so 05..10 is six users — and
    // the 10th is only included because the console sends the *end* of the
    // selected day rather than its midnight.
    await page.getByLabel("创建时间从").fill("2026-01-05");
    await page.getByLabel("创建时间到").fill("2026-01-10");
    await applyFilters(page);
    await expect(summary(page)).toContainText("共 6 人");

    const names = await rowLinks(page).allTextContents();
    expect(names.sort()).toEqual(["PWU 05", "PWU 06", "PWU 07", "PWU 08", "PWU 09", "PWU 10"]);

    // A start date on its own.
    await page.getByLabel("创建时间到").fill("");
    await applyFilters(page);
    await expect(summary(page)).toContainText(`共 ${FIXTURE_COUNT - 4} 人`);

    // And an end date on its own.
    await page.getByLabel("创建时间从").fill("");
    await page.getByLabel("创建时间到").fill("2026-01-03");
    await applyFilters(page);
    await expect(summary(page)).toContainText("共 3 人");
  });

  // ------------------------------------------------------------------ 7
  test("Test 7: sort reorders the list and is chosen from a fixed list", async ({ page }) => {
    await loginAndLand(page, "pw.superadmin@example.test");
    await openUsers(page);
    await scopeToFixtures(page);

    // The default order is the pre-B2 one: newest first.
    await expect(rowLinks(page).first()).toHaveText("PWU 25");

    await page.getByLabel("排序字段").selectOption("nickname");
    await page.getByLabel("排序方向").selectOption("asc");
    await applyFilters(page);
    await expect(rowLinks(page).first()).toHaveText("PWU 01");

    await page.getByLabel("排序方向").selectOption("desc");
    await applyFilters(page);
    await expect(rowLinks(page).first()).toHaveText("PWU 25");

    await page.getByLabel("排序字段").selectOption("createdAt");
    await page.getByLabel("排序方向").selectOption("asc");
    await applyFilters(page);
    await expect(rowLinks(page).first()).toHaveText("PWU 01");

    await page.getByLabel("排序字段").selectOption("lastActiveAt");
    await page.getByLabel("排序方向").selectOption("desc");
    await applyFilters(page);
    // Only the even-numbered fixtures have an activity timestamp, so the newest
    // active one leads.
    await expect(rowLinks(page).first()).toHaveText("PWU 24");

    // The UI offers a fixed set of fields and directions — no free text, so a
    // column name can never be typed into the query.
    await expect(page.getByLabel("排序字段").locator("option")).toHaveCount(4);
    await expect(page.getByLabel("排序方向").locator("option")).toHaveCount(2);
  });

  // ------------------------------------------------------------------ 8
  test("Test 8: pagination shows 第 X / Y 页 with the buttons disabled at each end", async ({
    page,
  }) => {
    await loginAndLand(page, "pw.superadmin@example.test");
    await openUsers(page);
    await scopeToFixtures(page);

    // 25 fixtures at 20 per page: two pages, 20 + 5.
    await expect(summary(page)).toContainText(`共 ${FIXTURE_COUNT} 人 · 第 1 / 2 页`);
    await expect(pagerLabel(page)).toHaveText("第 1 / 2 页");
    expect(await userRows(page).count()).toBe(20);

    const prev = page.getByRole("button", { name: "上一页", exact: true });
    const next = page.getByRole("button", { name: "下一页", exact: true });
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();

    await next.click();
    await expect(summary(page)).toContainText(`共 ${FIXTURE_COUNT} 人 · 第 2 / 2 页`);
    await expect(pagerLabel(page)).toHaveText("第 2 / 2 页");
    // The second page holds the remainder, and the order continues rather than
    // restarting.
    expect(await userRows(page).count()).toBe(5);
    await expect(rowLinks(page).first()).toHaveText("PWU 05");
    await expect(prev).toBeEnabled();
    await expect(next).toBeDisabled();

    await prev.click();
    await expect(pagerLabel(page)).toHaveText("第 1 / 2 页");
  });

  // ------------------------------------------------------------------ 9
  test("Test 9: an empty result shows 暂无用户, never 第 1 / 0 页", async ({ page }) => {
    await loginAndLand(page, "pw.superadmin@example.test");
    await openUsers(page);

    await searchInput(page).fill("no-such-user-anywhere-zzz");
    await applyFilters(page);

    await expect(page.getByText("暂无用户")).toBeVisible();
    // The empty state explains which kind of empty it is.
    await expect(page.getByText("没有符合当前筛选条件的用户。")).toBeVisible();
    // The two failure modes this guards: a pager rendered for zero rows, and a
    // 「第 1 / 0 页」 label produced by fudging totalPages to 1.
    await expect(summary(page)).toHaveCount(0);
    await expect(pagerLabel(page)).toHaveCount(0);
    await expect(page.getByText("第 1 / 0 页")).toHaveCount(0);
    expect(await userRows(page).count()).toBe(0);

    // 清空筛选 is the way out, and it really re-queries.
    await page.getByRole("button", { name: "清空筛选" }).first().click();
    await expect(page.getByText("暂无用户")).toHaveCount(0);
    await expect(summary(page)).toContainText("第 1 /");
  });

  test("Test 9b: a genuinely empty database is described differently from a filtered miss", async ({
    page,
  }) => {
    await loginAndLand(page, "pw.superadmin@example.test");
    // Forced at the API boundary: with 190 real users, "no users at all" is not
    // reachable any other way, and it is a different message for a reason.
    await page.route("**/admin/users*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
        }),
      });
    });
    await page.goto("/users");

    await expect(page.getByText("暂无用户")).toBeVisible();
    await expect(page.getByText("系统中还没有任何用户。")).toBeVisible();
    await expect(page.getByText("第 1 / 0 页")).toHaveCount(0);
  });

  // ----------------------------------------------------------------- 10
  test("Test 10: a reload keeps the page structure instead of going blank", async ({ page }) => {
    await loginAndLand(page, "pw.superadmin@example.test");
    await openUsers(page);

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/admin/users*", async (route) => {
      await gate;
      await route.continue();
    });

    await searchInput(page).fill("PWU 01");
    await applyFilters(page);

    // In flight: the toolbar is still there and the loading state is explicit.
    await expect(page.getByRole("button", { name: "搜索", exact: true })).toBeVisible();
    await expect(page.getByLabel("状态筛选")).toBeVisible();
    await expect(page.locator("main").getByText("加载中…")).toBeVisible();

    release();
    await expect(summary(page)).toContainText("共 1 人");
  });

  test("Test 10b: a slow earlier response cannot overwrite a newer one", async ({ page }) => {
    await loginAndLand(page, "pw.superadmin@example.test");
    await openUsers(page);

    let releaseSlow: () => void = () => undefined;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    await page.route("**/admin/users*", async (route) => {
      if (route.request().url().includes("search=no-such-user-anywhere-zzz")) {
        // Hold the stale request until after the newer one has answered.
        await slowGate;
      }
      await route.continue();
    });

    await searchInput(page).fill("no-such-user-anywhere-zzz");
    await applyFilters(page);

    await searchInput(page).fill("PWU 01");
    await applyFilters(page);
    await expect(summary(page)).toContainText("共 1 人");

    // Now let the first response land, out of order.
    releaseSlow();
    // It must be discarded: the page still shows the newer query's result.
    await expect(summary(page)).toContainText("共 1 人");
    await expect(page.getByText("暂无用户")).toHaveCount(0);
    await expect(rowLinks(page).first()).toHaveText("PWU 01");
  });

  // ------------------------------------------------------------- 11 & 12
  test("Test 11-12: a failure shows a safe message and retry recovers", async ({ page }) => {
    await loginAndLand(page, "pw.superadmin@example.test");

    let failing = true;
    await page.route("**/admin/users*", async (route) => {
      if (!failing) {
        await route.continue();
        return;
      }
      // A deliberately raw internal error, as a proxy or a misconfigured
      // gateway could produce it.
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: {
            code: "INTERNAL_ERROR",
            message: "PrismaClientKnownRequestError: invalid `prisma.user.findMany()`\n    at /app/dist/x.js:1:1",
          },
        }),
      });
    });
    await page.goto("/users");

    await expect(page.getByRole("button", { name: "重试", exact: true })).toBeVisible();
    // The administrator gets a sentence, not a stack trace.
    await expect(page.getByText("加载失败，请稍后重试")).toBeVisible();
    await expect(page.locator("main")).not.toContainText("PrismaClientKnownRequestError");
    await expect(page.locator("main")).not.toContainText("at /app/dist");
    // A failed request is not an empty result.
    await expect(page.getByText("暂无用户")).toHaveCount(0);

    failing = false;
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(page.getByText("加载失败，请稍后重试")).toHaveCount(0);
    await expect(summary(page)).toContainText("第 1 /");
  });
});

// ---------------------------------------------------------------------------
// 13-17. what each role sees
// ---------------------------------------------------------------------------

test.describe("users list — role behaviour", () => {
  test("Test 13: SUPER_ADMIN sees every status control and the note composer", async ({ page }) => {
    await loginAndLand(page, "pw.superadmin@example.test");
    await openUsers(page);

    for (const label of ["解封", "停用", "临时封禁", "永久封禁"]) {
      await expect(page.getByRole("button", { name: label, exact: true }).first()).toBeVisible();
    }
    await expect(page.getByPlaceholder("写一条内部备注…").first()).toBeVisible();
    await expect(page.getByText(/只读/)).toHaveCount(0);
  });

  test("Test 14: MODERATOR may suspend but is never offered a permanent ban", async ({ page }) => {
    await loginAndLand(page, "pw.moderator@example.test");
    await openUsers(page);

    await expect(page.getByRole("button", { name: "临时封禁", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "停用", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "永久封禁", exact: true })).toHaveCount(0);
  });

  test("Test 15: SUPPORT gets basic account controls only", async ({ page }) => {
    await loginAndLand(page, "pw.support@example.test");
    await openUsers(page);

    await expect(page.getByRole("button", { name: "停用", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "解封", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "临时封禁", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "永久封禁", exact: true })).toHaveCount(0);
  });

  test("Test 16: ANALYST reads the list with no write control at all", async ({ page }) => {
    await loginAndLand(page, "pw.analyst@example.test");
    await openUsers(page);

    await expect(page.getByText(/只读/)).toBeVisible();
    // The filters are read-only-safe and stay available.
    await expect(searchInput(page)).toBeVisible();
    await expect(page.getByLabel("状态筛选")).toBeVisible();

    for (const label of ["解封", "停用", "临时封禁", "永久封禁"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
    }
    await expect(page.getByPlaceholder("写一条内部备注…")).toHaveCount(0);
  });

  test("Test 17: CONTENT_MANAGER reads the list and cannot write", async ({ page }) => {
    await loginAndLand(page, CONTENT_MANAGER_EMAIL);
    await openUsers(page);

    await expect(page.getByText("CONTENT_MANAGER", { exact: true })).toBeVisible();
    await expect(page.getByText(/只读/)).toBeVisible();
    for (const label of ["解封", "停用", "临时封禁", "永久封禁"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
    }
    await expect(page.getByPlaceholder("写一条内部备注…")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// 18-20. the row itself
// ---------------------------------------------------------------------------

test.describe("users list — row content", () => {
  test("Test 18: each row carries a status badge and both timestamps", async ({ page }) => {
    await loginAndLand(page, "pw.superadmin@example.test");
    await openUsers(page);
    await scopeToFixtures(page);

    // The banned fixture is the one with a reason attached.
    await searchInput(page).fill(`${PREFIX}01@example.test`);
    await applyFilters(page);

    const row = userRows(page).first();
    await expect(row).toBeVisible();
    await expect(row.getByTestId("status-badge")).toHaveText("已封禁");
    await expect(row).toContainText("国家 ZZ");
    await expect(row).toContainText("创建 ");
    await expect(row).toContainText("最近活跃 ");
    await expect(row).toContainText("phase B2 fixture");

    // A user who has never been active says so rather than printing a null.
    await searchInput(page).fill(`${PREFIX}05@example.test`);
    await applyFilters(page);
    const inactive = userRows(page).first();
    await expect(inactive).toContainText("最近活跃 -");
    await expect(inactive).not.toContainText("null");
    await expect(inactive).not.toContainText("undefined");
  });

  test("Test 19: the list never renders a secret", async ({ page }) => {
    await loginAndLand(page, "pw.superadmin@example.test");
    await openUsers(page);

    const text = await page.locator("main").innerText();
    for (const forbidden of [
      "passwordHash",
      "tokenHash",
      "refreshToken",
      "accessToken",
      "$2a$",
      "$2b$",
    ]) {
      expect(text).not.toContain(forbidden);
    }

    // And the API contract behind it, checked over real HTTP with the session
    // cookie rather than through the rendered DOM.
    const response = await page.request.get(`${API_URL}/admin/users?pageSize=100`);
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { data: { items: unknown[] } };
    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          keys.add(key);
          walk(child);
        }
      }
    };
    walk(body.data);
    for (const forbidden of [
      "passwordHash",
      "tokenHash",
      "refreshToken",
      "accessToken",
      "ip",
      "userAgent",
      "oauth",
      "secret",
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect(JSON.stringify(body)).not.toMatch(/\$2[aby]\$/);
  });

  test("Test 20: the internal note composer is still there for a writer", async ({ page }) => {
    await loginAndLand(page, "pw.superadmin@example.test");
    await openUsers(page);

    const composer = page.getByPlaceholder("写一条内部备注…").first();
    await expect(composer).toBeVisible();
    await expect(page.getByRole("button", { name: "备注", exact: true }).first()).toBeVisible();

    // Writing one really reaches the database — the composer is not decorative.
    //
    // `applyFiltersAndWait`, not bare `applyFilters`: the composer's value lives
    // in a state map keyed by row id, so typing before the filtered reload has
    // landed writes into the *previous* row's slot and the new row renders an
    // empty input. The note is then never POSTed. This only showed up at the
    // tail of the full 74-test run, where the reload is slow enough to lose the
    // race — it passed every time in isolation, which is what made it worth
    // pinning down rather than re-running. Waiting on the response that carries
    // the filter removes the race instead of making it less likely.
    await searchInput(page).fill(`${PREFIX}09@example.test`);
    await applyFiltersAndWait(page, "search=pw.users.09");
    const target = await prisma.user.findUnique({
      where: { email: `${PREFIX}09@example.test` },
      select: { id: true },
    });
    if (!target) throw new Error("fixture pw.users.09 is missing — seeding failed");
    const before = await prisma.adminNote.count({ where: { userId: target.id } });

    // Scope to the row that actually carries the fixture, so the note cannot be
    // posted against whichever row happens to sort first.
    const targetRow = userRows(page).first();
    await expect(targetRow).toContainText(`${PREFIX}09@example.test`);
    const composerInput = targetRow.getByPlaceholder("写一条内部备注…");
    await composerInput.fill("phase B2 browser note");
    await targetRow.getByRole("button", { name: "备注", exact: true }).click();

    await expect
      .poll(async () => prisma.adminNote.count({ where: { userId: target.id } }), {
        timeout: 15_000,
      })
      .toBe(before + 1);
  });
});
