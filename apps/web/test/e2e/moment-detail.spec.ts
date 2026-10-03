import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAndLand, profileCard } from "../fixtures/browser";
import {
  ALICE_COMMENT_TEXT,
  ALICE_NICKNAME,
  BOB_MOMENT_TEXT,
  BOB_NICKNAME,
  CAROL_NICKNAME,
  EMAILS,
  seed,
} from "../fixtures/profile";

/**
 * PC-2.1 — post detail, driven through a real browser against a real API and a
 * real PostgreSQL database.
 *
 * The feed card is only a summary. These tests therefore assert on the detail
 * screen's *own* `GET /moments/:id` response: a page that re-rendered whatever
 * the list happened to hold would still "look" right, so the DB is checked
 * separately where the wording matters.
 *
 * Bob's fixture moment defaults to `everyone`; the two connection-gated tests
 * tighten his `MomentSetting` themselves and rely on `beforeEach` re-seeding so
 * they cannot leak into the next test.
 */

const prisma = new PrismaClient();

test.beforeEach(async () => {
  await seed(prisma);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function userId(email: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`fixture account missing: ${email}`);
  return user.id;
}

async function momentId(): Promise<string> {
  const moment = await prisma.moment.findFirst({
    where: { content: BOB_MOMENT_TEXT },
    select: { id: true },
  });
  if (!moment) throw new Error("PC-2.1 fixture moment missing");
  return moment.id;
}

async function feedArticle(page: Page) {
  const article = page.locator("article").filter({ hasText: BOB_MOMENT_TEXT });
  await expect(article).toBeVisible({ timeout: 20_000 });
  return article;
}

test("动态列表点击正文进入详情页，详情展示数据库中的真实正文", async ({ page }) => {
  await loginAndLand(page, EMAILS.carol);
  await page.goto("/moments");

  const article = await feedArticle(page);
  await article.getByRole("link", { name: `查看动态详情：${BOB_NICKNAME}` }).click();

  await expect(page).toHaveURL(/\/moments\/[0-9a-fA-F-]{36}$/);
  const detail = page.getByTestId("moment-detail");
  await expect(detail).toBeVisible({ timeout: 20_000 });
  await expect(detail).toContainText(BOB_MOMENT_TEXT);
  await expect(detail).toContainText(BOB_NICKNAME);
});

test("详情页刷新后仍从 API 读取真实数据", async ({ page }) => {
  const id = await momentId();
  await loginAndLand(page, EMAILS.carol);
  await page.goto(`/moments/${id}`);

  await expect(page.getByTestId("moment-detail")).toContainText(BOB_MOMENT_TEXT, { timeout: 20_000 });
  await page.reload();
  await expect(page.getByTestId("moment-detail")).toContainText(BOB_MOMENT_TEXT, { timeout: 20_000 });
});

test("不存在的动态显示明确的不存在状态", async ({ page }) => {
  await loginAndLand(page, EMAILS.carol);
  await page.goto("/moments/11111111-1111-4111-8111-111111111111");

  await expect(page.getByText("这条动态不存在或已被删除")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("moment-detail")).toHaveCount(0);
});

test("仅连接可见的动态对陌生人显示受限状态且不返回正文", async ({ page }) => {
  const bobId = await userId(EMAILS.bob);
  await prisma.momentSetting.upsert({
    where: { userId: bobId },
    create: { userId: bobId, visibleTo: "connections" },
    update: { visibleTo: "connections" },
  });

  const id = await momentId();
  await loginAndLand(page, EMAILS.carol);
  await page.goto(`/moments/${id}`);

  await expect(page.getByText("这条动态暂时无法查看")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("moment-detail")).toHaveCount(0);
  await expect(page.getByText(BOB_MOMENT_TEXT)).toHaveCount(0);
});

test("仅连接可见的动态对 ACTIVE 连接可见", async ({ page }) => {
  const bobId = await userId(EMAILS.bob);
  await prisma.momentSetting.upsert({
    where: { userId: bobId },
    create: { userId: bobId, visibleTo: "connections" },
    update: { visibleTo: "connections" },
  });

  const id = await momentId();
  await loginAndLand(page, EMAILS.alice);
  await page.goto(`/moments/${id}`);

  await expect(page.getByTestId("moment-detail")).toContainText(BOB_MOMENT_TEXT, { timeout: 20_000 });
});

test("详情页作者头像打开统一的资料卡", async ({ page }) => {
  const id = await momentId();
  await loginAndLand(page, EMAILS.carol);
  await page.goto(`/moments/${id}`);

  const detail = page.getByTestId("moment-detail");
  await expect(detail).toBeVisible({ timeout: 20_000 });
  await detail.getByRole("button", { name: `查看 ${BOB_NICKNAME} 的资料卡` }).click();

  await expect(profileCard(page)).toContainText(BOB_NICKNAME, { timeout: 20_000 });
});

test("详情页不泄露邮箱等内部信息", async ({ page }) => {
  const id = await momentId();
  await loginAndLand(page, EMAILS.carol);
  await page.goto(`/moments/${id}`);

  const detail = page.getByTestId("moment-detail");
  await expect(detail).toBeVisible({ timeout: 20_000 });
  const text = (await detail.textContent()) ?? "";
  expect(text).not.toContain("@");
  expect(text).not.toContain("example.test");
  expect(text).not.toMatch(/password|token|oauth|handle|isAdmin/i);
});

/**
 * PC-2.2 — the comment thread of Post Detail.
 *
 * The thread is a second read of the same moment, so the two things worth
 * proving are that it comes from PostgreSQL (a posting survives a reload and is
 * visible in the database, not just in React state) and that it does not open a
 * side door around the moment's own visibility rules.
 */

const PC22_COMMENT_TEXT = "PW PC-2.2 真实评论";

async function openDetail(page: Page) {
  const id = await momentId();
  await loginAndLand(page, EMAILS.carol);
  await page.goto(`/moments/${id}`);
  const section = page.getByTestId("moment-comments");
  await expect(section).toBeVisible({ timeout: 20_000 });
  return section;
}

test("详情页展示数据库中的评论，发表后刷新仍然存在", async ({ page }) => {
  const section = await openDetail(page);
  await expect(section.getByTestId("comment-list")).toContainText(ALICE_COMMENT_TEXT, { timeout: 20_000 });
  await expect(section.getByTestId("comment-count")).toHaveText("评论 · 1");

  await section.getByLabel("写评论").fill(PC22_COMMENT_TEXT);
  await section.getByTestId("comment-send").click();

  await expect(section.getByTestId("comment-list")).toContainText(PC22_COMMENT_TEXT, { timeout: 20_000 });
  await expect(section.getByTestId("comment-count")).toHaveText("评论 · 2");
  // The composer is cleared only after the write succeeded.
  await expect(section.getByLabel("写评论")).toHaveValue("");

  // The row is in PostgreSQL, and the page re-reads it after a reload.
  const stored = await prisma.momentComment.findFirst({
    where: { content: PC22_COMMENT_TEXT },
    select: { id: true, moment: { select: { commentCount: true } } },
  });
  expect(stored).not.toBeNull();
  expect(stored?.moment.commentCount).toBe(2);

  await page.reload();
  await expect(page.getByTestId("moment-comments").getByTestId("comment-list")).toContainText(PC22_COMMENT_TEXT, {
    timeout: 20_000,
  });
});

test("详情页评论为空时显示空态文案", async ({ page }) => {
  const moment = await prisma.moment.findFirst({ where: { content: BOB_MOMENT_TEXT }, select: { id: true } });
  if (!moment) throw new Error("PC-2.2 fixture moment missing");
  await prisma.momentComment.deleteMany({ where: { momentId: moment.id } });
  await prisma.moment.update({ where: { id: moment.id }, data: { commentCount: 0 } });

  const section = await openDetail(page);
  await expect(section.getByTestId("comment-empty")).toHaveText("还没有评论，成为第一个留言的人吧。", {
    timeout: 20_000,
  });
  await expect(section.getByTestId("comment-list")).toHaveCount(0);
});

test("空评论不可提交：发送按钮保持禁用", async ({ page }) => {
  const section = await openDetail(page);
  await expect(section.getByTestId("comment-send")).toBeDisabled();
  await section.getByLabel("写评论").fill("   ");
  await expect(section.getByTestId("comment-send")).toBeDisabled();
  await section.getByLabel("写评论").fill("有内容了");
  await expect(section.getByTestId("comment-send")).toBeEnabled();
});

test("仅连接可见的动态：评论线程同样被拒绝，不泄露评论内容", async ({ page }) => {
  const bobId = await userId(EMAILS.bob);
  await prisma.momentSetting.upsert({
    where: { userId: bobId },
    create: { userId: bobId, visibleTo: "connections" },
    update: { visibleTo: "connections" },
  });

  const id = await momentId();
  await loginAndLand(page, EMAILS.carol);
  await page.goto(`/moments/${id}`);

  await expect(page.getByText("这条动态暂时无法查看")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("moment-comments")).toHaveCount(0);
  await expect(page.getByText(ALICE_COMMENT_TEXT)).toHaveCount(0);
  const body = (await page.locator("body").textContent()) ?? "";
  expect(body).not.toContain(ALICE_COMMENT_TEXT);
});

test("详情页评论头像与昵称复用统一的资料卡", async ({ page }) => {
  const section = await openDetail(page);
  const list = section.getByTestId("comment-list");
  await list.getByRole("button", { name: `查看 ${ALICE_NICKNAME} 的资料卡` }).click();
  await expect(profileCard(page)).toContainText(ALICE_NICKNAME, { timeout: 20_000 });
});

test("评论区不泄露邮箱等内部信息，且不横向溢出", async ({ page }) => {
  const section = await openDetail(page);
  const text = (await section.textContent()) ?? "";
  expect(text).not.toContain("@");
  expect(text).not.toMatch(/password|token|oauth|handle|isAdmin|reviewStatus|definitionId/i);

  const viewport = page.viewportSize();
  const input = await section.getByLabel("写评论").boundingBox();
  const send = await section.getByTestId("comment-send").boundingBox();
  if (!viewport || !input || !send) throw new Error("comment composer was not laid out");
  expect(Math.round(input.x + input.width)).toBeLessThanOrEqual(Math.round(viewport.width));
  expect(Math.round(send.x + send.width)).toBeLessThanOrEqual(Math.round(viewport.width));
  const overflow = await section.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

/**
 * PC-2.3.3 — replies, driven through the real thread.
 *
 * A reply is a second write on the same route, so what has to be proven is that
 * it is stored against its parent rather than as a top-level comment, that it
 * survives a reload, and that it never grows a reply level of its own. The
 * `commentCount` assertions pin the product rule that the counter still means
 * top-level comments, and the reload is what separates a stored reply from one
 * that only ever existed in React state.
 */

const PC233_REPLY_TEXT = "PW PC-2.3.3 真实回复";

async function topLevelComment(section: Locator) {
  const item = section.getByTestId("comment-item").filter({ hasText: ALICE_COMMENT_TEXT });
  await expect(item).toBeVisible({ timeout: 20_000 });
  return item;
}

test("一级评论可以回复：回复归属正确、不改变评论数、刷新后仍存在", async ({ page }) => {
  const section = await openDetail(page);
  const item = await topLevelComment(section);
  await expect(section.getByTestId("comment-count")).toHaveText("评论 · 1");

  await item.getByTestId("reply-toggle").click();
  const composer = item.getByTestId("reply-composer");
  await expect(composer).toBeVisible();
  // The composer says who is being replied to.
  await expect(composer).toContainText(`回复 ${ALICE_NICKNAME}`);

  const input = composer.getByLabel(`回复 ${ALICE_NICKNAME}`);
  await expect(composer.getByTestId("reply-send")).toBeDisabled();
  await input.fill("   ");
  await expect(composer.getByTestId("reply-send")).toBeDisabled();
  await input.fill(PC233_REPLY_TEXT);
  await expect(composer.getByTestId("reply-send")).toBeEnabled();
  await composer.getByTestId("reply-send").click();

  const replies = item.getByTestId("reply-list");
  await expect(replies.getByTestId("reply-item").filter({ hasText: PC233_REPLY_TEXT })).toContainText(CAROL_NICKNAME, {
    timeout: 20_000,
  });
  // The composer closes only after the write succeeded, and the reply carries
  // no affordance of its own: the thread stays one level deep.
  await expect(item.getByTestId("reply-composer")).toHaveCount(0);
  await expect(replies.getByTestId("reply-toggle")).toHaveCount(0);
  // commentCount counts top-level comments only, so a reply leaves it alone.
  await expect(section.getByTestId("comment-count")).toHaveText("评论 · 1");

  // The reply is a real row attached to the parent it was written for.
  const parent = await prisma.momentComment.findFirst({
    where: { content: ALICE_COMMENT_TEXT },
    select: { id: true },
  });
  const stored = await prisma.momentComment.findFirst({
    where: { content: PC233_REPLY_TEXT },
    select: { parentCommentId: true, moment: { select: { commentCount: true } } },
  });
  expect(stored?.parentCommentId).toBe(parent?.id);
  expect(stored?.moment.commentCount).toBe(1);

  await page.reload();
  const reloaded = page
    .getByTestId("moment-comments")
    .getByTestId("comment-item")
    .filter({ hasText: ALICE_COMMENT_TEXT });
  await expect(reloaded.getByTestId("reply-list")).toContainText(PC233_REPLY_TEXT, { timeout: 20_000 });
});

test("回复可以取消：关闭输入框且不写入任何行", async ({ page }) => {
  const section = await openDetail(page);
  const item = await topLevelComment(section);
  const before = await prisma.momentComment.count({ where: { parentCommentId: { not: null } } });

  await item.getByTestId("reply-toggle").click();
  await item.getByLabel(`回复 ${ALICE_NICKNAME}`).fill("PW 被取消的回复草稿");
  await item.getByTestId("reply-cancel").click();

  await expect(item.getByTestId("reply-composer")).toHaveCount(0);
  await expect(item.getByTestId("reply-list")).toHaveCount(0);
  expect(await prisma.momentComment.count({ where: { parentCommentId: { not: null } } })).toBe(before);
});

test("服务端拒绝回复时显示中文错误、保留草稿且不落库", async ({ page }) => {
  const section = await openDetail(page);
  const item = await topLevelComment(section);

  await item.getByTestId("reply-toggle").click();
  const input = item.getByLabel(`回复 ${ALICE_NICKNAME}`);
  await input.fill("PW 被服务端拒绝的回复");

  // Delete the parent behind the UI's back: the server must answer 403
  // COMMENT_PARENT_INVALID rather than storing an orphan reply.
  const parent = await prisma.momentComment.findFirst({
    where: { content: ALICE_COMMENT_TEXT },
    select: { id: true },
  });
  if (!parent) throw new Error("PC-2.2 fixture comment missing");
  await prisma.momentComment.delete({ where: { id: parent.id } });

  await item.getByTestId("reply-send").click();
  await expect(item.getByTestId("reply-error")).toHaveText("无法回复这条评论，请刷新后重试", {
    timeout: 20_000,
  });
  // The draft survives the rejection so the text is not lost, and nothing was
  // written locally or in PostgreSQL.
  await expect(input).toHaveValue("PW 被服务端拒绝的回复");
  expect(await prisma.momentComment.count({ where: { content: "PW 被服务端拒绝的回复" } })).toBe(0);
});

test("回复输入区在窄屏不横向溢出，且不泄露内部字段", async ({ page }, testInfo) => {
  const section = await openDetail(page);
  const item = await topLevelComment(section);
  await item.getByTestId("reply-toggle").click();

  const composer = item.getByTestId("reply-composer");
  await expect(composer).toBeVisible();

  const text = (await section.textContent()) ?? "";
  expect(text).not.toContain("@");
  expect(text).not.toMatch(/password|token|oauth|handle|isAdmin|reviewStatus|definitionId|source/i);

  const viewport = page.viewportSize();
  const [input, cancel, send] = await Promise.all([
    composer.getByLabel(`回复 ${ALICE_NICKNAME}`).boundingBox(),
    composer.getByTestId("reply-cancel").boundingBox(),
    composer.getByTestId("reply-send").boundingBox(),
  ]);
  if (!viewport || !input || !cancel || !send) {
    throw new Error(`reply composer was not laid out (${testInfo.project.name})`);
  }
  for (const box of [input, cancel, send]) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(Math.round(box.x + box.width)).toBeLessThanOrEqual(Math.round(viewport.width));
  }
  expect(await section.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
});

/**
 * The reply composer is the narrowest piece of UI in the thread, and "it fits
 * on whichever phone the project happens to emulate" is a weaker claim than the
 * three viewports the design commits to, so those are asserted explicitly.
 */
const REPLY_VIEWPORTS = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

for (const viewport of REPLY_VIEWPORTS) {
  test.describe(`回复输入区 @ ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test("打开回复输入框后按钮与输入框都在屏幕内", async ({ page }) => {
      const section = await openDetail(page);
      const item = await topLevelComment(section);
      await item.getByTestId("reply-toggle").click();

      const composer = item.getByTestId("reply-composer");
      await expect(composer).toBeVisible();

      const [input, cancel, send] = await Promise.all([
        composer.getByLabel(`回复 ${ALICE_NICKNAME}`).boundingBox(),
        composer.getByTestId("reply-cancel").boundingBox(),
        composer.getByTestId("reply-send").boundingBox(),
      ]);
      if (!input || !cancel || !send) throw new Error("reply composer was not laid out");
      for (const box of [input, cancel, send]) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(Math.round(box.x + box.width)).toBeLessThanOrEqual(viewport.width);
      }
      expect(await section.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    });
  });
}

test("动态列表卡片保持只读评论线程：不提供回复入口", async ({ page }) => {
  await loginAndLand(page, EMAILS.carol);
  await page.goto("/moments");

  const article = await feedArticle(page);
  await article.getByRole("button", { name: "评论" }).click();
  await expect(article.getByTestId("comment-list")).toContainText(ALICE_COMMENT_TEXT, { timeout: 20_000 });

  // The feed does not pass `onReply`, so the affordance must not appear there:
  // an input that quietly posted a reply as a top-level comment would be worse
  // than offering nothing at all.
  await expect(article.getByTestId("reply-toggle")).toHaveCount(0);
  await expect(article.getByTestId("reply-composer")).toHaveCount(0);
  await expect(article.getByTestId("reply-list")).toHaveCount(0);
});

/**
 * PC-2.4 — pagination and deletion, driven through the real thread.
 *
 * Two things have to be proven here rather than in the service unit tests: that
 * "load more" appends instead of replacing (a page that reset the list would
 * still pass a count assertion if the counts happened to match), and that what
 * the screen shows after a delete is what PostgreSQL holds. Both are checked
 * against the database, not against React state.
 */

const PC24_PAGE_SIZE = 20;
const PC24_BULK = 24;
const PC24_PARENT_TEXT = "PW PC-2.4 待删除的一级评论";
const PC24_REPLY_TEXT = "PW PC-2.4 会随父评论一起消失的回复";
const PC24_LONE_REPLY_TEXT = "PW PC-2.4 单独删除的回复";

async function bulkComments(momentIdValue: string, authorId: string, count: number) {
  await prisma.momentComment.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      momentId: momentIdValue,
      userId: authorId,
      content: `PW PC-2.4 分页评论 ${index + 1}`,
    })),
  });
}

/**
 * Carol's own top-level comment with a reply under it, plus the counter the
 * card reads, so a UI delete has something real to remove at both levels.
 */
async function seedOwnThread(momentIdValue: string, replyText = PC24_REPLY_TEXT) {
  const carol = await userId(EMAILS.carol);
  const parent = await prisma.momentComment.create({
    data: { momentId: momentIdValue, userId: carol, content: PC24_PARENT_TEXT },
    select: { id: true },
  });
  await prisma.momentComment.create({
    data: { momentId: momentIdValue, userId: carol, content: replyText, parentCommentId: parent.id },
  });
  // 一级评论 +1（回复不计入），与服务保持同一语义。
  await prisma.moment.update({ where: { id: momentIdValue }, data: { commentCount: 2 } });
  return parent.id;
}

function commentItem(page: Page, text: string) {
  return page.getByTestId("moment-comments").getByTestId("comment-item").filter({ hasText: text });
}

/**
 * The reply level carries its own menu, so the id is spelled out: a top-level
 * comment and the reply inside it are two different affordances.
 */
async function openDeleteDialog(page: Page, item: Locator, level: "comment" | "reply" = "comment") {
  await item.getByTestId(`${level}-menu`).click();
  await item.getByTestId(`${level}-delete`).click();
  await expect(page.getByTestId("comment-delete-confirm")).toBeVisible();
}

test("一级评论分页：加载更多追加下一页而不清空列表，最后一页不再显示按钮", async ({ page }) => {
  const id = await momentId();
  const bobId = await userId(EMAILS.bob);
  // 24 + 夹具里已有的 1 条 = 25 条一级评论，正好跨两页（默认 pageSize 20）。
  await bulkComments(id, bobId, PC24_BULK);
  await prisma.moment.update({ where: { id }, data: { commentCount: 1 + PC24_BULK } });

  const section = await openDetail(page);
  const items = section.getByTestId("comment-item");

  await expect(items).toHaveCount(PC24_PAGE_SIZE, { timeout: 20_000 });
  await expect(section.getByTestId("comment-load-more")).toBeVisible();
  await expect(section.getByTestId("comment-no-more")).toHaveCount(0);

  await section.getByTestId("comment-load-more").click();

  // 追加而不是替换：第二页到达后总数是两页之和，且没有重复。
  await expect(items).toHaveCount(1 + PC24_BULK, { timeout: 20_000 });
  const texts = await items.allTextContents();
  expect(new Set(texts).size).toBe(1 + PC24_BULK);
  // 第一页的内容没有被清空。
  await expect(section).toContainText(ALICE_COMMENT_TEXT);

  await expect(section.getByTestId("comment-no-more")).toBeVisible();
  await expect(section.getByTestId("comment-load-more")).toHaveCount(0);
});

test("一级评论不超过一页时不显示加载更多入口", async ({ page }) => {
  const section = await openDetail(page);
  await expect(section.getByTestId("comment-list")).toContainText(ALICE_COMMENT_TEXT, { timeout: 20_000 });
  // 夹具只有 1 条一级评论：一页装得下，因此没有按钮也没有「不再有更多」。
  await expect(section.getByTestId("comment-load-more")).toHaveCount(0);
  await expect(section.getByTestId("comment-no-more")).toHaveCount(0);
});

test("只有自己的评论显示删除入口，别人的不显示", async ({ page }) => {
  const section = await openDetail(page);
  const ours = commentItem(page, ALICE_COMMENT_TEXT);
  await expect(ours).toBeVisible({ timeout: 20_000 });
  // 夹具评论属于 Alice，当前登录的是 Carol。
  await expect(ours.getByTestId("comment-menu")).toHaveCount(0);
  await expect(section.getByTestId("reply-menu")).toHaveCount(0);
});

test("删除自己的一级评论：回复一起消失、评论数减一，刷新后仍不存在", async ({ page }) => {
  const id = await momentId();
  const parentId = await seedOwnThread(id);

  const section = await openDetail(page);
  const item = commentItem(page, PC24_PARENT_TEXT);
  await expect(item).toBeVisible({ timeout: 20_000 });
  await expect(item.getByTestId("reply-list")).toContainText(PC24_REPLY_TEXT);
  await expect(section.getByTestId("comment-count")).toHaveText("评论 · 2");

  await openDeleteDialog(page, item);
  await expect(page.getByText("如果这是一级评论，其回复也会一并删除。")).toBeVisible();
  await page.getByTestId("comment-delete-confirm").click();

  // 只有服务端确认删除后，界面才移除这一支线程。
  await expect(item).toHaveCount(0, { timeout: 20_000 });
  await expect(section).not.toContainText(PC24_REPLY_TEXT);
  await expect(section.getByTestId("comment-count")).toHaveText("评论 · 1");

  // PostgreSQL 里父评论与回复都不在了（回复走 ON DELETE CASCADE）。
  expect(await prisma.momentComment.count({ where: { id: parentId } })).toBe(0);
  expect(await prisma.momentComment.count({ where: { content: PC24_REPLY_TEXT } })).toBe(0);
  const stored = await prisma.moment.findUnique({ where: { id }, select: { commentCount: true } });
  expect(stored?.commentCount).toBe(1);

  await page.reload();
  const reloaded = page.getByTestId("moment-comments");
  await expect(reloaded.getByTestId("comment-list")).toContainText(ALICE_COMMENT_TEXT, { timeout: 20_000 });
  await expect(reloaded).not.toContainText(PC24_PARENT_TEXT);
  await expect(reloaded).not.toContainText(PC24_REPLY_TEXT);
});

test("删除自己的回复：一级评论保留，评论数不变", async ({ page }) => {
  const id = await momentId();
  await seedOwnThread(id, PC24_LONE_REPLY_TEXT);

  const section = await openDetail(page);
  const parent = commentItem(page, PC24_PARENT_TEXT);
  await expect(parent).toBeVisible({ timeout: 20_000 });
  const reply = parent.getByTestId("reply-item").filter({ hasText: PC24_LONE_REPLY_TEXT });
  await expect(reply).toBeVisible();

  await openDeleteDialog(page, reply, "reply");
  await page.getByTestId("comment-delete-confirm").click();

  await expect(parent.getByTestId("reply-item")).toHaveCount(0, { timeout: 20_000 });
  // 回复不参与计数：一级评论还在，数字也不动。
  await expect(parent).toBeVisible();
  await expect(section.getByTestId("comment-count")).toHaveText("评论 · 2");
  expect(await prisma.momentComment.count({ where: { content: PC24_LONE_REPLY_TEXT } })).toBe(0);
  const stored = await prisma.moment.findUnique({ where: { id }, select: { commentCount: true } });
  expect(stored?.commentCount).toBe(2);
});

test("取消删除：什么都不删，计数与线程保持原样", async ({ page }) => {
  const id = await momentId();
  const parentId = await seedOwnThread(id);

  const section = await openDetail(page);
  const item = commentItem(page, PC24_PARENT_TEXT);
  await expect(item).toBeVisible({ timeout: 20_000 });

  await openDeleteDialog(page, item);
  await page.getByTestId("comment-delete-cancel").click();

  await expect(page.getByTestId("comment-delete-confirm")).toHaveCount(0);
  await expect(item).toBeVisible();
  await expect(section.getByTestId("comment-count")).toHaveText("评论 · 2");
  expect(await prisma.momentComment.count({ where: { id: parentId } })).toBe(1);
});

test("服务端拒绝删除时显示中文错误、保留原评论且不落库改动", async ({ page }) => {
  const id = await momentId();
  const parentId = await seedOwnThread(id);

  const section = await openDetail(page);
  const item = commentItem(page, PC24_PARENT_TEXT);
  await expect(item).toBeVisible({ timeout: 20_000 });

  await openDeleteDialog(page, item);

  // 绕过界面把行删掉：服务端必须回答 404，而不是假装成功。
  await prisma.momentComment.delete({ where: { id: parentId } });
  await page.getByTestId("comment-delete-confirm").click();

  await expect(page.getByTestId("comment-delete-error")).toHaveText("这条评论已经不存在了", {
    timeout: 20_000,
  });
  // 对话框留在原地、原评论留在界面上：失败不能被呈现为成功。
  await expect(page.getByTestId("comment-delete-confirm")).toBeVisible();
  await expect(item).toBeVisible();
  await expect(section.getByTestId("comment-count")).toHaveText("评论 · 2");
});

/**
 * The confirmation is the narrowest overlay in the thread, so it is asserted at
 * the three widths the design commits to rather than at whichever phone the
 * project happens to emulate.
 */
for (const viewport of REPLY_VIEWPORTS) {
  test.describe(`删除确认弹层 @ ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test("弹层与两个按钮都在屏幕内，且不横向溢出", async ({ page }) => {
      const id = await momentId();
      await seedOwnThread(id);

      const section = await openDetail(page);
      const item = commentItem(page, PC24_PARENT_TEXT);
      await expect(item).toBeVisible({ timeout: 20_000 });
      await openDeleteDialog(page, item);

      const [cancel, confirm] = await Promise.all([
        page.getByTestId("comment-delete-cancel").boundingBox(),
        page.getByTestId("comment-delete-confirm").boundingBox(),
      ]);
      if (!cancel || !confirm) throw new Error("delete dialog was not laid out");
      for (const box of [cancel, confirm]) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(Math.round(box.x + box.width)).toBeLessThanOrEqual(viewport.width);
      }
      // The width has to be handed to the page: the callback runs in the
      // browser, where the Node-side `viewport` object does not exist.
      const overflow = await page
        .getByTestId("comment-delete-confirm")
        .evaluate((element, width) => element.ownerDocument.documentElement.scrollWidth - width, viewport.width);
      expect(overflow).toBeLessThanOrEqual(1);
      await expect(section.getByTestId("comment-count")).toHaveText("评论 · 2");
    });
  });
}

test("动态列表卡片保持只读线程：即使自己的评论也不提供删除入口", async ({ page }) => {
  const id = await momentId();
  const carol = await userId(EMAILS.carol);
  await prisma.momentComment.create({
    data: { momentId: id, userId: carol, content: PC24_PARENT_TEXT },
  });

  await loginAndLand(page, EMAILS.carol);
  await page.goto("/moments");

  const article = await feedArticle(page);
  await article.getByRole("button", { name: "评论" }).click();
  await expect(article.getByTestId("comment-list")).toContainText(PC24_PARENT_TEXT, { timeout: 20_000 });

  // 列表没有传 onDelete，因此不会出现删除入口 —— 一个没有处理函数的按钮
  // 比什么都不给更糟。
  await expect(article.getByTestId("comment-menu")).toHaveCount(0);
  await expect(article.getByTestId("comment-delete")).toHaveCount(0);
  await expect(article.getByTestId("reply-menu")).toHaveCount(0);
  await expect(article.getByTestId("comment-load-more")).toHaveCount(0);
});

/**
 * PC-2.5.4 — reporting the moment itself.
 *
 * The point of driving this through the browser is that the report dialog makes
 * a claim about the database: 「举报已提交」 is only honest if PostgreSQL holds
 * the row. So the success case is checked against `Report`, and every refusal
 * case is checked in both directions — the copy on screen *and* the absence of a
 * row.
 *
 * The reason list is asserted against the endpoint's own allow-list. It is
 * duplicated here on purpose: `Report.reason` is a free-form column and the
 * controller is its only validator, so an option the UI invents would be a
 * guaranteed `403 INVALID_REASON`. If either side changes, this test fails and
 * the two get reconciled.
 *
 * The refusals are produced for real rather than by mocking a response. The
 * self-report is a genuine `403 CANNOT_REPORT_SELF` from the API, and the
 * missing-moment case deletes the row behind the screen so the API genuinely
 * answers `404 MOMENT_NOT_FOUND`.
 */

/** Must equal the allow-list in `social-safety.controller.ts`, in its order. */
const PC254_REASONS = [
  "Harassment",
  "Spam",
  "Scam",
  "Sexual content",
  "Hate speech",
  "Fake profile",
  "Other",
] as const;

const PC254_MARKER = "PW PC-2.5.4 举报补充说明";
const PC254_OWN_MOMENT_TEXT = "PW PC-2.5.4 Carol 自己的动态";

/**
 * The three widths the design commits to. The dialog is the tallest overlay in
 * the app, so it is asserted explicitly rather than at whichever phone the
 * project happens to emulate.
 */
const PC254_DIALOG_VIEWPORTS = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

function reportRows(momentIdValue: string) {
  return prisma.report.count({ where: { momentId: momentIdValue } });
}

/**
 * Opens Bob's moment as Carol — a stranger, so what is on screen was authorised
 * by `resolveMomentAccess` for a viewer with no connection — and opens the
 * report dialog through the real menu.
 */
async function openReportDialog(page: Page) {
  const id = await momentId();
  await loginAndLand(page, EMAILS.carol);
  await page.goto(`/moments/${id}`);
  await expect(page.getByTestId("moment-detail")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("moment-menu").click();
  await page.getByTestId("moment-report-open").click();
  await expect(page.getByTestId("moment-report-dialog")).toBeVisible();
  return id;
}

test("详情页提供举报入口：打开前没有浮层，菜单里只有「举报这条动态」", async ({ page }) => {
  const id = await momentId();
  await loginAndLand(page, EMAILS.carol);
  await page.goto(`/moments/${id}`);
  await expect(page.getByTestId("moment-detail")).toBeVisible({ timeout: 20_000 });

  // A locked / missing moment renders no body at all, so the entry cannot exist
  // for a moment the server did not hand over.
  await expect(page.getByTestId("moment-report-open")).toHaveCount(0);
  await expect(page.getByTestId("moment-report-dialog")).toHaveCount(0);

  await page.getByTestId("moment-menu").click();
  await expect(page.getByTestId("moment-report-open")).toHaveText("举报这条动态");
  // Opening the menu is not the same as reporting: nothing is sent yet.
  await expect(page.getByTestId("moment-report-dialog")).toHaveCount(0);
});

test("举报原因选项与后端允许的枚举一致，且每一项都有中文标签", async ({ page }) => {
  await openReportDialog(page);

  const codes = await page
    .getByTestId("moment-report-reason")
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-reason")));
  expect(codes).toEqual([...PC254_REASONS]);

  // The API stores these codes verbatim, so the labels are presentation only —
  // all seven still have to be readable in Chinese.
  const labels = await page.getByTestId("moment-report-reason").allTextContents();
  for (const label of labels) expect(label).toMatch(/[\u4e00-\u9fa5]/);
});

test("未选择原因时提交按钮保持禁用", async ({ page }) => {
  await openReportDialog(page);
  const submit = page.getByTestId("moment-report-submit");

  // No reason is preselected, so an accidental submit cannot report the first
  // option on the list.
  await expect(submit).toBeDisabled();
  await page.getByTestId("moment-report-description").fill(PC254_MARKER);
  await expect(submit).toBeDisabled();

  await page.getByTestId("moment-report-reason").first().click();
  await expect(submit).toBeEnabled();
});

test("取消举报：弹层关闭，PostgreSQL 里没有新行", async ({ page }) => {
  const id = await openReportDialog(page);
  await page.getByTestId("moment-report-reason").first().click();
  await page.getByTestId("moment-report-cancel").click();

  await expect(page.getByTestId("moment-report-dialog")).toHaveCount(0);
  await expect(page.getByTestId("moment-report-notice")).toHaveCount(0);
  expect(await reportRows(id)).toBe(0);
});

test("举报成功：弹层关闭、显示提示，且 PostgreSQL 里真实存在这一行", async ({ page }) => {
  const id = await openReportDialog(page);
  const carol = await userId(EMAILS.carol);
  const bob = await userId(EMAILS.bob);

  await page.locator('[data-testid="moment-report-reason"][data-reason="Spam"]').click();
  await page.getByTestId("moment-report-description").fill(PC254_MARKER);
  await page.getByTestId("moment-report-submit").click();

  // Nothing is acknowledged until the API answered.
  await expect(page.getByTestId("moment-report-dialog")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId("moment-report-notice")).toHaveText("举报已提交，我们会尽快审核。");

  // The row the API created, read back from PostgreSQL.
  const row = await prisma.report.findFirst({
    where: { momentId: id, reporterId: carol },
    select: { reportedUserId: true, messageId: true, reason: true, description: true, status: true },
  });
  expect(row).not.toBeNull();
  // The author comes from the moment, not from the request body.
  expect(row?.reportedUserId).toBe(bob);
  expect(row?.messageId).toBeNull();
  expect(row?.reason).toBe("Spam");
  expect(row?.description).toBe(PC254_MARKER);
  expect(row?.status).toBe("OPEN");
});

test("举报不改变动态、评论数与评论线程", async ({ page }) => {
  await openReportDialog(page);
  const section = page.getByTestId("moment-comments");
  await expect(section).toContainText(ALICE_COMMENT_TEXT, { timeout: 20_000 });
  const before = await page.getByTestId("comment-count").textContent();

  await page.getByTestId("moment-report-reason").first().click();
  await page.getByTestId("moment-report-submit").click();
  await expect(page.getByTestId("moment-report-notice")).toBeVisible({ timeout: 20_000 });

  await expect(page.getByTestId("moment-detail")).toContainText(BOB_MOMENT_TEXT);
  await expect(page.getByTestId("comment-count")).toHaveText(before ?? "");
  await expect(section).toContainText(ALICE_COMMENT_TEXT);
});

test("提交期间按钮禁用，重复点击不会创建第二条举报", async ({ page }) => {
  const id = await momentId();
  await loginAndLand(page, EMAILS.carol);

  // Only the *delay* is synthetic; the request still goes to the real API and
  // the assertion is still read from PostgreSQL. Without a widened window the
  // in-flight state is unobservable on localhost.
  await page.route("**/api/v1/reports", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.continue();
  });

  await page.goto(`/moments/${id}`);
  await expect(page.getByTestId("moment-detail")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("moment-menu").click();
  await page.getByTestId("moment-report-open").click();
  await page.getByTestId("moment-report-reason").first().click();

  const submit = page.getByTestId("moment-report-submit");
  await submit.click();
  await expect(submit).toBeDisabled();

  // A second activation has to be inert: the guard drops it rather than
  // queueing a second report.
  await submit.dispatchEvent("click").catch(() => undefined);

  await expect(page.getByTestId("moment-report-dialog")).toHaveCount(0, { timeout: 20_000 });
  expect(await reportRows(id)).toBe(1);
});

test("举报自己的动态：服务端拒绝，弹层保留并显示中文错误，且不落库", async ({ page }) => {
  const carol = await userId(EMAILS.carol);
  const own = await prisma.moment.create({
    data: { userId: carol, platform: "TALKFIRST", content: PC254_OWN_MOMENT_TEXT, source: "USER" },
    select: { id: true },
  });

  await loginAndLand(page, EMAILS.carol);
  await page.goto(`/moments/${own.id}`);
  await expect(page.getByTestId("moment-detail")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("moment-menu").click();
  await page.getByTestId("moment-report-open").click();
  await page.getByTestId("moment-report-reason").first().click();
  await page.getByTestId("moment-report-submit").click();

  // The API's own refusal, translated once in `lib/errors.ts` — not a client-side
  // copy of the ownership rule.
  await expect(page.getByTestId("moment-report-error")).toHaveText("不能举报自己发布的内容。", {
    timeout: 20_000,
  });
  // A refusal is not a success: the dialog stays, the reason stays, and nothing
  // was written.
  await expect(page.getByTestId("moment-report-dialog")).toBeVisible();
  await expect(page.getByTestId("moment-report-submit")).toBeEnabled();
  expect(await reportRows(own.id)).toBe(0);
});

test("动态在提交前被删除：显示不存在错误，且不落库", async ({ page }) => {
  const id = await openReportDialog(page);
  await page.getByTestId("moment-report-reason").first().click();

  // Bypass the screen and drop the row: the API must answer 404 rather than
  // pretend the report was filed.
  await prisma.moment.delete({ where: { id } });
  await page.getByTestId("moment-report-submit").click();

  await expect(page.getByTestId("moment-report-error")).toHaveText("这条动态不存在或已被删除。", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("moment-report-dialog")).toBeVisible();
  expect(await reportRows(id)).toBe(0);
});

for (const viewport of PC254_DIALOG_VIEWPORTS) {
  test.describe(`举报弹层 @ ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test("原因列表、输入框与两个按钮都在屏幕内，且不横向溢出", async ({ page }) => {
      await openReportDialog(page);

      const [reasons, description, cancel, submit] = await Promise.all([
        page.getByTestId("moment-report-reasons").boundingBox(),
        page.getByTestId("moment-report-description").boundingBox(),
        page.getByTestId("moment-report-cancel").boundingBox(),
        page.getByTestId("moment-report-submit").boundingBox(),
      ]);
      if (!reasons || !description || !cancel || !submit) throw new Error("report dialog was not laid out");
      for (const box of [reasons, description, cancel, submit]) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(Math.round(box.x + box.width)).toBeLessThanOrEqual(viewport.width);
      }

      // Handed to the page: the callback runs in the browser, where the Node-side
      // `viewport` object does not exist.
      const overflow = await page
        .getByTestId("moment-report-dialog")
        .evaluate((element, width) => element.ownerDocument.documentElement.scrollWidth - width, viewport.width);
      expect(overflow).toBeLessThanOrEqual(1);

      // The controls stay usable at this width, not merely present.
      await page.getByTestId("moment-report-reason").first().click();
      await expect(page.getByTestId("moment-report-submit")).toBeEnabled();
      await page.getByTestId("moment-report-cancel").click();
      await expect(page.getByTestId("moment-report-dialog")).toHaveCount(0);
    });
  });
}

/**
 * 发布之后的管理：修改 / 删除动态，修改评论。
 *
 * These are the three writes a member makes about content they already
 * published, and until this phase none of them had a control in the member app:
 * the routes existed, `MomentEditDialog` was imported and never rendered, and
 * the comment editor was reachable only through a handler the detail screen
 * never passed. So the assertions that matter are the ones a purely local editor
 * cannot satisfy — the row in PostgreSQL, and the same value after a reload.
 *
 * Ownership is checked in both directions: the owner gets the menu items, and a
 * stranger gets exactly the report item she had before.
 */

const MGMT_OWN_MOMENT_TEXT = "PW 管理：卡罗尔自己的动态";
const MGMT_EDITED_TEXT = "PW 管理：修改后的正文";
const MGMT_OWN_COMMENT_TEXT = "PW 管理：卡罗尔自己的评论";
const MGMT_EDITED_COMMENT_TEXT = "PW 管理：修改后的评论";

/** Carol's own moment: the row the owner-only actions are supposed to act on. */
async function seedOwnMoment(content = MGMT_OWN_MOMENT_TEXT) {
  const carol = await userId(EMAILS.carol);
  return prisma.moment.create({
    data: {
      userId: carol,
      platform: "TALKFIRST",
      platformName: "TalkFirst",
      content,
      source: "USER",
    },
    select: { id: true },
  });
}

/**
 * Carol's own comment on Bob's moment, so the thread has a row she may edit.
 * `commentCount` is incremented the way `MomentsService.addComment` does — the
 * counter means top-level comments, and a helper that forgot it would make the
 * screen disagree with the API for reasons that have nothing to do with editing.
 */
async function seedOwnComment(momentIdValue: string, content = MGMT_OWN_COMMENT_TEXT) {
  const carol = await userId(EMAILS.carol);
  const comment = await prisma.momentComment.create({
    data: { momentId: momentIdValue, userId: carol, content },
    select: { id: true },
  });
  await prisma.moment.update({ where: { id: momentIdValue }, data: { commentCount: { increment: 1 } } });
  return comment;
}

test("作者在详情页可以修改自己的动态：保存后界面与数据库都是新正文，刷新仍在", async ({ page }) => {
  const own = await seedOwnMoment();
  await loginAndLand(page, EMAILS.carol);
  await page.goto(`/moments/${own.id}`);

  const detail = page.getByTestId("moment-detail");
  await expect(detail).toContainText(MGMT_OWN_MOMENT_TEXT, { timeout: 20_000 });

  await page.getByTestId("moment-menu").click();
  await page.getByTestId("moment-edit-open").click();

  // The editor opens on the server's own text rather than an empty draft.
  const editor = page.getByTestId("moment-edit-content");
  await expect(editor).toHaveValue(MGMT_OWN_MOMENT_TEXT);
  await editor.fill(MGMT_EDITED_TEXT);
  await page.getByTestId("moment-edit-save").click();

  // The dialog closes only after the API answered, and the card shows what the
  // route returned.
  await expect(page.getByTestId("moment-edit-save")).toHaveCount(0, { timeout: 20_000 });
  await expect(detail).toContainText(MGMT_EDITED_TEXT);
  await expect(detail).not.toContainText(MGMT_OWN_MOMENT_TEXT);

  // PostgreSQL holds the new body — not React state.
  const stored = await prisma.moment.findUnique({ where: { id: own.id }, select: { content: true } });
  expect(stored?.content).toBe(MGMT_EDITED_TEXT);

  await page.reload();
  await expect(page.getByTestId("moment-detail")).toContainText(MGMT_EDITED_TEXT, { timeout: 20_000 });
});

test("取消修改：弹层关闭，数据库里的正文一行都没变", async ({ page }) => {
  const own = await seedOwnMoment();
  await loginAndLand(page, EMAILS.carol);
  await page.goto(`/moments/${own.id}`);
  await expect(page.getByTestId("moment-detail")).toContainText(MGMT_OWN_MOMENT_TEXT, { timeout: 20_000 });

  await page.getByTestId("moment-menu").click();
  await page.getByTestId("moment-edit-open").click();
  await page.getByTestId("moment-edit-content").fill("PW 管理：被放弃的草稿");
  await page.getByRole("button", { name: "取消" }).click();

  await expect(page.getByTestId("moment-edit-content")).toHaveCount(0);
  await expect(page.getByTestId("moment-detail")).toContainText(MGMT_OWN_MOMENT_TEXT);
  const stored = await prisma.moment.findUnique({ where: { id: own.id }, select: { content: true } });
  expect(stored?.content).toBe(MGMT_OWN_MOMENT_TEXT);
});

test("作者在详情页可以删除自己的动态：确认后回到列表，数据库里也没有了", async ({ page }) => {
  const own = await seedOwnMoment();
  await loginAndLand(page, EMAILS.carol);
  await page.goto(`/moments/${own.id}`);
  await expect(page.getByTestId("moment-detail")).toContainText(MGMT_OWN_MOMENT_TEXT, { timeout: 20_000 });

  await page.getByTestId("moment-menu").click();
  await page.getByTestId("moment-delete-open").click();
  // 自绘二次确认，不是浏览器原生 confirm。
  await expect(page.getByTestId("moment-delete-confirm")).toBeVisible();
  await expect(page.getByText("删除后无法恢复，评论也会一并消失。")).toBeVisible();

  await page.getByTestId("moment-delete-confirm").click();

  await expect(page).toHaveURL(/\/moments$/, { timeout: 20_000 });
  expect(await prisma.moment.count({ where: { id: own.id } })).toBe(0);
});

test("取消删除：动态仍然存在，数据库里也还在", async ({ page }) => {
  const own = await seedOwnMoment();
  await loginAndLand(page, EMAILS.carol);
  await page.goto(`/moments/${own.id}`);
  await expect(page.getByTestId("moment-detail")).toContainText(MGMT_OWN_MOMENT_TEXT, { timeout: 20_000 });

  await page.getByTestId("moment-menu").click();
  await page.getByTestId("moment-delete-open").click();
  await page.getByRole("button", { name: "取消" }).click();

  await expect(page.getByTestId("moment-delete-confirm")).toHaveCount(0);
  await expect(page.getByTestId("moment-detail")).toContainText(MGMT_OWN_MOMENT_TEXT);
  expect(await prisma.moment.count({ where: { id: own.id } })).toBe(1);
});

test("别人的动态只提供举报：没有修改与删除入口", async ({ page }) => {
  const id = await momentId();
  await loginAndLand(page, EMAILS.carol);
  await page.goto(`/moments/${id}`);
  await expect(page.getByTestId("moment-detail")).toBeVisible({ timeout: 20_000 });

  // 先证明菜单确实打开了（举报项在），再断言另外两项不在。
  await page.getByTestId("moment-menu").click();
  await expect(page.getByTestId("moment-report-open")).toBeVisible();
  await expect(page.getByTestId("moment-edit-open")).toHaveCount(0);
  await expect(page.getByTestId("moment-delete-open")).toHaveCount(0);
});

test("评论作者可以修改自己的评论：列表与数据库都是新内容，刷新仍在", async ({ page }) => {
  const id = await momentId();
  const own = await seedOwnComment(id);

  const section = await openDetail(page);
  const item = commentItem(page, MGMT_OWN_COMMENT_TEXT);
  await expect(item).toBeVisible({ timeout: 20_000 });

  // 菜单只有自己的评论才有。
  await item.getByTestId("comment-menu").click();
  await item.getByTestId("comment-edit").click();

  /**
   * Everything after this point is scoped to the section by testid rather than
   * to `item`: opening the editor replaces the comment's body with an input, so
   * `item`'s own text filter would stop matching its target (and would stop
   * matching again after the fill). `comment-edit-form` stays visible for
   * exactly one comment, so these ids are unambiguous.
   */
  const editor = section.getByTestId("comment-edit-input");
  await expect(editor).toHaveValue(MGMT_OWN_COMMENT_TEXT, { timeout: 20_000 });
  await editor.fill(MGMT_EDITED_COMMENT_TEXT);
  await section.getByTestId("comment-edit-save").click();

  // 编辑器只在 API 确认后关闭，列表就地变成服务端返回的文本。
  await expect(section.getByTestId("comment-edit-form")).toHaveCount(0, { timeout: 20_000 });
  await expect(section.getByTestId("comment-list")).toContainText(MGMT_EDITED_COMMENT_TEXT);
  await expect(section).not.toContainText(MGMT_OWN_COMMENT_TEXT);
  // 改内容不改变评论数（仍然只统计一级评论）。
  await expect(section.getByTestId("comment-count")).toHaveText("评论 · 2");

  const stored = await prisma.momentComment.findUnique({ where: { id: own.id }, select: { content: true } });
  expect(stored?.content).toBe(MGMT_EDITED_COMMENT_TEXT);

  await page.reload();
  await expect(
    page.getByTestId("moment-comments").getByTestId("comment-list"),
  ).toContainText(MGMT_EDITED_COMMENT_TEXT, { timeout: 20_000 });
});

test("评论修改被服务端拒绝时保留编辑器与草稿，界面不回退成已保存", async ({ page }) => {
  const id = await momentId();
  const own = await seedOwnComment(id);

  const section = await openDetail(page);
  const item = commentItem(page, MGMT_OWN_COMMENT_TEXT);
  await expect(item).toBeVisible({ timeout: 20_000 });
  await item.getByTestId("comment-menu").click();
  await item.getByTestId("comment-edit").click();

  const editor = section.getByTestId("comment-edit-input");
  await expect(editor).toHaveValue(MGMT_OWN_COMMENT_TEXT, { timeout: 20_000 });
  await editor.fill(MGMT_EDITED_COMMENT_TEXT);

  // 绕过界面把这一行删掉：服务端必须回答 404 COMMENT_NOT_FOUND，而不是假装成功，
  // 界面也不能把草稿当成已保存的内容。
  await prisma.momentComment.delete({ where: { id: own.id } });
  await section.getByTestId("comment-edit-save").click();

  await expect(section.getByTestId("comment-edit-error")).toHaveText("这条评论已经不存在了", { timeout: 20_000 });
  await expect(section.getByTestId("comment-edit-form")).toBeVisible();
  await expect(editor).toHaveValue(MGMT_EDITED_COMMENT_TEXT);
  expect(await prisma.momentComment.count({ where: { id: own.id } })).toBe(0);
});

test("别人的评论没有修改入口", async ({ page }) => {
  const section = await openDetail(page);
  const theirs = commentItem(page, ALICE_COMMENT_TEXT);
  await expect(theirs).toBeVisible({ timeout: 20_000 });

  // The fixture comment belongs to Alice while Carol is signed in, so no menu is
  // rendered at all — not an edit item and not a delete item. What stops a
  // forged request is `COMMENT_FORBIDDEN` in `moments-management.spec.ts`; a
  // hidden control is never the boundary.
  await expect(theirs.getByTestId("comment-menu")).toHaveCount(0);
  await expect(section.getByTestId("comment-edit")).toHaveCount(0);
  await expect(theirs.getByTestId("comment-edit-form")).toHaveCount(0);
});
