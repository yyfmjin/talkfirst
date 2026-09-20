import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAndLand } from "../fixtures/browser";
import { ALICE_COMMENT_TEXT, BOB_MOMENT_TEXT, EMAILS, seed } from "../fixtures/profile";

/**
 * PC-3.1e — the Notification Center, driven through a real browser against a
 * real API and a real PostgreSQL database.
 *
 * The rows are written straight into `Notification` rather than produced by
 * exercising Connections / Moments / Admin, because what is under test here is
 * the *read* side. Writing them directly is also the only way to reach the
 * states the read side has to survive: a row with no PC-3.1a envelope, a row
 * whose `data` is not JSON at all, and rows that share one `createdAt` so the
 * cursor has to fall back to its `id` tie-break.
 *
 * Everything the UI asserts is read back from PostgreSQL separately where it
 * matters, so a screen that re-rendered local state would still be caught.
 */

const prisma = new PrismaClient();

/** Conversations this spec created, torn down in `afterAll`. */
const createdConversations: string[] = [];

/**
 * Re-seeding before every test drops the previous test's notifications along
 * with the accounts they belonged to (`Notification.userId` cascades), so no
 * test can inherit another's unread count.
 */
test.beforeEach(async () => {
  await seed(prisma);
});

test.afterAll(async () => {
  if (createdConversations.length > 0) {
    await prisma.conversation.deleteMany({ where: { id: { in: createdConversations } } });
  }
  await prisma.$disconnect();
});

type NoticeSeed = {
  type: string;
  title: string;
  body?: string | null;
  data?: string | null;
  readAt?: Date | null;
  createdAt?: Date;
};

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

async function fixtureUserId(email: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) throw new Error(`fixture account missing: ${email}`);
  return user.id;
}

async function seedNotices(rows: NoticeSeed[], email: string = EMAILS.alice): Promise<void> {
  if (rows.length === 0) return;
  const userId = await fixtureUserId(email);
  await prisma.notification.createMany({
    data: rows.map((row) => ({
      userId,
      type: row.type,
      title: row.title,
      body: row.body ?? null,
      data: row.data ?? null,
      readAt: row.readAt ?? null,
      createdAt: row.createdAt ?? new Date(),
    })),
  });
}

/** Bob's PC-2.1 moment: a real, `everyone`-visible target to navigate into. */
async function fixtureMomentId(): Promise<string> {
  const moment = await prisma.moment.findFirst({
    where: { content: BOB_MOMENT_TEXT },
    select: { id: true },
  });
  if (!moment) throw new Error("PC-2.1 fixture moment missing");
  return moment.id;
}

/** Alice's PC-2.2 comment on Bob's moment: a real `COMMENT` target. */
async function fixtureCommentId(): Promise<string> {
  const comment = await prisma.momentComment.findFirst({
    where: { content: ALICE_COMMENT_TEXT },
    select: { id: true },
  });
  if (!comment) throw new Error("PC-2.2 fixture comment missing");
  return comment.id;
}

/** A real conversation, so a `CONVERSATION` target is genuinely routable. */
async function fixtureConversationId(): Promise<string> {
  const [alice, bob] = [await fixtureUserId(EMAILS.alice), await fixtureUserId(EMAILS.bob)];
  const conversation = await prisma.conversation.create({
    data: { members: { create: [{ userId: alice }, { userId: bob }] } },
    select: { id: true },
  });
  createdConversations.push(conversation.id);
  return conversation.id;
}

async function openCenter(page: Page): Promise<void> {
  await page.goto("/notifications");
  await expect(page.getByTestId("notification-filter")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("notification-loading")).toHaveCount(0, { timeout: 20_000 });
}

async function openCenterAs(page: Page, email: string): Promise<void> {
  await loginAndLand(page, email);
  await openCenter(page);
}

function itemTitled(page: Page, title: string) {
  return page.getByTestId("notification-item").filter({ hasText: title });
}

async function itemTypes(page: Page): Promise<Array<string | null>> {
  return page
    .getByTestId("notification-item")
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-notification-type")));
}

async function itemTitles(page: Page): Promise<string[]> {
  return page
    .getByTestId("notification-item")
    .evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? "").trim()));
}

/** The count PostgreSQL actually holds as unread for one account. */
async function unreadInDatabase(email: string): Promise<number> {
  const userId = await fixtureUserId(email);
  return prisma.notification.count({ where: { userId, readAt: null } });
}

// ─────────────────────────────────────────────────────────────────────────────
// The list
// ─────────────────────────────────────────────────────────────────────────────

test("通知中心展示真实通知，未读数来自 API 而不是本页条数", async ({ page }) => {
  await seedNotices([
    { type: "MOMENT_COMMENT", title: "有人评论了你的动态", body: "风景不错", createdAt: minutesAgo(1) },
    { type: "SAY_HELLO", title: "有人向你打招呼", createdAt: minutesAgo(2) },
    { type: "NEW_MESSAGE", title: "你有一条新消息", createdAt: minutesAgo(3), readAt: minutesAgo(3) },
  ]);
  await openCenterAs(page, EMAILS.alice);

  await expect(page.getByTestId("notification-item")).toHaveCount(3);
  await expect(page.getByText("有人评论了你的动态", { exact: true })).toBeVisible();
  await expect(page.getByText("风景不错", { exact: true })).toBeVisible();
  await expect(page.getByTestId("notification-unread-count")).toHaveText("未读 2");
  await expect(itemTitled(page, "有人评论了你的动态")).toHaveAttribute("data-unread", "true");
  await expect(itemTitled(page, "你有一条新消息")).toHaveAttribute("data-unread", "false");
});

test("没有通知时显示空态，且不显示加载更多", async ({ page }) => {
  await openCenterAs(page, EMAILS.alice);

  await expect(page.getByTestId("notification-empty")).toHaveText("暂无通知");
  await expect(page.getByTestId("notification-item")).toHaveCount(0);
  await expect(page.getByTestId("notification-load-more")).toHaveCount(0);
  await expect(page.getByTestId("notification-unread-count")).toHaveText("未读 0");
  await expect(page.getByTestId("notification-mark-all")).toBeDisabled();
});

test("未读数是全部通知的未读数：type 过滤只收窄列表，不收窄计数", async ({ page }) => {
  await seedNotices([
    { type: "MOMENT_REPLY", title: "评论收到回复", createdAt: minutesAgo(1) },
    { type: "MOMENT_COMMENT", title: "动态收到评论 A", createdAt: minutesAgo(2) },
    { type: "MOMENT_COMMENT", title: "动态收到评论 B", createdAt: minutesAgo(3) },
  ]);
  await openCenterAs(page, EMAILS.alice);

  await expect(page.getByTestId("notification-unread-count")).toHaveText("未读 3");
  await page.getByTestId("notification-filter").selectOption("MOMENT_REPLY");

  await expect(page.getByTestId("notification-item")).toHaveCount(1);
  expect(await itemTypes(page)).toEqual(["MOMENT_REPLY"]);
  await expect(page.getByTestId("notification-unread-count")).toHaveText("未读 3");
});

test("类型过滤器使用中文标签，不把 type 枚举暴露给用户", async ({ page }) => {
  await seedNotices([{ type: "MOMENT_REPLY", title: "评论收到回复", createdAt: minutesAgo(1) }]);
  await openCenterAs(page, EMAILS.alice);

  const options = await page.getByTestId("notification-filter").locator("option").allTextContents();
  expect(options).toHaveLength(11);
  expect(options[0]).toBe("全部");
  expect(options).toContain("评论收到回复");
  expect(options).not.toContain("MOMENT_REPLY");
  await expect(itemTitled(page, "评论收到回复")).not.toContainText("MOMENT_REPLY");
});

// ─────────────────────────────────────────────────────────────────────────────
// One row read
// ─────────────────────────────────────────────────────────────────────────────

test("点击未读通知：后端 readAt 被写入、行转已读、未读数减一", async ({ page }) => {
  await seedNotices([
    { type: "MOMENT_COMMENT", title: "第一条评论通知", createdAt: minutesAgo(1) },
    { type: "MOMENT_COMMENT", title: "第二条评论通知", createdAt: minutesAgo(2), readAt: minutesAgo(2) },
  ]);
  await openCenterAs(page, EMAILS.alice);

  const item = itemTitled(page, "第一条评论通知");
  await expect(item).toHaveAttribute("data-unread", "true");
  await item.click();

  await expect(item).toHaveAttribute("data-unread", "false");
  await expect(page.getByTestId("notification-unread")).toHaveCount(0);
  await expect(page.getByTestId("notification-unread-count")).toHaveText("未读 1");

  const stored = await prisma.notification.findFirst({
    where: { userId: await fixtureUserId(EMAILS.alice), title: "第一条评论通知" },
    select: { readAt: true },
  });
  expect(stored?.readAt).not.toBeNull();
  expect(await unreadInDatabase(EMAILS.alice)).toBe(1);

  // No navigation: the row carries no envelope, so it stays readable in place.
  await expect(page).toHaveURL(/\/notifications$/);
});

test("重复点击已读通知不会报错，也不会再次改写 readAt", async ({ page }) => {
  await seedNotices([{ type: "MOMENT_COMMENT", title: "幂等评论通知", createdAt: minutesAgo(1) }]);
  await openCenterAs(page, EMAILS.alice);

  const item = itemTitled(page, "幂等评论通知");
  await item.click();
  await expect(item).toHaveAttribute("data-unread", "false");

  const first = await prisma.notification.findFirst({
    where: { userId: await fixtureUserId(EMAILS.alice), title: "幂等评论通知" },
    select: { readAt: true },
  });
  await item.click();
  await expect(item).toHaveAttribute("data-unread", "false");
  await expect(page.getByTestId("notification-action-error")).toHaveCount(0);

  const second = await prisma.notification.findFirst({
    where: { userId: await fixtureUserId(EMAILS.alice), title: "幂等评论通知" },
    select: { readAt: true },
  });
  expect(second?.readAt?.getTime()).toBe(first?.readAt?.getTime());
});

// ─────────────────────────────────────────────────────────────────────────────
// Mark all read
// ─────────────────────────────────────────────────────────────────────────────

test("全部已读：所有行转已读、未读归零、PostgreSQL 同步", async ({ page }) => {
  await seedNotices([
    { type: "MOMENT_LIKE", title: "动态收到赞 A", createdAt: minutesAgo(1) },
    { type: "MOMENT_LIKE", title: "动态收到赞 B", createdAt: minutesAgo(2) },
    { type: "MOMENT_LIKE", title: "动态收到赞 C", createdAt: minutesAgo(3), readAt: minutesAgo(3) },
  ]);
  await openCenterAs(page, EMAILS.alice);
  await expect(page.getByTestId("notification-unread-count")).toHaveText("未读 2");

  await page.getByTestId("notification-mark-all").click();

  await expect(page.getByTestId("notification-unread-count")).toHaveText("未读 0");
  await expect(page.getByTestId("notification-unread")).toHaveCount(0);
  await expect(page.getByTestId("notification-mark-all")).toBeDisabled();
  expect(await unreadInDatabase(EMAILS.alice)).toBe(0);
});

test("全部已读只影响当前用户：别人的未读一条不动", async ({ page }) => {
  await seedNotices([
    { type: "MOMENT_LIKE", title: "我的未读 A", createdAt: minutesAgo(1) },
    { type: "MOMENT_LIKE", title: "我的未读 B", createdAt: minutesAgo(2) },
  ]);
  await seedNotices(
    [
      { type: "MOMENT_LIKE", title: "别人的未读 A", createdAt: minutesAgo(1) },
      { type: "MOMENT_LIKE", title: "别人的未读 B", createdAt: minutesAgo(2) },
    ],
    EMAILS.bob,
  );
  await openCenterAs(page, EMAILS.alice);

  await page.getByTestId("notification-mark-all").click();
  await expect(page.getByTestId("notification-unread-count")).toHaveText("未读 0");

  expect(await unreadInDatabase(EMAILS.alice)).toBe(0);
  expect(await unreadInDatabase(EMAILS.bob)).toBe(2);
});

// ─────────────────────────────────────────────────────────────────────────────
// Cursor pagination
// ─────────────────────────────────────────────────────────────────────────────

function label(index: number): string {
  return String(index).padStart(2, "0");
}

test("分页：首屏 20 条，加载更多追加下一页，无重复无遗漏", async ({ page }) => {
  await seedNotices(
    Array.from({ length: 25 }, (_, index) => ({
      type: "NEW_MESSAGE",
      title: `分页通知 ${label(index + 1)}`,
      createdAt: minutesAgo(index + 1),
    })),
  );
  await openCenterAs(page, EMAILS.alice);

  await expect(page.getByTestId("notification-item")).toHaveCount(20);
  const firstPage = await itemTitles(page);
  expect(firstPage[0]).toContain(`分页通知 ${label(1)}`);
  await expect(page.getByTestId("notification-load-more")).toBeVisible();

  await page.getByTestId("notification-load-more").click();

  await expect(page.getByTestId("notification-item")).toHaveCount(25);
  const all = await itemTitles(page);
  expect(new Set(all).size).toBe(25);
  expect(all[0]).toContain(`分页通知 ${label(1)}`);
  expect(all[24]).toContain(`分页通知 ${label(25)}`);
  await expect(page.getByTestId("notification-item").first()).toContainText(`分页通知 ${label(1)}`);
  await expect(page.getByTestId("notification-load-more")).toHaveCount(0);
});

test("同一 createdAt 的 23 条：cursor 退回 id 定序，翻页不重复不遗漏", async ({ page }) => {
  // One identical instant for every row, so `createdAt` alone cannot order them
  // and only the `id` tie-break can keep the boundary stable.
  const sameInstant = minutesAgo(30);
  await seedNotices(
    Array.from({ length: 23 }, (_, index) => ({
      type: "MOMENT_REPLY",
      title: `同刻通知 ${label(index + 1)}`,
      createdAt: sameInstant,
    })),
  );
  await openCenterAs(page, EMAILS.alice);

  const stored = await prisma.notification.count({
    where: { userId: await fixtureUserId(EMAILS.alice), type: "MOMENT_REPLY" },
  });
  expect(stored).toBe(23);
  await expect(page.getByTestId("notification-item")).toHaveCount(20);

  await page.getByTestId("notification-load-more").click();
  await expect(page.getByTestId("notification-item")).toHaveCount(23);

  const all = await itemTitles(page);
  expect(new Set(all).size).toBe(23);
  for (let index = 1; index <= 23; index += 1) {
    const seen = all.filter((text) => text.includes(`同刻通知 ${label(index)}`));
    expect(seen, `同刻通知 ${label(index)} 应恰好出现一次`).toHaveLength(1);
  }
  await expect(page.getByTestId("notification-load-more")).toHaveCount(0);
});

test("type 过滤与 cursor 叠加：跨页只返回该类型，且不重复", async ({ page }) => {
  await seedNotices([
    ...Array.from({ length: 23 }, (_, index) => ({
      type: "MOMENT_REPLY",
      title: `回复通知 ${label(index + 1)}`,
      createdAt: minutesAgo(index + 1),
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      type: "MOMENT_LIKE",
      title: `点赞通知 ${label(index + 1)}`,
      createdAt: minutesAgo(index + 1),
    })),
  ]);
  await openCenterAs(page, EMAILS.alice);

  await page.getByTestId("notification-filter").selectOption("MOMENT_REPLY");
  await expect(page.getByTestId("notification-item")).toHaveCount(20);
  expect(await itemTypes(page)).toEqual(Array(20).fill("MOMENT_REPLY"));

  await page.getByTestId("notification-load-more").click();
  await expect(page.getByTestId("notification-item")).toHaveCount(23);
  expect(await itemTypes(page)).toEqual(Array(23).fill("MOMENT_REPLY"));
  expect(new Set(await itemTitles(page)).size).toBe(23);
  await expect(page.getByTestId("notification-load-more")).toHaveCount(0);
});

test("切换类型过滤器：清空列表与 cursor，从第一页重新读", async ({ page }) => {
  await seedNotices([
    ...Array.from({ length: 25 }, (_, index) => ({
      type: "MOMENT_REPLY",
      title: `回复通知 ${label(index + 1)}`,
      createdAt: minutesAgo(index + 1),
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      type: "NEW_MESSAGE",
      title: `消息通知 ${label(index + 1)}`,
      createdAt: minutesAgo(index + 50),
    })),
  ]);
  await openCenterAs(page, EMAILS.alice);

  await page.getByTestId("notification-load-more").click();
  await expect(page.getByTestId("notification-item")).toHaveCount(25);

  await page.getByTestId("notification-filter").selectOption("NEW_MESSAGE");
  await expect(page.getByTestId("notification-item")).toHaveCount(3);
  expect(await itemTypes(page)).toEqual(Array(3).fill("NEW_MESSAGE"));
  await expect(page.getByTestId("notification-load-more")).toHaveCount(0);

  await page.getByTestId("notification-filter").selectOption("ALL");
  await expect(page.getByTestId("notification-item")).toHaveCount(20);
  await expect(page.getByTestId("notification-load-more")).toBeVisible();
});

// ─────────────────────────────────────────────────────────────────────────────
// Legacy / damaged `data`
// ─────────────────────────────────────────────────────────────────────────────

test("旧格式 data（没有 envelope）仍可读，点击只标记已读不跳转", async ({ page }) => {
  const momentId = await fixtureMomentId();
  await seedNotices([
    {
      type: "MOMENT_COMMENT",
      title: "旧格式评论通知",
      data: JSON.stringify({ momentId, commentId: "4d1f0f8e-1b0a-4a4e-9a2f-2f4a3b6c7d8e" }),
      createdAt: minutesAgo(1),
    },
  ]);
  await openCenterAs(page, EMAILS.alice);

  const item = itemTitled(page, "旧格式评论通知");
  await expect(item).toHaveAttribute("data-unread", "true");
  await item.click();

  await expect(item).toHaveAttribute("data-unread", "false");
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByTestId("notification-error")).toHaveCount(0);
  await expect(page.getByTestId("notification-action-error")).toHaveCount(0);
  expect(await unreadInDatabase(EMAILS.alice)).toBe(0);
});

test("data 不是合法 JSON：不崩、不跳转、不影响其它通知", async ({ page }) => {
  await seedNotices([
    { type: "MOMENT_LIKE", title: "损坏数据通知", data: "{not json", createdAt: minutesAgo(1) },
    { type: "MOMENT_LIKE", title: "空数据通知", data: null, createdAt: minutesAgo(2) },
  ]);
  await openCenterAs(page, EMAILS.alice);

  await expect(page.getByTestId("notification-item")).toHaveCount(2);
  await expect(page.getByTestId("notification-error")).toHaveCount(0);

  const broken = itemTitled(page, "损坏数据通知");
  await broken.click();
  await expect(broken).toHaveAttribute("data-unread", "false");
  await expect(page).toHaveURL(/\/notifications$/);
  expect(await unreadInDatabase(EMAILS.alice)).toBe(1);
});

test("target 已不存在：通知仍可读，跳转落到友好的不存在状态", async ({ page }) => {
  const goneId = "00000000-0000-0000-0000-000000000000";
  await seedNotices([
    {
      type: "MOMENT_COMMENT",
      title: "目标已消失的动态",
      data: JSON.stringify({ targetType: "MOMENT", targetId: goneId, momentId: goneId }),
      createdAt: minutesAgo(1),
    },
  ]);
  await openCenterAs(page, EMAILS.alice);

  await itemTitled(page, "目标已消失的动态").click();
  await expect(page).toHaveURL(new RegExp(`/moments/${goneId}$`), { timeout: 20_000 });
  await expect(page.getByText("这条动态不存在或已被删除", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  expect(await unreadInDatabase(EMAILS.alice)).toBe(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Target navigation
// ─────────────────────────────────────────────────────────────────────────────

test("动态通知（MOMENT target）先标记已读，再跳到动态详情", async ({ page }) => {
  const [momentId, actorId] = [await fixtureMomentId(), await fixtureUserId(EMAILS.bob)];
  await seedNotices([
    {
      type: "MOMENT_COMMENT",
      title: "有人评论了你的动态",
      data: JSON.stringify({
        actorId,
        targetType: "MOMENT",
        targetId: momentId,
        momentId,
        commentId: "4d1f0f8e-1b0a-4a4e-9a2f-2f4a3b6c7d8e",
      }),
      createdAt: minutesAgo(1),
    },
  ]);
  await openCenterAs(page, EMAILS.alice);

  await itemTitled(page, "有人评论了你的动态").click();
  await expect(page).toHaveURL(new RegExp(`/moments/${momentId}$`), { timeout: 20_000 });
  await expect(page.getByText(BOB_MOMENT_TEXT, { exact: false })).toBeVisible({ timeout: 20_000 });
  expect(await unreadInDatabase(EMAILS.alice)).toBe(0);
});

test("评论回复通知（COMMENT target）跳到所属动态", async ({ page }) => {
  const momentId = await fixtureMomentId();
  const parentCommentId = await fixtureCommentId();
  await seedNotices([
    {
      type: "MOMENT_REPLY",
      title: "有人回复了你的评论",
      data: JSON.stringify({
        actorId: await fixtureUserId(EMAILS.bob),
        targetType: "COMMENT",
        targetId: parentCommentId,
        momentId,
        commentId: "4d1f0f8e-1b0a-4a4e-9a2f-2f4a3b6c7d8e",
        parentCommentId,
      }),
      createdAt: minutesAgo(1),
    },
  ]);
  await openCenterAs(page, EMAILS.alice);

  await itemTitled(page, "有人回复了你的评论").click();
  await expect(page).toHaveURL(new RegExp(`/moments/${momentId}$`), { timeout: 20_000 });
});

test("新消息通知（CONVERSATION target）跳到会话", async ({ page }) => {
  const conversationId = await fixtureConversationId();
  await seedNotices([
    {
      type: "NEW_MESSAGE",
      title: "你有一条新消息",
      data: JSON.stringify({
        actorId: await fixtureUserId(EMAILS.bob),
        targetType: "CONVERSATION",
        targetId: conversationId,
        conversationId,
        messageId: "4d1f0f8e-1b0a-4a4e-9a2f-2f4a3b6c7d8e",
      }),
      createdAt: minutesAgo(1),
    },
  ]);
  await openCenterAs(page, EMAILS.alice);

  await itemTitled(page, "你有一条新消息").click();
  await expect(page).toHaveURL(new RegExp(`/messages/${conversationId}$`), { timeout: 20_000 });
});

test("打招呼回到消息页，交换请求跳到交换面板", async ({ page }) => {
  const [conversationId, actorId] = [await fixtureConversationId(), await fixtureUserId(EMAILS.bob)];
  await seedNotices([
    {
      type: "SAY_HELLO",
      title: "有人向你打招呼",
      data: JSON.stringify({
        actorId,
        targetType: "CONNECTION",
        targetId: "9f1f0f8e-1b0a-4a4e-9a2f-2f4a3b6c7d8e",
      }),
      createdAt: minutesAgo(1),
    },
    {
      type: "EXCHANGE_REQUEST",
      title: "有人想和你交换联系方式",
      data: JSON.stringify({
        actorId,
        targetType: "EXCHANGE",
        targetId: "9f1f0f8e-1b0a-4a4e-9a2f-2f4a3b6c7d8f",
        exchangeId: "9f1f0f8e-1b0a-4a4e-9a2f-2f4a3b6c7d8f",
        conversationId,
      }),
      createdAt: minutesAgo(2),
    },
  ]);
  await openCenterAs(page, EMAILS.alice);

  await itemTitled(page, "有人想和你交换联系方式").click();
  await expect(page).toHaveURL(new RegExp(`/messages/${conversationId}/connect$`), {
    timeout: 20_000,
  });

  await openCenter(page);
  await itemTitled(page, "有人向你打招呼").click();
  await expect(page).toHaveURL(/\/messages$/, { timeout: 20_000 });
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin identity never leaks
// ─────────────────────────────────────────────────────────────────────────────

test("举报处理结果与账号状态通知可读，且不泄露任何管理员身份", async ({ page }) => {
  const aliceId = await fixtureUserId(EMAILS.alice);
  const reportId = "4d1f0f8e-1b0a-4a4e-9a2f-2f4a3b6c7d8e";
  await seedNotices([
    {
      type: "REPORT_REVIEW",
      title: "举报处理结果",
      body: "你提交的举报已处理。",
      data: JSON.stringify({ targetType: "REPORT", targetId: reportId, reportId, status: "RESOLVED" }),
      createdAt: minutesAgo(1),
    },
    {
      type: "USER_STATUS",
      title: "账号状态更新",
      body: "你的账号已被暂时限制。",
      data: JSON.stringify({
        targetType: "USER",
        targetId: aliceId,
        status: "SUSPENDED",
        suspendedUntil: "2026-10-01T00:00:00.000Z",
      }),
      createdAt: minutesAgo(2),
    },
  ]);
  await openCenterAs(page, EMAILS.alice);

  await expect(page.getByTestId("notification-item")).toHaveCount(2);
  await expect(page.getByText("你提交的举报已处理。", { exact: true })).toBeVisible();

  const text = (await page.locator("body").innerText()).toLowerCase();
  for (const forbidden of ["admin", "administrator", "管理员", "passwordhash", "email"]) {
    expect(text, `页面不应出现 ${forbidden}`).not.toContain(forbidden);
  }

  // A report result has no member-facing screen: it must stay in place.
  await itemTitled(page, "举报处理结果").click();
  await expect(itemTitled(page, "举报处理结果")).toHaveAttribute("data-unread", "false");
  await expect(page).toHaveURL(/\/notifications$/);

  // A status change points at the account it concerns.
  await itemTitled(page, "账号状态更新").click();
  await expect(page).toHaveURL(new RegExp(`/profile/${aliceId}$`), { timeout: 20_000 });
});

// ─────────────────────────────────────────────────────────────────────────────
// Messages hub compatibility
// ─────────────────────────────────────────────────────────────────────────────

test("消息页入口进入通知中心，旧面板仍然只预览五条", async ({ page }) => {
  await seedNotices(
    Array.from({ length: 8 }, (_, index) => ({
      type: "MOMENT_LIKE",
      title: `动态收到赞 ${label(index + 1)}`,
      createdAt: minutesAgo(index + 1),
    })),
  );
  await loginAndLand(page, EMAILS.alice);
  await page.goto("/messages");

  await expect(page.getByTestId("notification-item")).toHaveCount(5, { timeout: 20_000 });
  await expect(page.getByText("动态收到赞 01", { exact: true })).toBeVisible();
  await expect(page.getByText("动态收到赞 06", { exact: true })).toHaveCount(0);

  await page.getByTestId("notification-center-entry").click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByTestId("notification-item")).toHaveCount(8, { timeout: 20_000 });
});

// ─────────────────────────────────────────────────────────────────────────────
// Narrow screens
// ─────────────────────────────────────────────────────────────────────────────

test("375 / 390 / 430 宽度下不横向溢出，长文案正常换行，控件都点得到", async ({ page }) => {
  const longText = "这是一条非常长的通知正文".repeat(6);
  await seedNotices([
    {
      type: "MOMENT_COMMENT",
      title: `非常长的通知标题${longText}`,
      body: longText,
      createdAt: minutesAgo(1),
    },
    ...Array.from({ length: 21 }, (_, index) => ({
      type: "MOMENT_REPLY",
      title: `窄屏通知 ${label(index + 1)}`,
      createdAt: minutesAgo(index + 2),
    })),
  ]);
  await loginAndLand(page, EMAILS.alice);

  for (const width of [375, 390, 430]) {
    await page.setViewportSize({ width, height: 812 });
    await openCenter(page);
    await expect(page.getByTestId("notification-item")).toHaveCount(20);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${width}px 不应横向溢出`).toBeLessThanOrEqual(0);

    for (const testId of ["notification-mark-all", "notification-filter", "notification-load-more"]) {
      const box = await page.getByTestId(testId).boundingBox();
      expect(box, `${width}px 下 ${testId} 应可见`).not.toBeNull();
      expect(box!.x, `${width}px 下 ${testId} 不应溢出左侧`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${width}px 下 ${testId} 不应溢出右侧`).toBeLessThanOrEqual(
        width + 1,
      );
    }

    await page.getByTestId("notification-load-more").click();
    await expect(page.getByTestId("notification-item")).toHaveCount(22);
  }
});
