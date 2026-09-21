import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import {
  cleanupAuditRows,
  seedAuditRows,
  type SeedIds,
} from "../fixtures/admin-roles";
import { loginAndLand, openNav } from "../fixtures/browser";

/**
 * Phase B1 — Dashboard, driven in a real browser.
 *
 * These are behaviour tests, not source assertions: the numbers rendered are
 * compared against the same counts read straight from PostgreSQL, so a KPI
 * wired to the wrong query fails here even though the page still "looks fine".
 *
 * Three properties get special attention because they are easy to get wrong in
 * ways that look correct:
 *
 *   1. **Zero is data.** A card that hides itself at zero makes "no suspensions"
 *      indistinguishable from "this card is broken". Every KPI must render
 *      unconditionally, whatever its value.
 *   2. **Empty is normal.** There are currently no OPEN reports and no persisted
 *      SYSTEM audit rows, so an empty section is the expected first impression —
 *      it must show an explicit empty state, never a blank gap or a spinner that
 *      never resolves.
 *   3. **SYSTEM rows have no actor.** A machine action must render as
 *      「系统 · 自动」 without the page ever printing a null administrator id.
 */

const SUPERADMIN_EMAIL = "pw.superadmin@example.test";

let prisma: PrismaClient;
let expected: {
  users: number;
  active: number;
  suspended: number;
  banned: number;
  todayNewUsers: number;
  newUsers7d: number;
  reportsOpen: number;
  admins: number;
};

/** Reads the same counts the API reports, straight from the database. */
async function readExpected() {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [users, active, suspended, banned, todayNewUsers, newUsers7d, reportsOpen, admins] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { status: "ACTIVE" } }),
      prisma.user.count({ where: { status: "SUSPENDED" } }),
      prisma.user.count({ where: { status: "BANNED" } }),
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.report.count({ where: { status: "OPEN" } }),
      prisma.adminUser.count({ where: { isActive: true } }),
    ]);

  return { users, active, suspended, banned, todayNewUsers, newUsers7d, reportsOpen, admins };
}

/**
 * PC-2.5.6 — one terminal report per target kind, so the 「最近举报处理」 feed can
 * be checked for all three. The feed shows every terminal report, so without
 * these fixtures the section is empty and a target could regress silently.
 *
 * `messageId` and `momentId` are bare pointers with no foreign key, which is
 * why the message fixture needs no real Message row, while the moment one does
 * — the reported user of a moment report is the moment's author.
 */
const REPORT_FIXTURE_PREFIX = "PW_DASH_UI_REPORT";
const REPORT_MOMENT_MARKER = "PW_DASH_UI_FIXTURE_MOMENT";

type ReportFixtureIds = {
  userReportId: string;
  messageReportId: string;
  momentReportId: string;
};

let reportFixtures: ReportFixtureIds;

/** Removes exactly the rows {@link seedReportFixtures} wrote. */
async function cleanupReportFixtures(prisma: PrismaClient) {
  await prisma.report.deleteMany({
    where: { description: { startsWith: REPORT_FIXTURE_PREFIX } },
  });
  // No foreign key from Report to Moment, so the report's removal does not
  // remove the moment; a leaked one would pollute every later run.
  await prisma.moment.deleteMany({
    where: { content: { startsWith: REPORT_MOMENT_MARKER } },
  });
}

async function seedReportFixtures(
  prisma: PrismaClient,
  ids: { superadmin: string; victim: string },
): Promise<ReportFixtureIds> {
  // Idempotent: a crashed previous run must not leave rows behind.
  await cleanupReportFixtures(prisma);

  const moment = await prisma.moment.create({
    data: {
      userId: ids.victim,
      platform: "TALKFIRST",
      content: REPORT_MOMENT_MARKER + " a moment an operator had to look at",
      source: "USER",
    },
    select: { id: true },
  });

  const common = {
    reporterId: ids.superadmin,
    reportedUserId: ids.victim,
    reason: "OTHER",
    status: "RESOLVED" as const,
  };

  const userReport = await prisma.report.create({
    data: { ...common, description: REPORT_FIXTURE_PREFIX + " user" },
    select: { id: true },
  });
  const messageReport = await prisma.report.create({
    data: {
      ...common,
      description: REPORT_FIXTURE_PREFIX + " message",
      messageId: "8f5a1c2e-3d4b-4a5c-9e6f-7a8b9c0d1e2f",
    },
    select: { id: true },
  });
  const momentReport = await prisma.report.create({
    data: {
      ...common,
      description: REPORT_FIXTURE_PREFIX + " moment",
      momentId: moment.id,
    },
    select: { id: true },
  });

  return {
    userReportId: userReport.id,
    messageReportId: messageReport.id,
    momentReportId: momentReport.id,
  };
}

test.beforeAll(async () => {
  prisma = new PrismaClient();
  const fixtures = await prisma.user.findMany({
    where: { email: { in: [SUPERADMIN_EMAIL, "pw.victim@example.test"] } },
    select: { id: true, email: true },
  });
  const superadmin = fixtures.find((u) => u.email === SUPERADMIN_EMAIL);
  const victim = fixtures.find((u) => u.email === "pw.victim@example.test");
  if (!superadmin || !victim) {
    throw new Error("expected the seeded superadmin and victim; is globalSetup wired up?");
  }

  // A SYSTEM audit row is the only way to exercise the 「系统 · 自动」 rendering:
  // nothing in the console can produce one, and the scheduler cannot be fired on
  // demand. `seedAuditRows` also writes a human row, so both branches render.
  await seedAuditRows(prisma, { superadmin: superadmin.id, victim: victim.id } as SeedIds);

  // These are terminal reports, so `reportsOpen` is untouched by them.
  reportFixtures = await seedReportFixtures(prisma, {
    superadmin: superadmin.id,
    victim: victim.id,
  });

  expected = await readExpected();
});

test.afterAll(async () => {
  if (!prisma) return;
  await cleanupAuditRows(prisma);
  await cleanupReportFixtures(prisma);
  await prisma.$disconnect();
});

/** The KPI card carrying a given label, located by the label it renders. */
function kpiCard(page: Page, label: string) {
  return page
    .locator("main div.rounded-2xl")
    .filter({ has: page.getByText(label, { exact: true }) });
}

/**
 * One of the titled blocks on the page.
 *
 * Scoping matters: a SYSTEM action legitimately appears twice — once in 最近审计
 * and once in 系统自动事件 — so an unscoped text locator matches two elements and
 * Playwright's strict mode rejects it. Each assertion has to say which section
 * it is talking about.
 */
function section(page: Page, heading: string) {
  return page.locator("section", { has: page.getByRole("heading", { name: heading }) });
}

/** Asserts one KPI shows exactly `value` (exact, so "0" cannot match "10"). */
async function expectKpi(page: Page, label: string, value: number) {
  const card = kpiCard(page, label);
  await expect(card).toBeVisible();
  await expect(card.locator("p").first()).toHaveText(String(value));
}

test.describe("dashboard — landing, KPIs and lists", () => {
  // -------------------------------------------------------------- Test 1 & 3
  test("Test 1: signing in lands on /dashboard with the dashboard heading", async ({ page }) => {
    await loginAndLand(page, SUPERADMIN_EMAIL);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "仪表盘" })).toBeVisible();
  });

  // ------------------------------------------------------------------- Test 2
  test("Test 2: the root path redirects to /dashboard", async ({ page }) => {
    await loginAndLand(page, SUPERADMIN_EMAIL);
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "仪表盘" })).toBeVisible();
  });

  test("Test 2b: the sidebar Dashboard link reaches /dashboard", async ({ page }) => {
    await loginAndLand(page, SUPERADMIN_EMAIL);
    await openNav(page, "用户");
    await expect(page).toHaveURL(/\/users$/);
    await openNav(page, "仪表盘");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  // -------------------------------------------------------------- Test 4 & 5
  test("Test 4-5: all eight KPI cards render, including the three status counts", async ({
    page,
  }) => {
    await loginAndLand(page, SUPERADMIN_EMAIL);

    for (const label of [
      "用户总数",
      "正常账号",
      "已暂停",
      "已封禁",
      "今日新增",
      "7 日新增",
      "待处理举报",
      "在线管理员",
    ]) {
      // Exactly one card per label, and visible. A card that hid itself at zero
      // would fail here rather than silently disappearing.
      await expect(kpiCard(page, label)).toHaveCount(1);
      await expect(kpiCard(page, label)).toBeVisible();
    }
  });

  // ---------------------------------------------------------------- Test 6
  test("Test 6: every KPI matches the database, and a zero still renders", async ({ page }) => {
    await loginAndLand(page, SUPERADMIN_EMAIL);

    await expectKpi(page, "用户总数", expected.users);
    await expectKpi(page, "正常账号", expected.active);
    await expectKpi(page, "已暂停", expected.suspended);
    await expectKpi(page, "已封禁", expected.banned);
    await expectKpi(page, "今日新增", expected.todayNewUsers);
    await expectKpi(page, "7 日新增", expected.newUsers7d);
    await expectKpi(page, "待处理举报", expected.reportsOpen);
    // `admins` must come from AdminUser.isActive, not User.isAdmin.
    await expectKpi(page, "在线管理员", expected.admins);

    // The zero case is asserted explicitly rather than left to chance: such a
    // card is visible and reads "0" instead of being hidden or left blank.
    const statusPairs: Array<[string, number]> = [
      ["已暂停", expected.suspended],
      ["已封禁", expected.banned],
    ];
    for (const [label, value] of statusPairs.filter(([, count]) => count === 0)) {
      const card = kpiCard(page, label);
      await expect(card).toBeVisible();
      await expect(card.locator("p").first()).toHaveText("0");
    }
  });

  test("the status split adds up to the total, so no user is uncounted", async ({ page }) => {
    await loginAndLand(page, SUPERADMIN_EMAIL);
    const total = await prisma.user.count();
    const byStatus = await prisma.user.groupBy({ by: ["status"], _count: { _all: true } });
    const summed = byStatus.reduce((acc, row) => acc + row._count._all, 0);
    expect(summed).toBe(total);
    await expectKpi(page, "用户总数", total);
  });

  // ------------------------------------------------------------------- Test 7
  test("Test 7: the recent-audit section exists and lists the seeded entries", async ({ page }) => {
    await loginAndLand(page, SUPERADMIN_EMAIL);
    await expect(page.getByRole("heading", { name: "最近审计" })).toBeVisible();
    await expect(
      section(page, "最近审计").getByText("PW_AUDIT_UI_HUMAN_ACTION", { exact: true }),
    ).toBeVisible();
  });

  // -------------------------------------------------------------- Test 8 & 9
  test("Test 8-9: a SYSTEM row renders 系统 · 自动 and never a null admin id", async ({ page }) => {
    await loginAndLand(page, SUPERADMIN_EMAIL);

    const action = section(page, "最近审计").getByText("PW_AUDIT_UI_SYSTEM_ACTION", {
      exact: true,
    });
    await expect(action).toBeVisible();
    const card = action.locator("..");

    await expect(card.getByText("系统 · 自动")).toBeVisible();
    // The regression this guards: rendering `adminId` for a row that has none.
    await expect(card).not.toContainText("admin ");
    await expect(card).not.toContainText("null");
    await expect(card).not.toContainText("undefined");
    // A batch machine action has no single target.
    await expect(card).toContainText("target -");
  });

  test("Test 9b: the human audit row still names its administrator", async ({ page }) => {
    await loginAndLand(page, SUPERADMIN_EMAIL);

    const admin = await prisma.adminUser.findFirst({
      where: { user: { email: SUPERADMIN_EMAIL } },
      select: { userId: true },
    });
    const card = section(page, "最近审计")
      .getByText("PW_AUDIT_UI_HUMAN_ACTION", { exact: true })
      .locator("..");
    await expect(card).toContainText(`admin ${admin!.userId.slice(0, 8)}`);
    await expect(card).not.toContainText("系统");
  });

  test("the system-events section renders the SYSTEM row as 系统 · 自动", async ({ page }) => {
    await loginAndLand(page, SUPERADMIN_EMAIL);

    const events = section(page, "系统自动事件");
    await expect(events).toBeVisible();
    await expect(events).toContainText("PW_AUDIT_UI_SYSTEM_ACTION");
    await expect(events).toContainText("系统 · 自动");
    // This feed is SYSTEM by definition — it must never name an administrator.
    await expect(events).not.toContainText("admin ");
  });

  // ------------------------------------------------------------------ Test 10
  test("Test 10: every list section shows an explicit empty state when it has no rows", async ({
    page,
  }) => {
    // Force all three feeds empty at the API boundary, which is the only way to
    // reach the empty branch deterministically — the database may legitimately
    // have rows in any of them.
    await loginAndLand(page, SUPERADMIN_EMAIL);
    await page.route("**/admin/dashboard", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            users: 0,
            active: 0,
            suspended: 0,
            banned: 0,
            activeToday: 0,
            todayNewUsers: 0,
            newUsers7d: 0,
            messagesToday: 0,
            connections: 0,
            reportsOpen: 0,
            admins: 0,
            recentAudit: [],
            recentResolvedReports: [],
            recentSystemEvents: [],
          },
        }),
      });
    });

    await page.goto("/dashboard");

    // Three sections, three explicit empty states — not a blank gap, and not a
    // spinner that never resolves.
    await expect(page.getByText("暂无数据", { exact: true })).toHaveCount(3);
    await expect(page.getByText("加载中…")).toHaveCount(0);

    // Zeroed KPIs still render rather than collapsing the grid.
    await expectKpi(page, "用户总数", 0);
    await expectKpi(page, "已暂停", 0);
    await expectKpi(page, "待处理举报", 0);
  });

  // ------------------------------------------------------------------ Test 11
  test("Test 11: refresh re-fetches the dashboard in place without a page reload", async ({
    page,
  }) => {
    await loginAndLand(page, SUPERADMIN_EMAIL);

    let dashboardRequests = 0;
    page.on("request", (request) => {
      if (request.url().includes("/admin/dashboard")) dashboardRequests += 1;
    });
    // A full reload would re-request the shell's identity endpoint too.
    let identityRequests = 0;
    page.on("request", (request) => {
      if (request.url().includes("/admin/me")) identityRequests += 1;
    });

    const refresh = page.getByRole("button", { name: "刷新", exact: true });
    await expect(refresh).toBeEnabled();
    await refresh.click();

    await expect(refresh).toBeEnabled();
    expect(dashboardRequests).toBe(1);
    // No navigation happened: the shell was never re-mounted.
    expect(identityRequests).toBe(0);
    await expect(page.getByRole("heading", { name: "仪表盘" })).toBeVisible();
  });

  test("Test 11b: the refresh button is disabled while a request is in flight", async ({
    page,
  }) => {
    await loginAndLand(page, SUPERADMIN_EMAIL);

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/admin/dashboard", async (route) => {
      await gate;
      await route.continue();
    });

    await page.getByRole("button", { name: "刷新", exact: true }).click();
    // In flight: the button reports progress and cannot be clicked again.
    await expect(page.getByRole("button", { name: "刷新中…", exact: true })).toBeDisabled();

    release();
    await expect(page.getByRole("button", { name: "刷新", exact: true })).toBeEnabled();
  });

  // ------------------------------------------------------------- Test 12 & 13
  test("Test 12-13: a failed request shows an error and retry recovers", async ({ page }) => {
    await loginAndLand(page, SUPERADMIN_EMAIL);

    let failing = true;
    await page.route("**/admin/dashboard", async (route) => {
      if (failing) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            success: false,
            error: { code: "INTERNAL_ERROR", message: "服务暂时不可用" },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/dashboard");

    // Error UI, and no misleading content behind it.
    await expect(page.getByText("服务暂时不可用")).toBeVisible();
    await expect(page.getByRole("button", { name: "重试", exact: true })).toBeVisible();
    await expect(page.getByText("加载中…")).toHaveCount(0);
    await expect(kpiCard(page, "用户总数")).toHaveCount(0);

    // Retry hits the same endpoint and recovers into real content.
    failing = false;
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(page.getByText("服务暂时不可用")).toHaveCount(0);
    await expectKpi(page, "用户总数", expected.users);
  });

  // ------------------------------------------------------- Test 14 (PC-2.5.6)
  test("Test 14: the resolved-reports feed names the target of each report", async ({
    page,
  }) => {
    // Before PC-2.5.6 the feed selected no `momentId`, so a report about a
    // moment rendered identically to a report about a person — a false
    // statement about what had been reviewed.
    await loginAndLand(page, SUPERADMIN_EMAIL);

    const feed = section(page, "最近举报处理");
    await expect(feed).toBeVisible();

    const momentRow = feed.locator('[data-report-id="' + reportFixtures.momentReportId + '"]');
    await expect(momentRow).toBeVisible();
    await expect(momentRow).toHaveAttribute("data-target-type", "MOMENT");
    await expect(momentRow.getByTestId("dashboard-report-target")).toHaveText("动态举报");
    // The negative half is the real assertion: before the fix this row claimed
    // 用户举报, which is a false statement about what had been reviewed.
    await expect(momentRow).not.toContainText("用户举报");

    const messageRow = feed.locator('[data-report-id="' + reportFixtures.messageReportId + '"]');
    await expect(messageRow).toHaveAttribute("data-target-type", "MESSAGE");
    await expect(messageRow.getByTestId("dashboard-report-target")).toHaveText("消息举报");

    const userRow = feed.locator('[data-report-id="' + reportFixtures.userReportId + '"]');
    await expect(userRow).toHaveAttribute("data-target-type", "USER");
    await expect(userRow.getByTestId("dashboard-report-target")).toHaveText("用户举报");
  });

  test("Test 13b: an unauthenticated dashboard load is sent to the login screen", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });
});
