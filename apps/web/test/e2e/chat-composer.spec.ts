import { expect, test, type Page } from "@playwright/test";
import { CHAT_EMAILS, CHAT_MESSAGES, resolveChatFixture, type ChatFixture } from "../fixtures/chat";
import { loginAndLand } from "../fixtures/browser";

/**
 * PC-3.3 — chat composer layout.
 *
 * The composer used to render as `input | attach | GradientButton`, and the
 * shared `GradientButton` carries a `w-full` base class while `cn()` is a plain
 * join (it is not `tailwind-merge`). The call site's `w-20` therefore lost to
 * `w-full` in the stylesheet, so the send button took the whole row and crushed
 * the text field. Order and explicit sizing are the contract now.
 */

const PHONE_WIDTHS = [375, 390, 430] as const;

let fixture: ChatFixture;

test.beforeAll(async () => {
  fixture = await resolveChatFixture();
});

async function openChat(page: Page) {
  await loginAndLand(page, CHAT_EMAILS.alice);
  await page.goto(`/messages/${fixture.conversationId}`);
  await expect(page.getByTestId("chat-composer")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(CHAT_MESSAGES.aliceReply)).toBeVisible({ timeout: 20_000 });
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    return {
      document: root.scrollWidth - root.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
    };
  });
}

test("输入框比发送按钮宽得多，两个圆形按钮都是 44×44", async ({ page }) => {
  await openChat(page);

  const input = page.getByTestId("chat-input");
  const send = page.getByTestId("chat-send");
  const attach = page.getByTestId("chat-attach");

  const inputBox = (await input.boundingBox())!;
  const sendBox = (await send.boundingBox())!;
  const attachBox = (await attach.boundingBox())!;

  // The whole point of the fix: the field owns the row, the button does not.
  expect(inputBox.width).toBeGreaterThan(sendBox.width * 3);

  expect(Math.round(sendBox.width)).toBe(44);
  expect(Math.round(sendBox.height)).toBe(44);
  expect(Math.round(attachBox.width)).toBe(44);
  expect(Math.round(attachBox.height)).toBe(44);

  expect(Math.round(inputBox.height)).toBeGreaterThanOrEqual(44);

  // Attachment first, then the field, then send.
  expect(attachBox.x).toBeLessThan(inputBox.x);
  expect(inputBox.x).toBeLessThan(sendBox.x);
});

test("空消息不能发送，输入后可发送并清空", async ({ page }) => {
  await openChat(page);

  const input = page.getByTestId("chat-input");
  const send = page.getByTestId("chat-send");

  await expect(send).toBeDisabled();

  // Whitespace-only is still empty.
  await input.fill("   ");
  await expect(send).toBeDisabled();

  await input.fill("PW33 composer hello");
  await expect(send).toBeEnabled();
  await send.click();

  await expect(page.getByTestId("chat-input")).toHaveValue("");
  await expect(page.getByTestId("chat-send")).toBeDisabled();
});

test("长文本按行扩展但有上限，不会横向溢出", async ({ page }) => {
  await openChat(page);

  const input = page.getByTestId("chat-input");
  const oneLine = (await input.boundingBox())!.height;

  await input.fill("x".repeat(120));
  await page.waitForTimeout(200);
  const grown = (await input.boundingBox())!.height;
  expect(grown).toBeGreaterThan(oneLine);

  await input.fill("y".repeat(1500));
  await page.waitForTimeout(200);
  const capped = (await input.boundingBox())!.height;
  // Bounded growth: many lines of text must not push the thread off screen.
  expect(capped).toBeLessThanOrEqual(124);
  expect((await horizontalOverflow(page)).document).toBeLessThanOrEqual(0);

  const inside = await page.evaluate(() => {
    const element = document.querySelector<HTMLElement>("[data-testid=chat-input]");
    if (!element) return false;
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= window.innerWidth;
  });
  expect(inside).toBe(true);
});

for (const width of PHONE_WIDTHS) {
  test(`${width}px 宽度下没有横向滚动`, async ({ page }) => {
    await openChat(page);
    await page.setViewportSize({ width, height: 812 });
    await page.waitForTimeout(300);

    const overflow = await horizontalOverflow(page);
    expect(overflow.document).toBeLessThanOrEqual(0);
    expect(overflow.body).toBeLessThanOrEqual(0);

    // The composer must still fit the shell, not just the document.
    const composer = (await page.getByTestId("chat-composer").boundingBox())!;
    expect(composer.x).toBeGreaterThanOrEqual(0);
    expect(composer.x + composer.width).toBeLessThanOrEqual(width + 1);
  });
}

test("软键盘弹出时输入区被抬高，不会被遮住", async ({ page }) => {
  await openChat(page);

  const keyboardHeight = 320;
  const applied = await page.evaluate((height) => {
    const viewport = window.visualViewport;
    if (!viewport) return false;
    // Shadow the getter with a fixed height to emulate an on-screen keyboard,
    // then fire the event the composer listens for.
    Object.defineProperty(viewport, "height", {
      configurable: true,
      get: () => window.innerHeight - height,
    });
    viewport.dispatchEvent(new Event("resize"));
    return true;
  }, keyboardHeight);
  expect(applied).toBe(true);

  await page.waitForTimeout(300);

  const composer = (await page.getByTestId("chat-composer").boundingBox())!;
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  // The composer sits above the emulated keyboard rather than under it.
  expect(composer.y + composer.height).toBeLessThanOrEqual(
    viewportHeight - keyboardHeight + 1,
  );
});
