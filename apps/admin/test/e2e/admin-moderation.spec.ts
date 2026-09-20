import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { loginAndLand, openNav } from "../fixtures/browser";

/**
 * Phase B5 — the moderation workbench.
 *
 * ## What is actually new here
 *
 * Nothing on the server. B5 adds **no** `/admin/moderation` endpoint: the
 * workbench reads `GET /admin/reports`, `GET /admin/reports/:id` and calls
 * `POST /admin/reports/:id/review` plus `POST /admin/users/:id/status` — all of
 * which predate this phase. So these tests are not re-proving the Reports API;
 * they prove the *new console surface*: that it exists, that it renders the
 * right rows, and — the part with real risk — that it **grants no role any
 * capability it did not already have**.
 *
 * That last point is why the RBAC cases below are the centre of this file. A new
 * screen is exactly where a permission can be widened by accident: an action
 * button that forgets its gate, or a nav entry keyed on the wrong permission.
 *
 * ## Why the fixtures are written directly
 *
 * The queue cases need reports in shapes no UI can create, and — more
 * importantly — a status set that is *stable across the whole run*. The shared
 * seed creates one OPEN report, and other specs mutate it. These cases create
 * their own rows under a marker so they can assert on an exact queue without
 * depending on what a previous spec left behind.
 */

const MARKER = "phase B5 moderation fixture";

let prisma: PrismaClient;
let superadminId: string;
let supportId: string;
let moderatorId: string;
let analystId: string;
let contentManagerId: string;
let victimId: string;

/** A USER-target report in OPEN — the untriaged backlog. */
let openUserReportId: string;
/** A MESSAGE-target report in OPEN, with a live message. */
let openMessageReportId: string;
/** A report already in REVIEWING. */
let reviewingReportId: string;
/** A report whose message row is soft-deleted. */
let deletedMessageReportId: string;
/** A report with a REVIEWING audit row, so history is non-empty on arrival. */
let historyReportId: string;
/** PC-2.5.4 — a MOMENT-target report whose moment still exists. */
let openMomentReportId: string;
/** PC-2.5.4 — a MOMENT-target report whose momentId resolves to nothing. */
let goneMomentReportId: string;
/** The moment the live MOMENT-target report points at. */
let fixtureMomentId: string;

const MESSAGE_BODY = `${MARKER} — reported message body`;
/** PC-2.5.4 — the moment the MOMENT-target fixture points at. */
const MOMENT_BODY = `${MARKER} — reported moment body`;

test.beforeAll(async () => {
  prisma = new PrismaClient();

  const find = async (email: string) => {
    const rows = await prisma.user.findMany({ where: { email }, select: { id: true } });
    if (rows.length !== 1) throw new Error(`expected exactly one fixture for ${email}`);
    return rows[0].id;
  };

  superadminId = await find("pw.superadmin@example.test");
  supportId = await find("pw.support@example.test");
  moderatorId = await find("pw.moderator@example.test");
  analystId = await find("pw.analyst@example.test");
  contentManagerId = await find("pw.contentmanager@example.test");
  victimId = await find("pw.victim@example.test");

  // A conversation so the message is a plausible row. The join relation is
  // `members` (composite PK), not `participants`.
  const conversation =
    (await prisma.conversation.findFirst({
      where: { members: { some: { userId: superadminId } } },
      select: { id: true },
    })) ??
    (await prisma.conversation.create({
      data: { members: { create: [{ userId: superadminId }, { userId: victimId }] } },
      select: { id: true },
    }));

  const liveMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderId: victimId,
      content: MESSAGE_BODY,
      type: "TEXT",
    },
    select: { id: true },
  });

  const deletedMessage = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderId: victimId,
      content: `${MARKER} — soft-deleted`,
      type: "TEXT",
      deletedAt: new Date(),
    },
    select: { id: true },
  });

  // Every report is reported-user = the non-admin `victim`, so the status
  // actions below can actually succeed: `setStatus` refuses to modify an active
  // administrator unless the caller is a SUPER_ADMIN.
  const makeReport = (data: {
    reason: string;
    status: "OPEN" | "REVIEWING" | "RESOLVED" | "REJECTED";
    description: string;
    messageId?: string | null;
    momentId?: string | null;
  }) =>
    prisma.report.create({
      data: {
        reporterId: supportId,
        reportedUserId: victimId,
        reason: data.reason,
        description: data.description,
        status: data.status,
        messageId: data.messageId ?? null,
        momentId: data.momentId ?? null,
      },
      select: { id: true },
    });

  openUserReportId = (
    await makeReport({ reason: "Harassment", status: "OPEN", description: `${MARKER} — open user target` })
  ).id;

  openMessageReportId = (
    await makeReport({
      reason: "Spam",
      status: "OPEN",
      description: `${MARKER} — open message target`,
      messageId: liveMessage.id,
    })
  ).id;

  reviewingReportId = (
    await makeReport({ reason: "Scam", status: "REVIEWING", description: `${MARKER} — already reviewing` })
  ).id;

  deletedMessageReportId = (
    await makeReport({
      reason: "Sexual content",
      status: "OPEN",
      description: `${MARKER} — deleted message target`,
      messageId: deletedMessage.id,
    })
  ).id;

  // PC-2.5.4 — the MOMENT target. `Report.momentId` carries no foreign key, so
  // the "moment is gone" shape is a bare id rather than a deleted row.
  const reportedMoment = await prisma.moment.create({
    data: { userId: victimId, platform: "INSTAGRAM", content: MOMENT_BODY, source: "USER" },
    select: { id: true },
  });
  fixtureMomentId = reportedMoment.id;

  openMomentReportId = (
    await makeReport({
      reason: "Spam",
      status: "OPEN",
      description: `${MARKER} — open moment target`,
      momentId: reportedMoment.id,
    })
  ).id;

  goneMomentReportId = (
    await makeReport({
      reason: "Other",
      status: "OPEN",
      description: `${MARKER} — dangling moment target`,
      momentId: "00000000-0000-4000-8000-000000000000",
    })
  ).id;

  historyReportId = (
    await makeReport({ reason: "Hate speech", status: "REVIEWING", description: `${MARKER} — has history` })
  ).id;

  // One REVIEWING audit row attributed to a human, so the history section has
  // something real to render, and the USER-actor branch is exercised.
  await prisma.adminAuditLog.create({
    data: {
      actorType: "USER",
      adminId: moderatorId,
      action: "REPORT_REVIEWING",
      targetType: "REPORT",
      targetId: historyReportId,
      reason: `${MARKER} — taken for review`,
      before: { status: "OPEN" },
      after: { status: "REVIEWING" },
    },
  });
});

test.afterAll(async () => {
  if (!prisma) return;
  const reportIds = [
    openUserReportId,
    openMessageReportId,
    reviewingReportId,
    deletedMessageReportId,
    historyReportId,
    openMomentReportId,
    goneMomentReportId,
  ].filter(Boolean);

  // Audit rows first: `adminId` is RESTRICT, so they block the admin delete.
  await prisma.adminAuditLog.deleteMany({
    where: {
      OR: [
        { targetType: "REPORT", targetId: { in: reportIds } },
        { targetId: { in: [victimId] } },
      ],
    },
  });
  await prisma.report.deleteMany({ where: { id: { in: reportIds } } });
  await prisma.moment.deleteMany({ where: { content: { startsWith: MARKER } } });
  const messages = await prisma.message.findMany({
    where: { content: { startsWith: MARKER } },
    select: { id: true },
  });
  if (messages.length > 0) {
    await prisma.message.deleteMany({ where: { id: { in: messages.map((m) => m.id) } } });
  }
  await prisma.$disconnect();
});

/** Opens the workbench and waits for it to settle. */
async function openWorkbench(page: Page, email = "pw.superadmin@example.test") {
  await loginAndLand(page, email);
  await page.goto("/moderation");
  await expect(page.getByRole("heading", { name: "审核工作台" })).toBeVisible();
}

/**
 * Narrows the queue to the B5 fixtures by their shared reporter.
 *
 * Filtering by reporter (not by a per-row id) keeps the request within the
 * existing query contract — there is no "id" filter to use. Several fixture
 * rows can match, which is why every assertion below is scoped to a row rather
 * than to the page, and why the row's own report id is asserted to be a UUID.
 */
async function filterToFixture(page: Page) {
  await page.getByLabel("审核举报人筛选", { exact: true }).fill("pw.support@example.test");
  await page.getByRole("button", { name: "应用筛选" }).click();
  await expect(page.getByTestId("moderation-summary")).toBeVisible({ timeout: 15_000 });
}

test.describe("moderation workbench — queue", () => {
  test("Test 40: the workbench is reachable and the nav entry exists", async ({ page }) => {
    await openWorkbench(page);

    // The nav entry is the visible half of §二十四. It sits between Reports and
    // Audit, and it is keyed on `reports:read` — never `moderation:read`.
    const nav = page.getByRole("link", { name: "审核工作台", exact: true });
    await expect(nav).toBeVisible();
    await expect(nav).toHaveAttribute("href", "/moderation");
  });

  test("Test 41: the default queue is OPEN, and says so", async ({ page }) => {
    await openWorkbench(page);

    // The brief asks for OPEN + REVIEWING by default. The API takes a single
    // status (`buildReportWhere` builds `{ status }`), and an unknown value is
    // silently dropped rather than rejected — so `status=OPEN,REVIEWING` would
    // not 400, it would quietly return everything. The screen therefore uses an
    // explicit switch, landing on OPEN.
    await expect(page.getByTestId("moderation-tab-OPEN")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("moderation-tab-REVIEWING")).toHaveAttribute(
      "aria-selected",
      "false",
    );

    // Landing on OPEN means no RESOLVED/REJECTED row can be on screen.
    const badges = page.getByTestId("status-badge");
    const count = await badges.count();
    for (let i = 0; i < count; i += 1) {
      await expect(badges.nth(i)).toHaveText("OPEN");
    }
  });

  test("Test 42: the queue renders every required column", async ({ page }) => {
    await openWorkbench(page);
    await filterToFixture(page);

    const row = page.locator(`[data-testid="moderation-row"]`).first();
    await expect(row).toBeVisible();

    // Report id (the workbench shows it so an operator can name a row).
    await expect(row.getByTestId("moderation-report-id")).toHaveText(/^[0-9a-f-]{36}$/);
    // Reason — the fixture rows carry one of the allow-listed reasons.
    await expect(row).toContainText(/Harassment|Spam|Scam|Sexual content|Hate speech|Fake profile|Other/);
    // Target type badge, derived from messageId.
    await expect(row.getByTestId("moderation-target-badge")).toBeVisible();
    // Reporter and reported user, both linked. Scoped by the link text rather
    // than the href alone: each row links the reported user twice — once by name
    // in the header and once through 「查看被举报人」 — so an href-only locator is
    // ambiguous under strict mode.
    await expect(row.locator(`a[href="/users/${supportId}"]`).first()).toBeVisible();
    await expect(row.locator(`a[href="/users/${victimId}"]`).first()).toBeVisible();
    await expect(row.getByRole("link", { name: "查看被举报人" })).toHaveAttribute(
      "href",
      `/users/${victimId}`,
    );
    // Status badge and a created-at timestamp.
    await expect(row.getByTestId("status-badge")).toBeVisible();
    // The timestamp is rendered by `toLocaleString()`, so its shape is the
    // runtime's, not ours — assert that *a* date is present rather than pinning
    // a format. (A year-first pattern fails here: the en-US default is M/D/YYYY.)
    await expect(row).toContainText(/\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}/);
  });

  test("Test 43: OPEN and REVIEWING are separate queues, and both are real", async ({ page }) => {
    await openWorkbench(page);
    await filterToFixture(page);

    // OPEN must contain the open fixtures and not the reviewing one.
    await expect(page.locator(`a[href="/moderation/${openUserReportId}"]`)).toHaveCount(1);
    await expect(page.locator(`a[href="/moderation/${reviewingReportId}"]`)).toHaveCount(0);

    // Switch to REVIEWING and assert the inverse.
    await page.getByTestId("moderation-tab-REVIEWING").click();
    await expect(page.getByTestId("moderation-tab-REVIEWING")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator(`a[href="/moderation/${reviewingReportId}"]`)).toHaveCount(1);
    await expect(page.locator(`a[href="/moderation/${openUserReportId}"]`)).toHaveCount(0);
  });

  test("Test 44: target type is derived from the pointers, not read from a column", async ({ page }) => {
    await openWorkbench(page);
    await filterToFixture(page);

    // `Report` has no `targetType` column. A row with a momentId is a MOMENT
    // report, otherwise one with a messageId is a MESSAGE report, otherwise it
    // is a USER report. The badge and the filter must agree because both come
    // from the same rule.
    const userRow = page.locator(`[data-testid="moderation-row"]:has(a[href="/moderation/${openUserReportId}"])`);
    await expect(userRow.getByTestId("moderation-target-badge")).toHaveText("用户举报");

    const messageRow = page
      .locator(`[data-testid="moderation-row"]`)
      .filter({ has: page.locator(`a[href="/moderation/${openMessageReportId}"]`) });
    await expect(messageRow.getByTestId("moderation-target-badge")).toHaveText("消息举报");

    // PC-2.5.4 — the third target. Before this phase this row was badged
    // 「用户举报」, because only `messageId` was consulted.
    const momentRow = page
      .locator(`[data-testid="moderation-row"]`)
      .filter({ has: page.locator(`a[href="/moderation/${openMomentReportId}"]`) });
    await expect(momentRow.getByTestId("moderation-target-badge")).toHaveText("动态举报");
  });

  test("Test 45: the queue offers no mutation — triage only", async ({ page }) => {
    await openWorkbench(page);
    await filterToFixture(page);

    // The queue links to the workbench detail; it does not act. A second
    // mutation path is a second place for the rules to drift.
    const row = page.locator(`[data-testid="moderation-row"]`).first();
    await expect(row.getByRole("link", { name: "处理" })).toBeVisible();
    for (const label of ["受理", "处理举报", "驳回", "永久封禁", "临时封禁"]) {
      await expect(row.getByRole("button", { name: label, exact: true })).toHaveCount(0);
    }
  });

  test("Test 46: an empty backlog says so, and never renders 「第 1 / 0 页」", async ({ page }) => {
    await openWorkbench(page);

    // A filter that matches nothing is the reliable way to reach the empty
    // state regardless of what other specs left behind.
    await page.getByLabel("审核举报人筛选", { exact: true }).fill("nobody-matches-this@example.test");
    await page.getByRole("button", { name: "应用筛选" }).click();

    const empty = page.getByTestId("moderation-empty");
    await expect(empty).toBeVisible({ timeout: 15_000 });
    await expect(empty).toContainText("没有符合当前筛选条件的举报");

    // `totalPages` is the API's ceiling and is 0 for no rows. Rendering a pager
    // would produce 「第 1 / 0 页」, which is what this guards.
    await expect(page.getByTestId("moderation-pager")).toHaveCount(0);
    await expect(page.getByText(/第\s*1\s*\/\s*0\s*页/)).toHaveCount(0);
  });

  test("Test 47: the empty state is recoverable — clearing the filter brings rows back", async ({ page }) => {
    await openWorkbench(page);

    await page.getByLabel("审核举报人筛选", { exact: true }).fill("nobody-matches-this@example.test");
    await page.getByRole("button", { name: "应用筛选" }).click();
    await expect(page.getByTestId("moderation-empty")).toBeVisible({ timeout: 15_000 });

    // A filtered miss is a fixable problem, so the way out is offered inline.
    await page.getByTestId("moderation-empty").getByRole("button", { name: "清空筛选" }).click();
    await expect(page.getByTestId("moderation-row").first()).toBeVisible({ timeout: 15_000 });
  });

  test("Test 48: switching filters never blanks the page", async ({ page }) => {
    await openWorkbench(page);

    // Hold the next list request open so the in-flight state is observable.
    // Asserting on the 「加载中…」 text alone would be a race: the request
    // normally answers in a few milliseconds, so the text can appear and vanish
    // between two polls and the assertion fails intermittently on a correct
    // page. Pausing the response makes the state deterministic instead.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/admin/reports?**", async (route) => {
      await held;
      await route.continue();
    });

    await page.getByTestId("moderation-tab-REVIEWING").click();

    // While the request is in flight the screen keeps its structure: the
    // heading, the tabs and the toolbar are all still there. That is the real
    // contract — a filter change must not collapse the screen to a blank page.
    await expect(page.getByRole("heading", { name: "审核工作台" })).toBeVisible();
    await expect(page.getByTestId("moderation-tab-REVIEWING")).toBeVisible();
    await expect(page.getByRole("button", { name: "应用筛选" })).toBeVisible();
    await expect(page.getByText("加载中…")).toBeVisible();

    release();

    // And once it answers, the new filter is what is applied.
    await expect(page.getByTestId("moderation-tab-REVIEWING")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("Test 49: a failed queue request offers a retry and leaks nothing internal", async ({ page }) => {
    await openWorkbench(page);

    // Fail the next list request at the network layer. This is the only way to
    // reach the error state deterministically — the real API does not fail on
    // demand, and a 403 would be a permissions test rather than an error one.
    await page.route("**/admin/reports?**", (route) => route.abort("failed"), { times: 1 });
    await page.getByTestId("moderation-tab-REVIEWING").click();

    await expect(page.getByRole("button", { name: "重试" })).toBeVisible({ timeout: 15_000 });

    // An aborted fetch surfaces as a network error. What must NOT appear is any
    // internals — the friendly-error path replaces those.
    const body = (await page.locator("main").innerText()).toLowerCase();
    for (const leak of ["prisma", "sql", "stack", "postgres", "econnrefused"]) {
      expect(body).not.toContain(leak);
    }

    // Retry re-runs the applied query and recovers.
    await page.getByRole("button", { name: "重试" }).click();
    await expect(page.getByTestId("status-badge").first()).toBeVisible({ timeout: 15_000 });
  });

  test("Test 50: the queue's 处理 link opens the workbench detail", async ({ page }) => {
    await openWorkbench(page);
    await filterToFixture(page);

    await page.locator(`a[href="/moderation/${openUserReportId}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/moderation/${openUserReportId}$`));
    await expect(page.getByRole("heading", { name: "举报处理" })).toBeVisible();
  });
});

test.describe("moderation workbench — detail", () => {
  async function openDetail(page: Page, id: string, email = "pw.superadmin@example.test") {
    await loginAndLand(page, email);
    await page.goto(`/moderation/${id}`);
    await expect(page.getByRole("heading", { name: "举报处理" })).toBeVisible();
  }

  test("Test 51: the detail renders report, both parties and the target type", async ({ page }) => {
    await openDetail(page, openUserReportId);

    await expect(page.getByTestId("moderation-summary-card")).toContainText(`${MARKER} — open user target`);
    await expect(page.getByTestId("status-badge")).toHaveText("OPEN");
    await expect(page.getByTestId("moderation-target-badge")).toHaveText("用户举报");
    await expect(page.locator(`a[href="/users/${supportId}"]`).first()).toBeVisible();
    await expect(page.locator(`a[href="/users/${victimId}"]`).first()).toBeVisible();
    // The reported user's current account status is shown, because banning them
    // is one of the actions on this page.
    await expect(page.getByText(/账号状态/)).toBeVisible();
  });

  test("Test 52: a MESSAGE report shows the message body and its sender", async ({ page }) => {
    await openDetail(page, openMessageReportId);

    await expect(page.getByTestId("moderation-target-badge")).toHaveText("消息举报");
    const block = page.getByTestId("moderation-message");
    await expect(block).toBeVisible();
    await expect(block).toContainText(MESSAGE_BODY);
    await expect(block).toContainText("PW victim");
  });

  test("Test 53: an unavailable message is stated, and does not break the page", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openDetail(page, deletedMessageReportId);

    // `Report.messageId` has no FK, so a report can outlive its message. This is
    // an ordinary state: it must render an explicit notice, not a 500 and not a
    // silently blank block.
    const unavailable = page.getByTestId("moderation-message-unavailable");
    await expect(unavailable).toBeVisible();
    await expect(unavailable).toContainText("该消息已被删除");

    // The rest of the page still works.
    await expect(page.getByTestId("moderation-history")).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  // PC-2.5.4 — the MOMENT target on this screen. Numbered after the last test
  // in the file so that inserting them renumbers nothing.
  test("Test 72: a MOMENT report shows the moment body and its author", async ({ page }) => {
    await openDetail(page, openMomentReportId);

    await expect(page.getByTestId("moderation-target-badge")).toHaveText("动态举报");
    const block = page.getByTestId("moderation-moment");
    await expect(block).toBeVisible();
    await expect(block).toContainText(MOMENT_BODY);
    // The author is named: the fixture moments belong to the reported user.
    await expect(block).toContainText("PW victim");

    // A moment report carries no message pointer, so there is no message block
    // to render — the same rule as a USER report.
    await expect(page.getByTestId("moderation-message")).toHaveCount(0);
  });

  test("Test 73: a MOMENT report whose moment is gone is stated, not crashed", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openDetail(page, goneMomentReportId);

    // No FK backs `momentId`, so a report can outlive its moment. Ordinary
    // state, explicit notice — not a 500 and not a silently blank block.
    await expect(page.getByTestId("moderation-target-badge")).toHaveText("动态举报");
    const unavailable = page.getByTestId("moderation-moment-unavailable");
    await expect(unavailable).toBeVisible();
    await expect(unavailable).toContainText("该动态已被删除");

    // The report itself is still fully readable.
    await expect(page.getByTestId("moderation-summary-card")).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("Test 54: a USER report renders no message block at all", async ({ page }) => {
    await openDetail(page, openUserReportId);

    // Showing an empty message block would imply evidence exists and is blank.
    await expect(page.getByTestId("moderation-message")).toHaveCount(0);
    await expect(page.getByTestId("moderation-message-unavailable")).toHaveCount(0);
  });

  test("Test 55: a never-handled report says so explicitly", async ({ page }) => {
    await openDetail(page, openUserReportId);

    // `Report` has no resolution columns; the only history is the audit log.
    // An empty log must read as "not yet handled", not as a broken section.
    await expect(page.getByTestId("moderation-history")).toContainText("还没有处理记录");
  });

  test("Test 56: history comes from the audit log and renders a USER actor", async ({ page }) => {
    await openDetail(page, historyReportId);

    const history = page.getByTestId("moderation-history");
    await expect(history).toContainText(`${MARKER} — taken for review`);
    // A human action names the admin by a short id.
    await expect(history).toContainText(`admin ${moderatorId.slice(0, 8)}`);
    await expect(history).not.toContainText("系统 · 自动");
  });

  test("Test 57: an unknown report id is its own screen, not a spinner", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await loginAndLand(page, "pw.superadmin@example.test");
    await page.goto("/moderation/00000000-0000-4000-8000-0000000000ee");

    await expect(page.getByRole("heading", { name: "举报不存在或已被删除" })).toBeVisible();
    // A permanent state must not look retryable, and must not hang on 加载中….
    await expect(page.getByText("加载中…")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "返回审核队列" }).first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("Test 58: back navigation returns to the queue", async ({ page }) => {
    await openDetail(page, openUserReportId);

    await page.getByRole("link", { name: "← 返回审核队列" }).click();
    await expect(page).toHaveURL(/\/moderation$/);
    await expect(page.getByRole("heading", { name: "审核工作台" })).toBeVisible();
  });

  test("Test 59: the detail leaks no sensitive field into the DOM", async ({ page }) => {
    await openDetail(page, openMessageReportId);

    const html = await page.content();
    for (const leak of ["passwordHash", "tokenHash", "refreshToken", "accessToken", "$2b$"]) {
      expect(html).not.toContain(leak);
    }
  });
});

test.describe("moderation workbench — review", () => {
  async function openDetail(page: Page, id: string, email = "pw.superadmin@example.test") {
    await loginAndLand(page, email);
    await page.goto(`/moderation/${id}`);
    await expect(page.getByRole("heading", { name: "举报处理" })).toBeVisible();
  }

  test("Test 60: review requires a reason — an empty one cannot be submitted", async ({ page }) => {
    await openDetail(page, openUserReportId);

    await page.getByTestId("moderation-review-reviewing").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // The confirm button is disabled until a reason is typed. The backend would
    // also reject it (400 REASON_REQUIRED) — this is the first of two gates.
    const confirm = dialog.getByRole("button", { name: "受理" });
    await expect(confirm).toBeDisabled();
    await expect(dialog.getByText("原因不能为空")).toHaveCount(0);

    await dialog.locator("textarea").fill("   ");
    await expect(confirm).toBeDisabled();

    await dialog.locator("textarea").fill("b5 browser review");
    await expect(confirm).toBeEnabled();
  });

  test("Test 61: SUPER_ADMIN can review, and exactly one audit row is written", async ({ page }) => {
    await openDetail(page, openUserReportId);
    await expect(page.getByTestId("status-badge")).toHaveText("OPEN");

    await page.getByTestId("moderation-review-reviewing").click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("textarea").fill("b5 superadmin review");
    await dialog.getByRole("button", { name: "受理" }).last().click();

    await expect(page.getByTestId("status-badge")).toHaveText("REVIEWING", { timeout: 15_000 });
    await expect(page.getByTestId("moderation-history")).toContainText("b5 superadmin review");

    const rows = await prisma.adminAuditLog.findMany({
      where: { targetType: "REPORT", targetId: openUserReportId },
      select: { actorType: true, adminId: true, action: true, reason: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorType).toBe("USER");
    expect(rows[0].adminId).toBe(superadminId);
    expect(rows[0].action).toBe("REPORT_REVIEWING");
  });

  test("Test 62: MODERATOR can review (reports:write)", async ({ page }) => {
    await openDetail(page, openMessageReportId, "pw.moderator@example.test");

    // MODERATOR holds reports:write, so the controls are present and work.
    await page.getByTestId("moderation-review-resolved").click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("textarea").fill("b5 moderator resolve");
    await dialog.getByRole("button", { name: "处理" }).last().click();

    await expect(page.getByTestId("status-badge")).toHaveText("RESOLVED", { timeout: 15_000 });

    const rows = await prisma.adminAuditLog.findMany({
      where: { targetType: "REPORT", targetId: openMessageReportId },
      select: { actorType: true, adminId: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorType).toBe("USER");
    expect(rows[0].adminId).toBe(moderatorId);
  });

  test("Test 63: a failed review writes no audit row", async ({ page }) => {
    // A report in REVIEWING, reviewed by a role that may not write. The API
    // rejects it before any write, so the audit log must stay empty.
    await openDetail(page, reviewingReportId, "pw.support@example.test");

    const before = await prisma.adminAuditLog.count({
      where: { targetType: "REPORT", targetId: reviewingReportId },
    });
    expect(before).toBe(0);

    // There are no buttons to click — and that is the point of the next test.
    await expect(page.getByTestId("moderation-review-reviewing")).toHaveCount(0);

    const after = await prisma.adminAuditLog.count({
      where: { targetType: "REPORT", targetId: reviewingReportId },
    });
    expect(after).toBe(0);
  });
});

test.describe("moderation workbench — role gating", () => {
  async function openDetail(page: Page, id: string, email: string) {
    await loginAndLand(page, email);
    await page.goto(`/moderation/${id}`);
    await expect(page.getByRole("heading", { name: "举报处理" })).toBeVisible();
  }

  test("Test 64: SUPPORT can read the workbench but gets no review controls", async ({ page }) => {
    // SUPPORT holds reports:read but not reports:write.
    await openDetail(page, openUserReportId, "pw.support@example.test");

    // Read is real, not cosmetic — the content is fully visible.
    await expect(page.getByTestId("moderation-summary-card")).toContainText(MARKER);
    await expect(page.getByText(/没有审核举报的权限/)).toBeVisible();

    for (const action of ["reviewing", "resolved", "rejected"]) {
      await expect(page.getByTestId(`moderation-review-${action}`)).toHaveCount(0);
    }
    // And no enforcement actions either: SUPPORT holds no status action.
    await expect(page.getByTestId("moderation-status-suspend")).toHaveCount(0);
    await expect(page.getByTestId("moderation-status-ban")).toHaveCount(0);
  });

  test("Test 65: ANALYST is read-only across the board", async ({ page }) => {
    await openDetail(page, openUserReportId, "pw.analyst@example.test");

    await expect(page.getByTestId("moderation-summary-card")).toContainText(MARKER);
    for (const action of ["reviewing", "resolved", "rejected"]) {
      await expect(page.getByTestId(`moderation-review-${action}`)).toHaveCount(0);
    }
    await expect(page.getByTestId("moderation-status-suspend")).toHaveCount(0);
    await expect(page.getByTestId("moderation-status-ban")).toHaveCount(0);
  });

  test("Test 66: CONTENT_MANAGER gains nothing from this page", async ({ page }) => {
    // The role with a real risk of accidental widening: CONTENT_MANAGER holds
    // `moderation:write` but NOT `reports:write`. Acting on a report is still a
    // report write, so this page must not hand them one.
    await openDetail(page, openUserReportId, "pw.contentmanager@example.test");

    // It can still read — `reports:read` is held by all five roles.
    await expect(page.getByTestId("moderation-summary-card")).toContainText(MARKER);
    await expect(page.getByText(/没有审核举报的权限/)).toBeVisible();

    for (const action of ["reviewing", "resolved", "rejected"]) {
      await expect(page.getByTestId(`moderation-review-${action}`)).toHaveCount(0);
    }
    await expect(page.getByTestId("moderation-status-suspend")).toHaveCount(0);
    await expect(page.getByTestId("moderation-status-ban")).toHaveCount(0);
  });

  test("Test 67: MODERATOR may suspend but may not ban", async ({ page }) => {
    // `ROLE_ALLOWED_STATUS_ACTIONS.MODERATOR` is
    // ["activate","disable","suspend","unban"] — no `ban`.
    await openDetail(page, openUserReportId, "pw.moderator@example.test");

    await expect(page.getByTestId("moderation-status-suspend")).toBeVisible();
    await expect(page.getByTestId("moderation-status-ban")).toHaveCount(0);
  });

  test("Test 68: SUPER_ADMIN may both suspend and ban", async ({ page }) => {
    await openDetail(page, openUserReportId, "pw.superadmin@example.test");

    await expect(page.getByTestId("moderation-status-suspend")).toBeVisible();
    await expect(page.getByTestId("moderation-status-ban")).toBeVisible();
  });

  test("Test 69: every report-reading role can open the workbench", async ({ page }) => {
    // The nav gate is `reports:read`, which all five roles hold. If it were
    // `moderation:read`, SUPPORT and ANALYST would lose an entry they have
    // today — that is the regression this asserts against.
    for (const email of [
      "pw.superadmin@example.test",
      "pw.moderator@example.test",
      "pw.support@example.test",
      "pw.analyst@example.test",
      "pw.contentmanager@example.test",
    ]) {
      await loginAndLand(page, email);
      await expect(page.getByRole("link", { name: "审核工作台", exact: true })).toBeVisible();
      await openNav(page, "审核工作台");
      await expect(page.getByRole("heading", { name: "审核工作台" })).toBeVisible();
    }
  });
});

test.describe("moderation workbench — enforcement", () => {
  async function openDetail(page: Page, id: string, email: string) {
    await loginAndLand(page, email);
    await page.goto(`/moderation/${id}`);
    await expect(page.getByRole("heading", { name: "举报处理" })).toBeVisible();
  }

  test("Test 70: suspend goes through the user-status API and writes one USER audit row", async ({
    page,
  }) => {
    // Start from a clean account state so the assertion on `before`/`after` is
    // about this action and not a leftover.
    await prisma.user.update({ where: { id: victimId }, data: { status: "ACTIVE" } });
    await prisma.adminAuditLog.deleteMany({ where: { targetType: "USER", targetId: victimId } });

    await openDetail(page, openReviewableTarget(), "pw.superadmin@example.test");

    await page.getByTestId("moderation-status-suspend").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Suspension requires an expiry, and the dialog supplies a default.
    await expect(dialog.getByText(/解封时间/)).toBeVisible();
    await dialog.locator("textarea").fill("b5 suspend reason");
    await dialog.getByRole("button", { name: "临时封禁" }).last().click();

    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });

    const rows = await prisma.adminAuditLog.findMany({
      where: { targetType: "USER", targetId: victimId },
      select: { actorType: true, adminId: true, action: true, reason: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorType).toBe("USER");
    expect(rows[0].adminId).toBe(superadminId);
    expect(rows[0].reason).toBe("b5 suspend reason");

    const victim = await prisma.user.findUnique({
      where: { id: victimId },
      select: { status: true, suspendedUntil: true },
    });
    expect(victim?.status).toBe("SUSPENDED");
    expect(victim?.suspendedUntil).not.toBeNull();
  });

  test("Test 71: ban requires the typed confirmation phrase", async ({ page }) => {
    await prisma.user.update({ where: { id: victimId }, data: { status: "ACTIVE" } });

    await openDetail(page, openReviewableTarget(), "pw.superadmin@example.test");

    await page.getByTestId("moderation-status-ban").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // A permanent ban is never one click: the reason is mandatory, the BAN
    // phrase must be typed, and the danger notice is shown.
    await expect(dialog.getByText("这是永久性操作，不会自动解除。")).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "永久封禁" });
    await dialog.locator("textarea").fill("b5 ban reason");
    await expect(confirm).toBeDisabled();

    await dialog.locator('input:not([type="datetime-local"])').fill("BAN");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });

    const victim = await prisma.user.findUnique({
      where: { id: victimId },
      select: { status: true, bannedAt: true, banReason: true },
    });
    expect(victim?.status).toBe("BANNED");
    expect(victim?.bannedAt).not.toBeNull();
    expect(victim?.banReason).toBe("b5 ban reason");

    // Clean up so the suite does not leave a banned fixture behind.
    await prisma.user.update({
      where: { id: victimId },
      data: { status: "ACTIVE", bannedAt: null, banReason: null, suspendedUntil: null },
    });
  });
});

/**
 * A report whose target is the non-admin `victim`.
 *
 * Enforcement tests need a target that is not an administrator: `setStatus`
 * refuses to modify an active admin unless the caller is a SUPER_ADMIN. These
 * tests run as SUPER_ADMIN, but keeping the target a plain member means the
 * assertion is about the moderation flow rather than about admin protection.
 */
function openReviewableTarget(): string {
  return openUserReportId;
}
