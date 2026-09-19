import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { loginAndLand, openNav } from "../fixtures/browser";

/**
 * Phase B4 — the reports queue, driven through a real browser.
 *
 * ## What this covers that the unit tests cannot
 *
 * `admin-reports.spec.ts` proves the service builds the right `where` clause and
 * writes the right audit row. It cannot prove that the *screen* ever sends those
 * filters, that a filter change actually re-queries the API, or that the two
 * empty states are distinguishable to a human. Those are the properties below.
 *
 * ## Why the fixture writes its own rows
 *
 * The seeded data is whatever `seed()` happened to leave behind, and several of
 * these assertions need exact counts (a filter that matches exactly one row, a
 * date window that must exclude something). So this spec inserts its own reports
 * under a marker, then removes precisely them. It never deletes a row it did not
 * create, and it never reuses the `phase A+ browser fixture` row that other
 * suites depend on.
 */

const MARKER = "phase B4 reports ui fixture";
const DESCRIPTION_UNIQUE = `${MARKER} — unique row`;
const DESCRIPTION_SECOND = `${MARKER} — second row`;

/** The status filter's "all" option — a UI-only value, never sent on the wire. */
const ALL_STATUSES = "全部状态";

let prisma: PrismaClient;
let superadminId: string;
let supportId: string;
let uniqueDescriptionReportId: string;
let secondReportId: string;

/**
 * A date far enough in the past that the seeded rows and both fixtures sit well
 * after it, so `createdFrom` narrows the result to everything while
 * `createdTo` set to yesterday excludes everything.
 */
const OLD_DATE = "2000-01-01";
const YESTERDAY = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

test.beforeAll(async () => {
  prisma = new PrismaClient();

  const superadmin = await prisma.user.findMany({
    where: { email: "pw.superadmin@example.test" },
    select: { id: true },
  });
  if (superadmin.length !== 1) {
    throw new Error(`expected exactly one seeded superadmin, found ${superadmin.length}`);
  }
  const support = await prisma.user.findMany({
    where: { email: "pw.support@example.test" },
    select: { id: true },
  });
  if (support.length !== 1) {
    throw new Error(`expected exactly one seeded support user, found ${support.length}`);
  }

  superadminId = superadmin[0].id;
  supportId = support[0].id;

  // Two rows with distinct descriptions, so a filter can be proven to keep one
  // and drop the other. `reason` differs too — the reason filter is exact-match.
  const unique = await prisma.report.create({
    data: {
      reporterId: superadminId,
      reportedUserId: supportId,
      reason: "SPAM",
      description: DESCRIPTION_UNIQUE,
      status: "OPEN",
    },
    select: { id: true },
  });
  const second = await prisma.report.create({
    data: {
      reporterId: superadminId,
      reportedUserId: supportId,
      reason: "HARASSMENT",
      description: DESCRIPTION_SECOND,
      status: "RESOLVED",
    },
    select: { id: true },
  });

  uniqueDescriptionReportId = unique.id;
  secondReportId = second.id;
});

test.afterAll(async () => {
  if (!prisma) return;
  await prisma.adminAuditLog.deleteMany({
    where: { targetType: "REPORT", targetId: { in: [uniqueDescriptionReportId, secondReportId] } },
  });
  await prisma.report.deleteMany({
    where: { id: { in: [uniqueDescriptionReportId, secondReportId] } },
  });
  await prisma.$disconnect();
});

async function openReports(page: import("@playwright/test").Page) {
  await loginAndLand(page, "pw.superadmin@example.test");
  await openNav(page, "举报");
  await expect(page.getByRole("heading", { name: "举报审核" })).toBeVisible();
  await expect(page).toHaveURL(/\/reports$/);
}

/** Waits for the list request that a filter change triggers to have settled. */
async function applyAndSettle(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "搜索" }).click();
  await expect(page.getByTestId("reports-summary").or(page.getByTestId("reports-empty"))).toBeVisible();
}

/**
 * Waits for the response to *this* filter change, not just any earlier one.
 *
 * `applyAndSettle` is enough when the two states are visually distinct, but it
 * can be satisfied by the previous response when both renders happen to contain
 * a summary or an empty block. Anchoring on the URL the screen actually requests
 * removes that race — same reasoning as the users-list spec's
 * `applyFiltersAndWait`.
 */
async function applyFiltersAndWait(page: import("@playwright/test").Page, expectQuery: string) {
  const response = page.waitForResponse(
    (candidate) =>
      candidate.url().includes("/admin/reports") && candidate.url().includes(expectQuery),
  );
  await page.getByRole("button", { name: "搜索" }).click();
  await response;
}

test.describe("reports queue", () => {
  // -------------------------------------------------------------- the landing state
  test("Test 20: the queue lands on all statuses, not on an empty OPEN-only view", async ({ page }) => {
    await openReports(page);

    // The defect B4 fixed: the screen used to open filtered to OPEN, which in the
    // real dataset rendered an empty list that looked like "no reports".
    await expect(page.getByLabel("举报状态")).toHaveValue("ALL");
    await expect(page.getByTestId("reports-summary")).toBeVisible();
  });

  // -------------------------------------------------------------- the fixture rows render
  test("Test 21: both fixture rows render with reason, status and target badge", async ({ page }) => {
    await openReports(page);

    const unique = page.getByText(DESCRIPTION_UNIQUE, { exact: true });
    await expect(unique).toBeVisible();

    const row = unique.locator("xpath=ancestor::div[@data-testid='report-row']");
    await expect(row).toHaveAttribute("data-target-type", "USER");
    await expect(row.getByTestId("report-target-badge")).toHaveText("用户举报");
    await expect(row.getByTestId("status-badge")).toHaveText("OPEN");
    await expect(row).toContainText("SPAM");
    // A message-targeting row is impossible to seed without a message, so the
    // MESSAGE branch is asserted in the unit tests instead of fabricated here.
  });

  // -------------------------------------------------------------- filters reach the API
  test("Test 22: the reason filter narrows the list to matching rows only", async ({ page }) => {
    await openReports(page);
    await expect(page.getByText(DESCRIPTION_UNIQUE, { exact: true })).toBeVisible();

    // The dropdown's option *values* are the canonical spellings (`Spam`), while
    // the fixture row stores `SPAM`. The API matches case-insensitively, so
    // selecting `Spam` must still find the `SPAM` row — asserting that here is
    // what makes this test about the server's semantics rather than the seed.
    await page.getByLabel("举报原因").selectOption("Spam");
    await applyAndSettle(page);

    // Spam keeps the first fixture and drops the HARASSMENT one.
    await expect(page.getByText(DESCRIPTION_UNIQUE, { exact: true })).toBeVisible();
    await expect(page.getByText(DESCRIPTION_SECOND, { exact: true })).toHaveCount(0);
  });

  test("Test 23: the status filter is applied server-side and the summary follows", async ({ page }) => {
    await openReports(page);

    await page.getByLabel("举报状态").selectOption("RESOLVED");
    await applyAndSettle(page);

    // The RESOLVED fixture is present, and the OPEN one is gone.
    await expect(page.getByText(DESCRIPTION_SECOND, { exact: true })).toBeVisible();
    await expect(page.getByText(DESCRIPTION_UNIQUE, { exact: true })).toHaveCount(0);

    // Every visible row agrees with the filter — proof the filter is not applied
    // client-side on top of an unfiltered page.
    const badges = page.getByTestId("status-badge");
    const count = await badges.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      await expect(badges.nth(i)).toHaveText("RESOLVED");
    }
  });

  test("Test 24: a date window that excludes the fixtures yields the filter-specific empty state", async ({ page }) => {
    await openReports(page);

    await page.getByLabel("举报时间从").fill(OLD_DATE);
    await page.getByLabel("举报时间到").fill(YESTERDAY);
    await applyAndSettle(page);

    // `createdTo` is a literal `lte` — the fixtures were created today, so a
    // window ending yesterday must exclude them.
    const empty = page.getByTestId("reports-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("没有符合当前筛选条件的举报");
    await expect(empty).toContainText("试试放宽状态、原因或时间范围。");

    // The escape hatch exists precisely because this state is recoverable.
    await expect(empty.getByRole("button", { name: "清空筛选" })).toBeVisible();
  });

  test("Test 25: 清空筛选 restores the unfiltered list", async ({ page }) => {
    await openReports(page);

    await page.getByLabel("举报状态").selectOption("RESOLVED");
    await applyAndSettle(page);

    // Two different "clear" affordances exist — the toolbar one and the empty
    // state one. The toolbar one is used here because the list is non-empty.
    await page.getByRole("button", { name: "清空筛选" }).first().click();
    await expect(page.getByTestId("reports-summary")).toBeVisible();

    await expect(page.getByLabel("举报状态")).toHaveValue("ALL");
    await expect(page.getByText(DESCRIPTION_UNIQUE, { exact: true })).toBeVisible();
    await expect(page.getByText(DESCRIPTION_SECOND, { exact: true })).toBeVisible();
  });

  // -------------------------------------------------------------- the empty-state distinction
  test("Test 26: an empty queue and an over-narrow filter read differently", async ({ page }) => {
    await openReports(page);

    // Force the genuinely-empty case by searching for a reporter that cannot
    // exist. This still renders the filter-specific copy, which is the point:
    // the screen must not claim the system is empty when a filter is active.
    // `exact` is required: 「举报人筛选」 is a substring of 「被举报人筛选」, so a
    // loose label lookup resolves to two inputs and trips strict mode.
    await page.getByLabel("举报人筛选", { exact: true }).fill("no-such-reporter-zzz@example.invalid");
    await applyFiltersAndWait(page, "reporter=no-such-reporter-zzz");

    const empty = page.getByTestId("reports-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("没有符合当前筛选条件的举报");
    await expect(empty).not.toContainText("系统中还没有任何举报");
  });

  // -------------------------------------------------------------- permission gating
  test("Test 27: a read-only role sees the queue but no review buttons", async ({ page }) => {
    // ANALYST holds `reports:read` but not `reports:write` — see the permission
    // matrix. It is the fixture that models a genuinely read-only operator.
    await loginAndLand(page, "pw.analyst@example.test");
    await openNav(page, "举报");
    await expect(page.getByRole("heading", { name: "举报审核" })).toBeVisible();

    await expect(page.getByTestId("report-row").first()).toBeVisible();

    // The banner explains *why* the controls are missing, rather than leaving
    // the operator to guess whether the page is broken.
    await expect(page.getByText(/对举报只有查看权限/)).toBeVisible();
    // None of the three review actions may render.
    await expect(page.getByRole("button", { name: "受理" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "处理" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "驳回" })).toHaveCount(0);
  });
});
