import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { loginAndLand } from "../fixtures/browser";

/**
 * Phase B4 — one report, opened directly.
 *
 * ## Why this file exists
 *
 * The queue's spec (`admin-reports-ui.spec.ts`) proves the *list* is right. It
 * cannot prove that the link each row renders actually resolves — every row in
 * it links to `/reports/<id>`, and for most of Phase B4 that route did not
 * exist at all. A queue whose only action 404s is not an audit tool.
 *
 * So these tests navigate to the detail route by id and assert on what it
 * renders, including the two states the API can legitimately produce for a
 * report that has no viewable message.
 *
 * ## Why the fixtures are written directly
 *
 * Three of the cases need a report in a specific shape that no UI path can
 * produce:
 *
 *   - a **MESSAGE** report whose target message still exists (needs a Message
 *     row, and nothing in the admin console creates one);
 *   - a MESSAGE report whose message is **gone** (`Report.messageId` has no FK,
 *     so this is a real, reachable state that no UI can set up);
 *   - a report with **no** `messageId`, i.e. a USER report.
 *
 * PC-2.5.4 adds the third target: a report whose `momentId` is set. Both the
 * "moment still there" and the "moment already deleted" shapes are needed, plus
 * the one row that carries *both* pointers — that last one is the only fixture
 * that can tell the `MOMENT > MESSAGE` priority from a coin flip.
 *
 * They are created through Prisma under a marker and removed precisely.
 */

const MARKER = "phase B4 report detail fixture";

let prisma: PrismaClient;
let superadminId: string;
let supportId: string;

/** A report pointing at a live message. */
let messageReportId: string;
/** A report pointing at a message id that does not resolve. */
let danglingReportId: string;
/** A report with no messageId at all. */
let userReportId: string;
/** A report whose message row exists but is soft-deleted. */
let deletedMessageReportId: string;
/** PC-2.5.4 — a report pointing at a moment that still exists. */
let momentReportId: string;
/** PC-2.5.4 — a report pointing at a moment that has since been deleted. */
let momentGoneReportId: string;
/** PC-2.5.4 — one row with both pointers, to pin MOMENT over MESSAGE. */
let momentAndMessageReportId: string;
/** The moment the live-moment report points at. */
let reportedMomentId: string;

/** The message the live-message report points at. */
const MESSAGE_BODY = `${MARKER} — the reported message body`;
/** PC-2.5.4 — the moment the live-moment report points at. */
const MOMENT_BODY = `${MARKER} — the reported moment body`;

test.beforeAll(async () => {
  prisma = new PrismaClient();

  const superadmin = await prisma.user.findMany({
    where: { email: "pw.superadmin@example.test" },
    select: { id: true },
  });
  const support = await prisma.user.findMany({
    where: { email: "pw.support@example.test" },
    select: { id: true },
  });
  if (superadmin.length !== 1 || support.length !== 1) {
    throw new Error("expected the seeded superadmin and support fixtures");
  }
  superadminId = superadmin[0].id;
  supportId = support[0].id;

  // A conversation the two fixture users share, so the message below is a
  // plausible row rather than a free-floating one. The join table is
  // `ConversationMember` (composite PK on conversationId+userId) — the relation
  // is `members`, not `participants`.
  const conversation = await prisma.conversation.findFirst({
    where: {
      AND: [
        { members: { some: { userId: superadminId } } },
        { members: { some: { userId: supportId } } },
      ],
    },
    select: { id: true },
  });
  const conversationId =
    conversation?.id ??
    (
      await prisma.conversation.create({
        data: {
          members: {
            create: [{ userId: superadminId }, { userId: supportId }],
          },
        },
        select: { id: true },
      })
    ).id;

  const liveMessage = await prisma.message.create({
    data: {
      conversationId,
      senderId: supportId,
      content: MESSAGE_BODY,
      type: "TEXT",
    },
    select: { id: true },
  });

  const deletedMessage = await prisma.message.create({
    data: {
      conversationId,
      senderId: supportId,
      content: `${MARKER} — soft-deleted message`,
      type: "TEXT",
      deletedAt: new Date(),
    },
    select: { id: true },
  });

  const messageReport = await prisma.report.create({
    data: {
      reporterId: superadminId,
      reportedUserId: supportId,
      reason: "Harassment",
      description: `${MARKER} — message target`,
      status: "OPEN",
      messageId: liveMessage.id,
    },
    select: { id: true },
  });

  // A `messageId` that resolves to nothing. No FK backs this column, so a
  // report can genuinely outlive its message.
  const danglingReport = await prisma.report.create({
    data: {
      reporterId: superadminId,
      reportedUserId: supportId,
      reason: "Spam",
      description: `${MARKER} — dangling message target`,
      status: "OPEN",
      messageId: "00000000-0000-4000-8000-000000000000",
    },
    select: { id: true },
  });

  const deletedReport = await prisma.report.create({
    data: {
      reporterId: superadminId,
      reportedUserId: supportId,
      reason: "Scam",
      description: `${MARKER} — deleted message target`,
      status: "OPEN",
      messageId: deletedMessage.id,
    },
    select: { id: true },
  });

  const userReport = await prisma.report.create({
    data: {
      reporterId: superadminId,
      reportedUserId: supportId,
      reason: "Fake profile",
      description: `${MARKER} — user target`,
      status: "OPEN",
      messageId: null,
    },
    select: { id: true },
  });

  messageReportId = messageReport.id;
  danglingReportId = danglingReport.id;
  deletedMessageReportId = deletedReport.id;
  userReportId = userReport.id;

  // ---- PC-2.5.4: the MOMENT target -------------------------------------------
  // Nothing in the console can create a moment, so these are written directly,
  // like the message fixtures above.
  const reportedMoment = await prisma.moment.create({
    data: {
      userId: supportId,
      platform: "INSTAGRAM",
      content: MOMENT_BODY,
      source: "USER",
    },
    select: { id: true },
  });
  reportedMomentId = reportedMoment.id;

  // A moment that is deleted again straight away. `Report.momentId` carries no
  // foreign key, so this is the state every report reaches once its content is
  // removed — a normal render, not a crash.
  const doomedMoment = await prisma.moment.create({
    data: {
      userId: supportId,
      platform: "INSTAGRAM",
      content: `${MARKER} — moment that gets deleted`,
      source: "USER",
    },
    select: { id: true },
  });
  await prisma.moment.delete({ where: { id: doomedMoment.id } });

  const momentReport = await prisma.report.create({
    data: {
      reporterId: superadminId,
      reportedUserId: supportId,
      reason: "Spam",
      description: `${MARKER} — moment target`,
      status: "OPEN",
      momentId: reportedMoment.id,
      messageId: null,
    },
    select: { id: true },
  });
  momentReportId = momentReport.id;

  const momentGoneReport = await prisma.report.create({
    data: {
      reporterId: superadminId,
      reportedUserId: supportId,
      reason: "Scam",
      description: `${MARKER} — deleted moment target`,
      status: "OPEN",
      momentId: doomedMoment.id,
      messageId: null,
    },
    select: { id: true },
  });
  momentGoneReportId = momentGoneReport.id;

  const bothReport = await prisma.report.create({
    data: {
      reporterId: superadminId,
      reportedUserId: supportId,
      reason: "Other",
      description: `${MARKER} — both pointers`,
      status: "OPEN",
      momentId: reportedMoment.id,
      messageId: liveMessage.id,
    },
    select: { id: true },
  });
  momentAndMessageReportId = bothReport.id;
});

test.afterAll(async () => {
  if (!prisma) return;
  const reportIds = [
    messageReportId,
    danglingReportId,
    deletedMessageReportId,
    userReportId,
    momentReportId,
    momentGoneReportId,
    momentAndMessageReportId,
  ];
  const messages = await prisma.message.findMany({
    where: { content: { startsWith: MARKER } },
    select: { id: true },
  });
  const messageIds = messages.map((m) => m.id);

  // Audit rows first: they reference the acting admin with RESTRICT.
  await prisma.adminAuditLog.deleteMany({
    where: { targetType: "REPORT", targetId: { in: reportIds } },
  });
  await prisma.report.deleteMany({ where: { id: { in: reportIds } } });
  // The moment rows go last: nothing references them, but they are as much a
  // fixture as the reports are.
  await prisma.moment.deleteMany({ where: { content: { startsWith: MARKER } } });
  if (messageIds.length > 0) {
    await prisma.message.deleteMany({ where: { id: { in: messageIds } } });
  }
  await prisma.$disconnect();
});

async function openReport(page: import("@playwright/test").Page, id: string) {
  await loginAndLand(page, "pw.superadmin@example.test");
  await page.goto(`/reports/${id}`);
  await expect(page.getByRole("heading", { name: "举报详情" })).toBeVisible();
}

test.describe("report detail", () => {
  // ------------------------------------------------------------------ user target
  test("Test 30: a USER report renders no message block, and says so", async ({ page }) => {
    await openReport(page, userReportId);

    // There is no `targetType` column — the badge is derived from messageId.
    await expect(page.getByTestId("report-target-badge")).toHaveText("用户举报");
    await expect(page.getByTestId("report-description")).toHaveText(`${MARKER} — user target`);

    // A user report has no message section at all: showing an empty "message"
    // block would imply evidence exists and is blank.
    await expect(page.getByTestId("report-message")).toHaveCount(0);
  });

  // ------------------------------------------------------------------ message target
  test("Test 31: a MESSAGE report renders the message body and its sender", async ({ page }) => {
    await openReport(page, messageReportId);

    await expect(page.getByTestId("report-target-badge")).toHaveText("消息举报");

    const block = page.getByTestId("report-message");
    await expect(block).toBeVisible();
    await expect(block).toContainText(MESSAGE_BODY);
    // The sender is named, so the operator knows whose message this is. The
    // fixture accounts are seeded with `PW <key>` nicknames, and the API
    // prefers `nickname ?? email` — so this asserts the nickname path.
    await expect(block).toContainText("PW support");
    await expect(page.getByTestId("report-message-unavailable")).toHaveCount(0);
  });

  // ------------------------------------------------------------------ unavailable message
  test("Test 32: a soft-deleted message is reported as deleted, not as absent", async ({ page }) => {
    await openReport(page, deletedMessageReportId);

    const unavailable = page.getByTestId("report-message-unavailable");
    await expect(unavailable).toBeVisible();
    await expect(unavailable).toContainText("该消息已被删除");

    // The two unavailability reasons must not be conflated: a deleted message
    // and a report that never had one are different situations.
    await expect(unavailable).not.toContainText("没有关联消息");
  });

  test("Test 33: a messageId that resolves to nothing is handled, not crashed", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openReport(page, danglingReportId);

    // `Report.messageId` carries no FK, so this is a reachable state rather
    // than a corrupted row. It must render the "deleted" branch — not a 500,
    // not a blank block, and not an uncaught render exception.
    await expect(page.getByTestId("report-message-unavailable")).toBeVisible();
    await expect(page.getByTestId("report-message-unavailable")).toContainText("该消息已被删除");
    expect(pageErrors).toEqual([]);
  });

  // ------------------------------------------------------------------ review history
  test("Test 34: a never-reviewed report states that explicitly", async ({ page }) => {
    await openReport(page, userReportId);

    const history = page.getByTestId("report-history");
    await expect(history).toBeVisible();

    // `Report` has no reviewedAt/reviewedBy/resolution columns, so the only
    // source of history is the audit log. An empty log has to read as "not yet
    // reviewed" rather than as a blank section that looks broken.
    await expect(history).toContainText("还没有审核记录");
  });

  test("Test 35: reviewing a report writes real history and updates the status", async ({ page }) => {
    await openReport(page, userReportId);
    await expect(page.getByTestId("status-badge")).toHaveText("待处理");

    // Drive the real action through the confirmation dialog. The reason is
    // mandatory on the wire, so this also proves the dialog supplies it.
    //
    // The confirm button carries the confirm label, which is the same word as
    // the trigger — hence `last()`. If it ever were not, the click would land
    // on the trigger and the dialog would just reopen, so the badge assertion
    // below would fail rather than this passing for the wrong reason.
    await page.getByRole("button", { name: "受理" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("textarea").fill("browser fixture review");
    await dialog.getByRole("button", { name: "受理" }).last().click();

    // The screen re-reads after the write, so the badge and the history both
    // have to reflect the new state without a manual reload. Waiting on the
    // response first keeps the assertion from racing the re-fetch.
    await expect(page.getByTestId("status-badge")).toHaveText("审核中", { timeout: 15_000 });
    const history = page.getByTestId("report-history");
    await expect(history).not.toContainText("还没有审核记录");
    await expect(history).toContainText("browser fixture review");

    // And it is a real audit row, attributed to the human who did it.
    const rows = await prisma.adminAuditLog.findMany({
      where: { targetType: "REPORT", targetId: userReportId },
      select: { actorType: true, adminId: true, reason: true, action: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorType).toBe("USER");
    expect(rows[0].adminId).toBe(superadminId);
    expect(rows[0].action).toBe("REPORT_REVIEWING");
    expect(rows[0].reason).toBe("browser fixture review");
  });

  // ------------------------------------------------------------------ moment target
  test("Test 39: a MOMENT report renders the moment body and its author", async ({ page }) => {
    await openReport(page, momentReportId);

    // There is still no `targetType` column — a row with a `momentId` is a
    // moment report, and since PC-2.5.4 the badge says so.
    await expect(page.getByTestId("report-target-badge")).toHaveText("动态举报");

    const block = page.getByTestId("report-moment");
    await expect(block).toBeVisible();
    await expect(block).toContainText(MOMENT_BODY);
    // The author is named, so an operator knows whose moment this is. The
    // fixture accounts are seeded with `PW <key>` nicknames and the API
    // prefers `nickname ?? email`, so this asserts the nickname path.
    await expect(block).toContainText("PW support");
    await expect(block).toContainText("INSTAGRAM");
    await expect(page.getByTestId("report-moment-unavailable")).toHaveCount(0);

    // A moment report has no message section: showing an empty one would imply
    // message evidence exists and is blank.
    await expect(page.getByTestId("report-message")).toHaveCount(0);
  });

  test("Test 40: a deleted moment degrades to copy instead of crashing", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openReport(page, momentGoneReportId);

    // `momentId` carries no foreign key, so a report can outlive its moment.
    // That is an ordinary state, and the screen has to say so rather than 500.
    await expect(page.getByTestId("report-target-badge")).toHaveText("动态举报");
    await expect(page.getByTestId("report-moment")).toBeVisible();
    await expect(page.getByTestId("report-moment-unavailable")).toHaveText("该动态已被删除，内容无法查看。");

    // The report stays readable and reviewable — only the evidence is gone.
    await expect(page.getByTestId("report-summary")).toBeVisible();
    await expect(page.getByRole("button", { name: "处理" })).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("Test 41: MOMENT wins over MESSAGE when a row carries both pointers", async ({ page }) => {
    await openReport(page, momentAndMessageReportId);

    // The rule is a priority, not "whichever pointer happens to be non-null".
    // This fixture is the only shape that can tell those two apart.
    await expect(page.getByTestId("report-target-badge")).toHaveText("动态举报");
    await expect(page.getByTestId("report-moment")).toContainText(MOMENT_BODY);
    await expect(page.getByTestId("report-message")).toHaveCount(0);
  });

  test("Test 42: a MOMENT report is reviewed by the same workflow and audited", async ({ page }) => {
    await openReport(page, momentReportId);
    await expect(page.getByTestId("status-badge")).toHaveText("待处理");

    // No MOMENT-specific review path: the buttons and the dialog are the ones a
    // USER or MESSAGE report uses.
    await page.getByRole("button", { name: "处理" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator("textarea").fill("moment fixture review");
    await dialog.getByRole("button", { name: "处理" }).last().click();

    await expect(page.getByTestId("status-badge")).toHaveText("已处理", { timeout: 15_000 });
    // The screen re-reads the whole detail after the write, so the evidence has
    // to survive it.
    await expect(page.getByTestId("report-moment")).toContainText(MOMENT_BODY);

    const rows = await prisma.adminAuditLog.findMany({
      where: { targetType: "REPORT", targetId: momentReportId },
      select: { actorType: true, adminId: true, reason: true, action: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorType).toBe("USER");
    expect(rows[0].adminId).toBe(superadminId);
    expect(rows[0].action).toBe("REPORT_RESOLVED");
    expect(rows[0].reason).toBe("moment fixture review");
  });

  // ------------------------------------------------------------------ not found
  test("Test 36: an unknown report id is a distinct screen, not a spinner or an error", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await loginAndLand(page, "pw.superadmin@example.test");
    await page.goto("/reports/00000000-0000-4000-8000-0000000000ff");

    await expect(page.getByRole("heading", { name: "举报不存在" })).toBeVisible();

    // The old failure mode: an unknown id left the screen on 「加载中…」 forever.
    await expect(page.getByText("加载中…")).toHaveCount(0);
    // And it must not look like a transient failure the operator should retry.
    await expect(page.getByText("加载失败")).toHaveCount(0);

    // A way back is offered.
    await expect(page.getByRole("link", { name: "返回举报列表" }).first()).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  // ------------------------------------------------------------------ permissions
  test("Test 37: a read-only role can read the detail but gets no review controls", async ({ page }) => {
    // ANALYST holds `reports:read` but not `reports:write`.
    await loginAndLand(page, "pw.analyst@example.test");
    await page.goto(`/reports/${messageReportId}`);
    await expect(page.getByRole("heading", { name: "举报详情" })).toBeVisible();

    // The content is fully readable — read-only means no actions, not no data.
    await expect(page.getByTestId("report-message")).toContainText(MESSAGE_BODY);

    await expect(page.getByText(/对举报只有查看权限/)).toBeVisible();
    await expect(page.getByRole("button", { name: "受理" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "处理" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "驳回" })).toHaveCount(0);
  });

  // ------------------------------------------------------------------ navigation
  test("Test 38: the queue's detail link opens this screen", async ({ page }) => {
    // The regression this whole page exists for: the link every row renders
    // used to point at a route that was not there.
    await loginAndLand(page, "pw.superadmin@example.test");
    await page.goto("/reports");

    const link = page.locator(`a[href="/reports/${messageReportId}"]`).first();
    await expect(link).toBeVisible();
    await link.click();

    await expect(page).toHaveURL(new RegExp(`/reports/${messageReportId}$`));
    await expect(page.getByRole("heading", { name: "举报详情" })).toBeVisible();
  });
});
