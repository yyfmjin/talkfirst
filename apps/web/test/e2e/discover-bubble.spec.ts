import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { loginAndLand, profileCard } from "../fixtures/browser";
import { ALICE_NICKNAME, BOB_NICKNAME, EMAILS, seed } from "../fixtures/profile";

/**
 * Discover is the "who is here" screen and nothing more.
 *
 * The homepage used to render the whole profile card — bio, interests,
 * languages, match score — and then the same fields again in the card that
 * opened on tap, so nothing on screen said where one ended and the other began.
 * These tests pin the new split: the wall shows identity only, the shared card
 * keeps everything else, and the wall's pointer targets do not move even though
 * the avatars inside them float.
 *
 * Everything runs against the real API and the real database. Only the *timing*
 * of one response is delayed, so the loading state can be observed without
 * inventing a payload.
 */

const prisma = new PrismaClient();

/** Bob's bio is PUBLIC, so it really does reach the browser for Carol. */
const BOB_PUBLIC_BIO = "PW Bob bio";

type PayloadItem = Record<string, unknown>;

test.beforeEach(async () => {
  await seed(prisma);
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

function bubble(page: Page, nickname: string) {
  return page.getByRole("button", { name: `查看 ${nickname} 的资料卡`, exact: true });
}

/** The candidates the browser actually received, not a stub. */
async function recommendationsOf(page: Page) {
  const response = await page.waitForResponse(
    (candidate) => candidate.url().includes("/discover/recommendations") && candidate.status() === 200,
  );
  const payload = (await response.json()) as { data: { items: PayloadItem[] } };
  return payload.data.items;
}

test("首页是头像气泡墙，不再出现完整用户资料卡", async ({ page }) => {
  const received = recommendationsOf(page);
  await loginAndLand(page, EMAILS.carol);
  const items = await received;

  // The payload still carries the whole card for the people Carol may see…
  expect(items.some((item) => item.bio === BOB_PUBLIC_BIO)).toBe(true);

  const wall = page.getByTestId("discover-bubble-field");
  await expect(wall).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("discover-bubble").first()).toBeVisible();

  // …but the wall renders identity only. A PUBLIC bio is allowed to be shown,
  // so its absence here is the layout decision and not a visibility rule.
  await expect(page.getByText(BOB_PUBLIC_BIO)).toHaveCount(0);
  await expect(page.getByText("母语")).toHaveCount(0);
  await expect(page.getByText("学习中")).toHaveCount(0);
  await expect(page.getByText(/% match/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "跳过此推荐" })).toHaveCount(0);
  // The card is not on screen until an avatar is tapped.
  await expect(profileCard(page)).toHaveCount(0);
});

test("气泡显示昵称、年龄和国家/地区", async ({ page }) => {
  const received = recommendationsOf(page);
  await loginAndLand(page, EMAILS.carol);
  const items = await received;

  const alice = items.find((item) => item.nickname === ALICE_NICKNAME);
  expect(alice, "Alice must be a candidate for Carol").toBeTruthy();

  const aliceBubble = bubble(page, ALICE_NICKNAME);
  await expect(aliceBubble).toBeVisible({ timeout: 20_000 });
  const text = await aliceBubble.locator("xpath=..").innerText();
  expect(text).toContain(ALICE_NICKNAME);
  expect(text).toContain(`${String(alice?.age)} 岁`);
  expect(text).toContain(String(alice?.countryName ?? alice?.countryCode));
});

test("点击气泡打开现有个人名片，Say Hello 仍在名片里", async ({ page }) => {
  await loginAndLand(page, EMAILS.carol);
  await page.goto("/discover");

  const field = page.getByTestId("discover-bubble-field");
  await expect(field).toBeVisible({ timeout: 20_000 });
  // The wall itself never carries Say Hello: the greeting belongs to the card.
  await expect(field.getByRole("button", { name: "Say Hello", exact: true })).toHaveCount(0);

  const aliceBubble = bubble(page, ALICE_NICKNAME);
  await expect(aliceBubble).toBeVisible({ timeout: 20_000 });
  await aliceBubble.click();

  const card = profileCard(page);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText(ALICE_NICKNAME);
  await expect(card.getByRole("button", { name: "Say Hello" })).toBeVisible();
  await expect(card.getByRole("button", { name: "查看完整资料" })).toBeVisible();
});

test("气泡会漂浮，但点击区域本身不动", async ({ page }) => {
  // The float is opt-in: it only exists for users who did not ask for less motion.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await loginAndLand(page, EMAILS.carol);

  const aliceBubble = bubble(page, ALICE_NICKNAME);
  await expect(aliceBubble).toBeVisible({ timeout: 20_000 });

  const orb = aliceBubble.getByTestId("discover-bubble-orb");
  await expect(orb).toBeVisible();

  // Park the pointer off the wall first: resting on a bubble deliberately
  // freezes its float, and the login click leaves the cursor where it landed.
  await page.mouse.move(0, 0);
  expect(await orb.evaluate((node) => getComputedStyle(node).animationName)).toBe("tf-bubble-float");

  // The visual drifts over roughly three seconds — one whole cycle of the
  // slowest bubble — so the assertion cannot land on a still frame.
  const drift = await orb.evaluate(async (node) => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let frame = 0; frame < 180; frame += 1) {
      const top = node.getBoundingClientRect().top;
      min = Math.min(min, top);
      max = Math.max(max, top);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    }
    return max - min;
  });
  expect(drift).toBeGreaterThan(1);

  // The hit box, by contrast, is pixel-identical on every frame: a moving
  // target would slide out from under a finger and stall an automated click.
  const first = await aliceBubble.boundingBox();
  await page.waitForTimeout(700);
  const second = await aliceBubble.boundingBox();
  expect(second).toEqual(first);

  // And the click still lands.
  await aliceBubble.click();
  await expect(profileCard(page)).toBeVisible({ timeout: 20_000 });
});

test("指针停在气泡上时漂浮暂停，移开后恢复", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await loginAndLand(page, EMAILS.carol);

  const aliceBubble = bubble(page, ALICE_NICKNAME);
  await expect(aliceBubble).toBeVisible({ timeout: 20_000 });
  const orb = aliceBubble.getByTestId("discover-bubble-orb");

  await aliceBubble.hover();
  await expect.poll(async () => orb.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");

  await page.mouse.move(0, 0);
  await expect
    .poll(async () => orb.evaluate((node) => getComputedStyle(node).animationName))
    .toBe("tf-bubble-float");
});

test("用户要求减少动效时气泡静止，点击依然有效", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loginAndLand(page, EMAILS.carol);

  const aliceBubble = bubble(page, ALICE_NICKNAME);
  await expect(aliceBubble).toBeVisible({ timeout: 20_000 });
  const orb = aliceBubble.getByTestId("discover-bubble-orb");
  expect(await orb.evaluate((node) => getComputedStyle(node).animationName)).toBe("none");

  await aliceBubble.click();
  await expect(profileCard(page)).toBeVisible({ timeout: 20_000 });
});

test("375 / 390 / 430 / 桌面端都没有横向滚动", async ({ page }) => {
  await loginAndLand(page, EMAILS.carol);

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/discover");
    await expect(page.getByTestId("discover-bubble-field")).toBeVisible({ timeout: 20_000 });

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      const field = document.querySelector('[data-testid="discover-bubble-field"]');
      return {
        document: doc.scrollWidth - doc.clientWidth,
        body: document.body.scrollWidth - document.body.clientWidth,
        field: field ? field.scrollWidth - field.clientWidth : 0,
      };
    });

    expect(overflow, `viewport ${viewport.width}`).toEqual({ document: 0, body: 0, field: 0 });
  }
});

test("加载中是头像气泡骨架，不是用户卡片骨架", async ({ page }) => {
  await page.route("**/discover/recommendations**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.continue();
  });

  await loginAndLand(page, EMAILS.carol);

  const skeleton = page.getByTestId("discover-bubble-skeleton");
  await expect(skeleton).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("discover-bubble-field")).toHaveCount(0);

  await expect(page.getByTestId("discover-bubble-field")).toBeVisible({ timeout: 20_000 });
  await expect(skeleton).toHaveCount(0);
});

test("推荐接口失败时保留原有错误提示与重试", async ({ page }) => {
  await page.route("**/discover/recommendations**", (route) => route.abort("failed"));
  await loginAndLand(page, EMAILS.carol);

  await expect(page.getByText("推荐暂时不可用")).toBeVisible({ timeout: 20_000 });
  const retry = page.getByRole("button", { name: "重试" });
  await expect(retry).toBeVisible();

  // The retry goes back to the real endpoint.
  await page.unroute("**/discover/recommendations**");
  await retry.click();
  await expect(page.getByTestId("discover-bubble-field")).toBeVisible({ timeout: 20_000 });
});

test("被 Block 的用户不会出现在气泡墙上", async ({ page }) => {
  const users = await prisma.user.findMany({
    where: { email: { in: [EMAILS.carol, EMAILS.bob] } },
    select: { id: true, email: true },
  });
  const carolId = users.find((user) => user.email === EMAILS.carol)?.id;
  const bobId = users.find((user) => user.email === EMAILS.bob)?.id;
  if (!carolId || !bobId) throw new Error("fixture accounts missing");

  await loginAndLand(page, EMAILS.carol);
  await expect(page.getByTestId("discover-bubble-field")).toBeVisible({ timeout: 20_000 });
  // Bob is an ordinary candidate for Carol…
  await expect(bubble(page, BOB_NICKNAME)).toBeVisible();

  await prisma.block.create({ data: { blockerId: carolId, blockedId: bobId } });
  await page.reload();

  // …and the block removes him from the wall, while everyone else stays.
  await expect(page.getByTestId("discover-bubble-field")).toBeVisible({ timeout: 20_000 });
  await expect(bubble(page, BOB_NICKNAME)).toHaveCount(0);
  await expect(bubble(page, ALICE_NICKNAME)).toBeVisible();
});
