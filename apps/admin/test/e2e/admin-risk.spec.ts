import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { ACCOUNTS, FIXTURE_EMAILS, type SeedIds } from "../fixtures/admin-roles";
import { loginAndLand, openNav } from "../fixtures/browser";

/**
 * Phase C1 — real browser behaviour tests for the Risk Center.
 *
 * ## What this suite is for
 *
 * The Risk Center is an **overview of facts already stored in the database**.
 * There is no risk model in this codebase — no `RiskRecord`, no `riskLevel`
 * column, no score — and Phase C's spec forbids adding one. So the interesting
 * things to prove in a browser are not "does the maths work" but:
 *
 *   1. The page shows the four sections it claims to show, and it renders at
 *      all against the real API.
 *   2. **Every number on screen equals a count taken independently from
 *      PostgreSQL.** This is the assertion that actually matters: a KPI that
 *      drifts from the database is the failure mode this screen cannot afford,
 *      because an operator will trust the number. Counted here through Prisma,
 *      deliberately *not* through the page's own endpoint, so the two sides are
 *      genuinely independent.
 *   3. **Zero is displayed, not hidden.** A card that vanished at zero would
 *      make "no suspensions" indistinguishable from "this card is broken".
 *   4. **No invented severity.** `HIGH RISK`, `riskLevel`, `riskScore` must not
 *      appear anywhere on the page — not in a badge, not in a column header.
 *   5. The self-report signal is described neutrally (「待核查异常举报」), never
 *      as a machine flag or an accusation, because the data cannot prove either.
 *   6. RBAC: the nav entry and the page follow `risk:read`, which is held by
 *      SUPER_ADMIN / MODERATOR / ANALYST and *not* by SUPPORT /
 *      CONTENT_MANAGER.
 *
 * ## What this suite is NOT
 *
 * Not the security boundary. A hidden link is a convenience; the API's
 * `PermissionGuard` is the boundary, and it is covered by
 * `apps/api/src/admin/admin-risk.spec.ts` and `scripts/phaseA-rbac-verify.mjs`.
 */

/**
 * Fixtures written directly through Prisma, because no admin endpoint can
 * produce either of them:
 *
 *   - A **self-report** (reporter === reported user) only exists because of a
 *     known latent defect in `SafetyService.recordAutoFlag`. Phase C explicitly
 *     forbids repairing that here, and nothing in the admin API can create the
 *     shape on demand.
 *   - A **SYSTEM audit row** is only ever written by the suspension-expiry
 *     scheduler, which cannot be triggered from a browser.
 *
 * Both are marked with {@link RISK_FIXTURE_PREFIX} so cleanup removes exactly
 * them and can never touch real rows. `AdminAuditLog.action` is `VarChar(64)`,
 * so the prefix stays short.
 */
const RISK_FIXTURE_PREFIX = "PW_RISK_UI_";
const SELF_REPORT_DESCRIPTION = "phase C1 browser fixture — self report";

/** The baselines the by-delta tests measure against. */
type Baselines = {
  /** `Report` rows whose reporter and reported user are the same account. */
  suspiciousSelfReports: number;
  /** Live `User.status` counts, keyed by status. */
  userStatus: Record<string, number>;
  totalReports: number;
};

type FixtureIds = {
  /** A report whose reporter *is* the reported user. */
  selfReportId: string;
  /** An ordinary report, used to prove this suite did not disturb real data. */
  normalReportId: string;
  /** A SYSTEM audit row carrying an action from the real risk vocabulary. */
  systemAuditId: string;
  /** The human audit row that must NOT appear in the risk feed. */
  noteAuditId: string;
};

async function readBaselines(prisma: PrismaClient): Promise<Baselines> {
  const [suspiciousSelfReports, totalReports, grouped] = await Promise.all([
    prisma.report.count({ where: { reporterId: { equals: prisma.report.fields.reportedUserId } } }),
    prisma.report.count(),
    prisma.user.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const userStatus: Record<string, number> = {};
  for (const row of grouped) userStatus[row.status] = row._count._all;

  return { suspiciousSelfReports, totalReports, userStatus };
}

/**
 * Seeds the risk fixtures and returns both their ids and the baselines taken
 * *before* they existed, so every by-delta assertion has something honest to
 * compare against.
 */
async function seedRiskFixtures(prisma: PrismaClient, ids: SeedIds) {
  // Idempotent: a crashed previous run must not leave rows behind.
  await cleanupRiskFixtures(prisma);

  const baselines = await readBaselines(prisma);

  const selfReport = await prisma.report.create({
    data: {
      // The whole point of the fixture: the same account on both sides.
      reporterId: ids.victim,
      reportedUserId: ids.victim,
      reason: "SPAM",
      description: SELF_REPORT_DESCRIPTION,
      status: "OPEN",
    },
    select: { id: true },
  });

  const normalReport = await prisma.report.create({
    data: {
      reporterId: ids.analyst,
      reportedUserId: ids.victim,
      reason: "OTHER",
      description: "phase C1 browser fixture — normal report",
      status: "OPEN",
    },
    select: { id: true },
  });

  // A real action from the risk vocabulary, written as the SYSTEM actor. The
  // database CHECK requires `adminId IS NULL` for SYSTEM rows, so this fixture
  // cannot model an impossible row.
  const systemAudit = await prisma.adminAuditLog.create({
    data: {
      actorType: "SYSTEM",
      adminId: null,
      action: `${RISK_FIXTURE_PREFIX}SYSTEM_ACTION`,
      targetType: "USER",
      targetId: ids.victim,
      before: { status: "SUSPENDED" },
      after: { status: "ACTIVE" },
      detail: "phase C1 browser fixture — machine action",
    },
    select: { id: true },
  });

  // An action that is deliberately NOT risk-relevant. `ADMIN_USER_NOTE` is a
  // real human action, but a note is an annotation, not a state change — the
  // risk feed must filter it out. This row exists to prove that filter is real
  // rather than a claim.
  const noteAudit = await prisma.adminAuditLog.create({
    data: {
      actorType: "USER",
      adminId: ids.superadmin,
      action: "ADMIN_USER_NOTE",
      targetType: "USER",
      targetId: ids.victim,
      detail: "phase C1 browser fixture — note, must not reach the risk feed",
    },
    select: { id: true },
  });

  return {
    baselines,
    fixtureIds: {
      selfReportId: selfReport.id,
      normalReportId: normalReport.id,
      systemAuditId: systemAudit.id,
      noteAuditId: noteAudit.id,
    } satisfies FixtureIds,
  };
}

/** Removes exactly the fixture rows written by {@link seedRiskFixtures}. */
async function cleanupRiskFixtures(prisma: PrismaClient) {
  // By marker first: a SYSTEM audit row has `adminId = null` *and*
  // `targetId = null` in general, so an id-scoped delete is structurally unable
  // to see that class of row. The same reasoning as `cleanupAuditRows`.
  await prisma.adminAuditLog.deleteMany({
    where: { action: { startsWith: RISK_FIXTURE_PREFIX } },
  });
  await prisma.report.deleteMany({
    where: {
      OR: [
        { description: SELF_REPORT_DESCRIPTION },
        { description: "phase C1 browser fixture — normal report" },
      ],
    },
  });
}

test.describe("Phase C1 — Risk Center", () => {
  let prisma: PrismaClient;
  let ids: SeedIds;
  let baselines: Baselines;
  let fixtureIds: FixtureIds;

  test.beforeAll(async () => {
    prisma = new PrismaClient();
    // The global setup already seeded the role accounts; re-read them by email
    // so this suite does not depend on the order the keys were created in.
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

    ({ baselines, fixtureIds } = await seedRiskFixtures(prisma, ids));
  });

  test.afterAll(async () => {
    // The fixtures are test-only and must not survive the run. Asserted rather
    // than assumed, so a leak fails the suite instead of quietly polluting the
    // database for the next phase.
    await cleanupRiskFixtures(prisma);
    const leaked = await prisma.report.count({
      where: { description: SELF_REPORT_DESCRIPTION },
    });
    expect(leaked, "risk fixtures leaked into the database").toBe(0);
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------------ 1
  test("the Risk nav entry is visible to a SUPER_ADMIN", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    await expect(page.getByRole("link", { name: "风险中心", exact: true })).toBeVisible();
  });

  // ------------------------------------------------------------------ 2
  test("the Risk nav entry sits between 审核工作台 and 连接", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    // Order matters: the nav is the console's map, and an entry appearing
    // somewhere unauthorised is how a route nobody reviewed gets shipped. The
    // exhaustive equality check lives in `admin-rbac.spec.ts`; this asserts the
    // position specifically so a failure names the risk entry.
    //
    // Phase C4 added 「屏蔽」, so the list is nine entries: the C2/C3/C4 screens
    // are all gated on permissions this role holds, and none of them may be
    // missing from a SUPER_ADMIN's nav.
    const labels = await page.locator("aside nav a").allTextContents();
    expect(labels.map((s) => s.trim())).toEqual([
      "仪表盘",
      "用户",
      "举报",
      "审核工作台",
      "风险中心",
      "连接",
      "交换",
      "屏蔽",
      "审计日志",
    ]);
  });

  // ------------------------------------------------------------------ 3
  test("the Risk page loads and shows its four sections", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openNav(page, "风险中心");

    await expect(page).toHaveURL(/\/risk$/);
    await expect(page.getByRole("heading", { name: "风险中心" })).toBeVisible();

    for (const title of ["近期举报", "近期管理员处理", "待核查异常举报"]) {
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    }
    // The KPI block is the fourth "section" — asserted by its own test id
    // rather than a heading, because it is a grid of cards, not a titled list.
    await expect(page.getByTestId("risk-kpis")).toBeVisible();
    // And the page must not have surfaced an error.
    await expect(page.getByTestId("risk-error")).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 4
  test("every KPI equals an independent count taken from PostgreSQL", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openNav(page, "风险中心");
    await expect(page.getByTestId("risk-kpis")).toBeVisible();

    // Independently counted here, not read back from the page's own endpoint:
    // comparing the endpoint to itself would pass no matter how wrong both are.
    const [totalReports, open, reviewing, resolved, rejected, grouped] = await Promise.all([
      prisma.report.count(),
      prisma.report.count({ where: { status: "OPEN" } }),
      prisma.report.count({ where: { status: "REVIEWING" } }),
      prisma.report.count({ where: { status: "RESOLVED" } }),
      prisma.report.count({ where: { status: "REJECTED" } }),
      prisma.user.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);
    const users = (status: string) =>
      grouped.find((row) => row.status === status)?._count._all ?? 0;

    const expected: Array<[string, number]> = [
      ["举报总量", totalReports],
      ["待处理举报", open],
      ["审核中举报", reviewing],
      ["已处理举报", resolved],
      ["已驳回举报", rejected],
      ["SUSPENDED", users("SUSPENDED")],
      ["BANNED", users("BANNED")],
      ["DISABLED", users("DISABLED")],
      ["ACTIVE", users("ACTIVE")],
    ];

    // Each card carries a `risk-kpi-${label}` key, so a number is bound to the
    // label it belongs to. Filtering an ancestor `div` by its text does NOT
    // work here: the KPI grid itself contains every label, so `.first()` would
    // return the grid's first card for every assertion — a bug that reads as a
    // data mismatch but is really a locator bug.
    for (const [label, value] of expected) {
      await expect(
        page.getByTestId(`risk-kpi-${label}`).getByTestId("risk-kpi-value"),
        `KPI 「${label}」 does not match the database`,
      ).toHaveText(String(value));
    }
  });

  // ------------------------------------------------------------------ 5
  test("zero is rendered as a value, never hidden", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openNav(page, "风险中心");
    await expect(page.getByTestId("risk-kpis")).toBeVisible();

    // All ten KPIs must be present regardless of their value. This is the
    // contract that makes "no suspensions" readable as data rather than as a
    // broken card.
    await expect(page.getByTestId("risk-kpi-value")).toHaveCount(10);

    // And at least one of them is genuinely zero right now — the database has
    // no suspensions — so a page that hid zero-valued cards would be visible
    // here rather than passing vacuously.
    const suspended = await prisma.user.count({ where: { status: "SUSPENDED" } });
    if (suspended === 0) {
      await expect(page.getByTestId("risk-kpi-SUSPENDED").getByTestId("risk-kpi-value")).toHaveText(
        "0",
      );
    }
  });

  // ------------------------------------------------------------------ 6
  test("the page states that counts are not a risk rating", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openNav(page, "风险中心");

    await expect(page.getByText("不构成风险评级")).toBeVisible();
  });

  // ------------------------------------------------------------------ 7
  test("no invented severity label appears anywhere", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openNav(page, "风险中心");
    await expect(page.getByTestId("risk-kpis")).toBeVisible();

    // The single most important negative assertion in this suite. There is no
    // `riskLevel` column and no scoring algorithm behind this page, so any of
    // these strings would mean a number is being fabricated and shown to an
    // operator as fact.
    const body = (await page.locator("main").innerText()).toLowerCase();
    for (const invented of [
      "high risk",
      "medium risk",
      "low risk",
      "high_risk",
      "risklevel",
      "riskscore",
      "风险评分",
      "风险等级",
      "高风险用户",
    ]) {
      expect(body, `the page invents a severity label: ${invented}`).not.toContain(invented);
    }
  });

  // ------------------------------------------------------------------ 8
  test("the recent reports feed lists rows in created-at descending order", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openNav(page, "风险中心");
    await expect(page.getByTestId("risk-section-近期举报")).toBeVisible();

    // The API orders by createdAt desc and takes 10. Asserting the *order* is
    // what distinguishes a real feed from a list in insertion order, which would
    // look right on a small dataset.
    const expected = await prisma.report.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true },
    });

    const section = page.getByTestId("risk-section-近期举报");
    await expect(section).toBeVisible();

    if (expected.length === 0) {
      await expect(section.getByText("暂无数据")).toBeVisible();
      return;
    }
    // Wait for a real row before reading the list, so the assertion cannot
    // race the fetch and compare against a still-empty section.
    await expect(section.locator(`a[href="/reports/${expected[0].id}"]`)).toBeVisible();

    const links = await section.locator("a[href^='/reports/']").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("href")!.replace("/reports/", "")),
    );
    expect(links).toEqual(expected.map((row) => row.id));
  });

  // ------------------------------------------------------------------ 9
  test("the fixture self-report shows up in 待核查异常举报", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openNav(page, "风险中心");

    const section = page.getByTestId("risk-section-待核查异常举报");
    await expect(section).toBeVisible();
    await expect(section.locator(`a[href="/reports/${fixtureIds.selfReportId}"]`)).toBeVisible();
  });

  // ------------------------------------------------------------------ 10
  test("the self-report row is described neutrally, not as an accusation", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openNav(page, "风险中心");

    const section = page.getByTestId("risk-section-待核查异常举报");
    await expect(section.getByText("举报人与被举报人为同一账号")).toBeVisible();

    // The wording contract from the spec. The row is a *signal awaiting review*;
    // it is not proof of a machine flag and not proof of a malicious account.
    const text = await section.innerText();
    for (const forbidden of ["机器举报", "恶意", "诈骗", "自动举报"]) {
      expect(text, `the self-report section accuses: ${forbidden}`).not.toContain(forbidden);
    }
  });

  // ------------------------------------------------------------------ 11
  test("the suspiciousSelfReports KPI equals its by-delta count", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    // Counted at the moment of the assertion, so the fixture this suite added
    // (one self-report) is included and the number is compared to live state.
    const live = await prisma.report.count({
      where: { reporterId: { equals: prisma.report.fields.reportedUserId } },
    });
    expect(live).toBeGreaterThan(baselines.suspiciousSelfReports);

    await openNav(page, "风险中心");
    await expect(
      page.getByTestId("risk-kpi-待核查异常举报").getByTestId("risk-kpi-value"),
    ).toHaveText(String(live));
  });

  // ------------------------------------------------------------------ 12
  test("the suspiciousSignals feed shows exactly the self-reports", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openNav(page, "风险中心");

    // Wait for the fetch to have produced a listing before reading the DOM.
    // `openNav` returns as soon as the click is dispatched; without this the
    // section is still showing 「暂无数据」 and the read below sees zero links —
    // which reads as a data mismatch but is really a missing wait.
    const section = page.getByTestId("risk-section-待核查异常举报");
    await expect(section).toBeVisible();

    const expected = await prisma.report.findMany({
      where: { reporterId: { equals: prisma.report.fields.reportedUserId } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true },
    });
    // The fixture must be in the SQL result, otherwise the two sides would
    // agree on an empty list and prove nothing.
    expect(expected.length, "the self-report fixture is missing from the database").toBeGreaterThan(
      0,
    );

    // Anchored on the first expected link, so the assertion waits for the row
    // rather than racing it.
    await expect(section.locator(`a[href="/reports/${expected[0].id}"]`)).toBeVisible();

    const links = await section
      .locator("a[href^='/reports/']")
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("href")!.replace("/reports/", "")),
      );
    expect(links).toEqual(expected.map((row) => row.id));

    // The ordinary fixture report must NOT be in this feed — it has two
    // different parties, so including it would make the section meaningless.
    expect(links).not.toContain(fixtureIds.normalReportId);
  });

  // ------------------------------------------------------------------ 13
  test("the recent actions feed shows a SYSTEM row without an administrator", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openNav(page, "风险中心");
    await expect(page.getByTestId("risk-section-近期管理员处理")).toBeVisible();

    // The page maps known actions to Chinese labels and falls back to the raw
    // action. Either is acceptable; what must hold is that a SYSTEM row renders
    // as 「系统 · 自动」 rather than crashing on the NULL adminId.
    const section = page.getByTestId("risk-section-近期管理员处理");
    await expect(section.getByText("系统 · 自动").first()).toBeVisible();
  });

  // ------------------------------------------------------------------ 14
  test("the recent actions feed excludes non-risk actions", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openNav(page, "风险中心");

    // `ADMIN_USER_NOTE` is a real action but not a risk-relevant one, and the
    // fixture writes it against a user who is otherwise all over this page. If
    // the feed showed it, the filter would be decorative.
    const section = page.getByTestId("risk-section-近期管理员处理");
    // Wait for the feed to have rendered something first — reading an unwritten
    // section would pass the negative assertion vacuously.
    await expect(section).toBeVisible();
    await expect(section.getByText("系统 · 自动").first()).toBeVisible();

    const text = await section.innerText();
    expect(text).not.toContain("ADMIN_USER_NOTE");
    expect(text).not.toContain("phase C1 browser fixture — note");
  });

  // ------------------------------------------------------------------ 15
  test("the recent actions feed never exposes ip or userAgent", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    // Asserted at the network layer as well as in the DOM: a value that is
    // fetched but not rendered is still a leak the moment anyone adds a debug
    // panel, so the response body itself is inspected.
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes("/admin/risk") && response.status() === 200,
    );
    await openNav(page, "风险中心");
    const response = await responsePromise;
    const payload = JSON.stringify(await response.json());

    for (const secret of ["passwordHash", "tokenHash", "refreshToken", "accessToken", "userAgent"]) {
      expect(payload, `the risk payload leaks ${secret}`).not.toContain(secret);
    }
    // `ip` is checked as a quoted JSON key rather than a substring, because
    // `description` legitimately contains letters that could form it.
    expect(payload).not.toMatch(/"ip"\s*:/);
  });

  // ------------------------------------------------------------------ 16
  test("a report link leads to the existing report detail screen", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openNav(page, "风险中心");

    // No Risk detail route exists in this phase. The links must reuse the
    // screens that already ship rather than promising a `risk/[id]` page.
    const link = page
      .getByTestId("risk-section-近期举报")
      .locator(`a[href="/reports/${fixtureIds.selfReportId}"]`);
    if ((await link.count()) === 0) {
      await page.getByTestId("risk-section-近期举报").locator("a[href^='/reports/']").first().click();
    } else {
      await link.click();
    }

    await expect(page).toHaveURL(/\/reports\/[0-9a-f-]{36}$/);
  });

  // ------------------------------------------------------------------ 17
  test("no Risk detail route is advertised", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openNav(page, "风险中心");
    await expect(page.getByTestId("risk-kpis")).toBeVisible();

    const hrefs = await page
      .locator("main a")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""));
    for (const href of hrefs) {
      expect(href, "the risk page links to a route this phase did not add").not.toMatch(
        /^\/risk\//,
      );
    }
  });

  // ------------------------------------------------------------------ 18
  test("an ANALYST can read the Risk Center", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.analyst.email);

    // `risk:read` is one of the four permissions an ANALYST holds alongside a
    // read-only console. The page must be reachable and must show no write
    // control — the Risk Center has no mutations at all.
    await expect(page.getByRole("link", { name: "风险中心", exact: true })).toBeVisible();
    await openNav(page, "风险中心");
    await expect(page.getByRole("heading", { name: "风险中心" })).toBeVisible();
    await expect(page.getByTestId("risk-kpis")).toBeVisible();
  });

  // ------------------------------------------------------------------ 19
  test("SUPPORT and CONTENT_MANAGER are not offered the Risk Center", async ({ page }) => {
    // Neither role holds `risk:read`, so the nav entry must be absent. This is
    // presentation only — the API refuses both roles with a 403, which is
    // asserted in `admin-risk.spec.ts` and `scripts/phaseA-rbac-verify.mjs`.
    for (const email of [ACCOUNTS.support.email, ACCOUNTS.contentManager.email]) {
      await loginAndLand(page, email);
      await expect(
        page.getByRole("link", { name: "风险中心", exact: true }),
        `${email} must not be offered the Risk Center`,
      ).toHaveCount(0);
    }
  });

  // ------------------------------------------------------------------ 20
  test("the Risk page is read-only — it writes nothing and reloads nothing", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openNav(page, "风险中心");
    await expect(page.getByTestId("risk-kpis")).toBeVisible();

    // Record how many audit rows exist before refreshing, then refresh, then
    // compare. Phase C is GET-only by design: an overview that wrote an audit
    // row on every view would flood the very log it summarises.
    const before = await prisma.adminAuditLog.count();

    // No full-page reload: the refresh button must re-fetch in place. Detected
    // by watching for a navigation, which a `router.refresh()`/`location.reload`
    // implementation would produce.
    let navigated = false;
    page.once("framenavigated", () => {
      navigated = true;
    });
    await page.getByRole("button", { name: "刷新" }).click();
    await expect(page.getByTestId("risk-kpis")).toBeVisible();
    expect(navigated, "refreshing must not reload the whole page").toBe(false);

    // No mutation control of any kind.
    await expect(page.getByRole("button", { name: /封禁|停用|解封|受理|处理|驳回|删除/ })).toHaveCount(0);

    const after = await prisma.adminAuditLog.count();
    expect(after, "reading the Risk Center must not write an audit row").toBe(before);
  });
});
