import { expect, test, type Locator, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAndLand } from "../fixtures/browser";
import { EMAILS, seed } from "../fixtures/profile";

/**
 * 动态列表里「自己的动态」必须能删 —— 且不依赖当前是哪个标签页。
 *
 * ## The bug these tests pin
 *
 * The feed card's delete control was rendered with `isMine={tab === "mine"}`: it
 * appeared ONLY on the 「我的」 tab. A member who posted something and then spotted
 * a mistake while scrolling the default 「推荐」 feed had no delete button and no
 * hint that switching tabs would produce one. Ownership is a property of the row,
 * not of the filter, so the card now compares `moment.userId` with the signed-in
 * user's id.
 *
 * ## Why the assertion is about the DEFAULT tab
 *
 * Asserting on 「我的」 would have passed before the fix — the old code showed the
 * button there. The regression is specifically "wrong tab => no control", so the
 * 推荐 tab is the whole point.
 */

const prisma = new PrismaClient();
const OWN_MOMENT_TEXT = "PW 列表删除：卡罗尔自己的动态";

test.beforeEach(async () => {
  await seed(prisma);
});

test.afterAll(async () => {
  const carol = await prisma.user.findUnique({ where: { email: EMAILS.carol }, select: { id: true } });
  if (carol) await prisma.moment.deleteMany({ where: { userId: carol.id, content: OWN_MOMENT_TEXT } });
  await prisma.$disconnect();
});

/** Carol's own moment, created directly so the feed has a card she authored. */
async function seedOwnMoment() {
  const carol = await prisma.user.findUnique({ where: { email: EMAILS.carol }, select: { id: true } });
  if (!carol) throw new Error("fixture account missing: carol");
  return prisma.moment.create({
    data: { userId: carol.id, platform: "TALKFIRST", platformName: "TalkFirst", content: OWN_MOMENT_TEXT, source: "USER" },
    select: { id: true },
  });
}

function cardWith(page: Page, text: string): Locator {
  return page.locator("article").filter({ hasText: text });
}

test("默认「推荐」标签页就能看到自己动态的删除按钮（回归：原先只在「我的」显示）", async ({ page }) => {
  const own = await seedOwnMoment();

  await loginAndLand(page, EMAILS.carol);
  await page.goto("/moments");

  // Deliberately NOT switching tabs: 推荐 is the default and is where the member
  // notices the mistake.
  const ownCard = cardWith(page, OWN_MOMENT_TEXT);
  await expect(ownCard).toBeVisible({ timeout: 20_000 });
  await expect(ownCard.getByRole("button", { name: "删除动态" })).toBeVisible();

  // Access is decided by ownership, so permission is checked regardless.
  expect(await prisma.moment.count({ where: { id: own.id } })).toBe(1);
});

test("别人的动态没有删除按钮（对照，防止「一律显示」）", async ({ page }) => {
  await seedOwnMoment();
  await loginAndLand(page, EMAILS.carol);
  await page.goto("/moments");

  // Bob's fixture moment is authored by someone else and has no delete control.
  const othersCard = cardWith(page, "PW PC-1.4 fixture moment");
  await expect(othersCard).toBeVisible({ timeout: 20_000 });
  await expect(othersCard.getByRole("button", { name: "删除动态" })).toHaveCount(0);

  // …while Carol's own card in the SAME list does have one. Without this the test
  // would pass trivially if the feed rendered nothing at all.
  await expect(cardWith(page, OWN_MOMENT_TEXT).getByRole("button", { name: "删除动态" })).toBeVisible();
});

test("在「推荐」标签页直接删除：确认后从列表消失，数据库里也没有了", async ({ page }) => {
  const own = await seedOwnMoment();
  await loginAndLand(page, EMAILS.carol);
  await page.goto("/moments");

  const ownCard = cardWith(page, OWN_MOMENT_TEXT);
  await expect(ownCard).toBeVisible({ timeout: 20_000 });
  await ownCard.getByRole("button", { name: "删除动态" }).click();

  // The app's own confirmation dialog, not window.confirm.
  await expect(page.getByTestId("moment-delete-confirm")).toBeVisible();
  await expect(page.getByText("删除后无法恢复，评论也会一并消失。")).toBeVisible();
  await page.getByTestId("moment-delete-confirm").click();

  // The row leaves only after the API answered, and it is really gone.
  await expect(ownCard).toHaveCount(0, { timeout: 20_000 });
  expect(await prisma.moment.count({ where: { id: own.id } })).toBe(0);

  // A reload agrees with the screen.
  await page.reload();
  await expect(page.getByText(OWN_MOMENT_TEXT)).toHaveCount(0, { timeout: 20_000 });
});

test("取消删除：动态保留，数据库未变", async ({ page }) => {
  const own = await seedOwnMoment();
  await loginAndLand(page, EMAILS.carol);
  await page.goto("/moments");

  const ownCard = cardWith(page, OWN_MOMENT_TEXT);
  await expect(ownCard).toBeVisible({ timeout: 20_000 });
  await ownCard.getByRole("button", { name: "删除动态" }).click();
  await expect(page.getByTestId("moment-delete-confirm")).toBeVisible();
  await page.getByRole("button", { name: "取消" }).click();

  await expect(page.getByTestId("moment-delete-confirm")).toHaveCount(0);
  await expect(ownCard).toBeVisible();
  expect(await prisma.moment.count({ where: { id: own.id } })).toBe(1);
});

test("对自己的动态：每个标签页都能删；对别人的：每个标签页都不能", async ({ page }) => {
  await seedOwnMoment();
  await loginAndLand(page, EMAILS.carol);
  await page.goto("/moments");

  const ownCard = cardWith(page, OWN_MOMENT_TEXT);
  const othersCard = cardWith(page, "PW PC-1.4 fixture moment");

  // 推荐 (default) — the tab that used to hide the control.
  await expect(ownCard.getByRole("button", { name: "删除动态" })).toBeVisible({ timeout: 20_000 });
  await expect(othersCard.getByRole("button", { name: "删除动态" })).toHaveCount(0);

  // 我的 — where it used to be the only place it appeared.
  await page.getByRole("tab", { name: "我的" }).click();
  await expect(ownCard.getByRole("button", { name: "删除动态" })).toBeVisible({ timeout: 20_000 });

  /**
   * Bob's post is absent from 我的 because that tab filters to the viewer, which is
   * the filter's job — and it is the reason `tab === "mine"` looked like a
   * ownership test while actually being a filter test.
   */
  await expect(othersCard).toHaveCount(0);
});
