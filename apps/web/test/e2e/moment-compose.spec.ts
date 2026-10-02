import { expect, test, type Page } from "@playwright/test";
import { EMAILS } from "../fixtures/profile";
import { loginAndLand } from "../fixtures/browser";

/**
 * PC-3.6 — the 「发布动态」composer.
 *
 * This screen replaced a three-card form that asked members to paste image and
 * video URLs. The contract that matters now is behavioural: media is chosen off
 * the device, the publish button is the single strongest action, and nothing
 * the member typed is lost without a prompt. The fixtures are the shared
 * `pw.pc14.` accounts (verified, ACTIVE), and the run publishes real moments
 * that the global teardown removes again.
 *
 * The publish CTA is the shared `GradientButton`, so it is addressed by role and
 * accessible name — there is deliberately no test id on that component.
 */

const PHONE_WIDTHS = [375, 390, 430] as const;

/** A real 1×1 PNG: the upload endpoint sniffs magic bytes, so it must be one. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64",
);

/** A minimal ISO-BMFF clip: `ftyp` at offset 4 is what the sniffer looks for. */
const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("ftypisom", "latin1"),
  Buffer.from([0x00, 0x00, 0x02, 0x00]),
  Buffer.from("isomiso2", "latin1"),
]);

function imageFile(name: string) {
  return { name, mimeType: "image/png", buffer: PNG };
}

const publishButton = (page: Page) => page.getByRole("button", { name: /^发布$/ });
const publishingButton = (page: Page) => page.getByRole("button", { name: /^发布中…$/ });

async function openComposer(page: Page) {
  await loginAndLand(page, EMAILS.alice);
  await page.goto("/moments/compose");
  await expect(page.getByRole("heading", { name: "发布动态" })).toBeVisible({ timeout: 20_000 });
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

/** Waits out the per-item upload overlay, leaving the tile in its settled state. */
async function settleUploads(page: Page) {
  await expect(page.getByTestId("moment-media-uploading")).toHaveCount(0, { timeout: 20_000 });
}

test("打开发布页：输入框、添加入口与发布按钮都可见，空内容不可发布", async ({ page }) => {
  await openComposer(page);

  await expect(page.getByTestId("moment-content")).toBeVisible();
  await expect(page.getByTestId("moment-add-media")).toBeVisible();
  await expect(page.getByTestId("moment-counter")).toHaveText("0/2000");
  await expect(publishButton(page)).toBeVisible();
  await expect(publishButton(page)).toBeDisabled();
});

test("输入文字后字数统计随输入更新", async ({ page }) => {
  await openComposer(page);

  await page.getByTestId("moment-content").fill("你好");
  await expect(page.getByTestId("moment-counter")).toHaveText("2/2000");

  await page.getByTestId("moment-content").fill("TalkFirst 你好");
  await expect(page.getByTestId("moment-counter")).toHaveText("12/2000");

  await expect(publishButton(page)).toBeEnabled();
});

test("只有空白字符仍视为空内容，不能发布", async ({ page }) => {
  await openComposer(page);

  await page.getByTestId("moment-content").fill("    \n  ");
  await expect(publishButton(page)).toBeDisabled();
});

test("选择图片后出现本地预览，可以删除", async ({ page }) => {
  await openComposer(page);

  await page.getByTestId("moment-image-input").setInputFiles(imageFile("pc36-a.png"));
  const tile = page.getByTestId("moment-media").first();
  await expect(tile).toBeVisible();

  // The preview is a blob URL minted from the local file — never a remote URL.
  const src = await tile.locator("img").getAttribute("src");
  expect(src ?? "").toMatch(/^blob:/);

  await settleUploads(page);
  await expect(tile.locator("[data-testid='moment-media-error']")).toHaveCount(0);

  await tile.getByRole("button", { name: "删除媒体" }).click();
  await expect(page.getByTestId("moment-media")).toHaveCount(0);
  await expect(publishButton(page)).toBeDisabled();
});

test("多张图片组成网格，可以调整顺序", async ({ page }) => {
  await openComposer(page);

  await page
    .getByTestId("moment-image-input")
    .setInputFiles([imageFile("pc36-1.png"), imageFile("pc36-2.png"), imageFile("pc36-3.png")]);

  await expect(page.getByTestId("moment-media")).toHaveCount(3);
  await settleUploads(page);

  const first = page.getByTestId("moment-media").first();
  const firstSrc = await first.locator("img").getAttribute("src");

  // The first tile cannot move left; the second can.
  await expect(first.getByRole("button", { name: "前移" })).toHaveCount(0);
  await first.getByRole("button", { name: "后移" }).click();

  const newFirstSrc = await page.getByTestId("moment-media").first().locator("img").getAttribute("src");
  expect(newFirstSrc).not.toBe(firstSrc);
});

test("视频作为单个大预览出现，且显示播放标识", async ({ page }) => {
  await openComposer(page);

  await page.getByTestId("moment-video-input").setInputFiles({ name: "pc36.mp4", mimeType: "video/mp4", buffer: MP4 });

  const video = page.getByTestId("moment-media-video");
  await expect(video).toBeVisible();
  await expect(video.locator("video")).toBeVisible();
  await settleUploads(page);

  await video.getByRole("button", { name: "删除媒体" }).click();
  await expect(page.getByTestId("moment-media-video")).toHaveCount(0);
});

test("可以添加话题，并以胶囊形式展示", async ({ page }) => {
  await openComposer(page);

  await page.getByTestId("moment-topic-toggle").click();
  await expect(page.getByTestId("moment-topic-panel")).toBeVisible();

  await page.getByTestId("moment-topic-option").first().click();
  await expect(page.getByTestId("moment-tag")).toHaveCount(1);

  // The chip removes its own tag.
  await page.getByTestId("moment-tag").getByRole("button").click();
  await expect(page.getByTestId("moment-tag")).toHaveCount(0);
});

test("可以自定义话题并添加位置", async ({ page }) => {
  await openComposer(page);

  // A topic that is deliberately not in the hot list, so the "create" path runs.
  await page.getByTestId("moment-topic-toggle").click();
  await page.getByTestId("moment-topic-input").fill("猫咪");
  await page.getByTestId("moment-topic-create").click();
  await expect(page.getByTestId("moment-tag")).toHaveText(/#猫咪/);

  await page.getByTestId("moment-location-toggle").click();
  await page.getByTestId("moment-location-input").fill("东京");
  await expect(page.getByTestId("moment-location-input")).toHaveValue("东京");
});

test("可见范围可以切换，并回写到服务器设置", async ({ page }) => {
  await openComposer(page);

  const chip = page.getByTestId("moment-visibility");
  await expect(chip).toBeVisible();

  // The setting is stored on the account and survives the whole run, so the
  // test picks a target that differs from whatever is currently selected
  // instead of assuming the default.
  const before = (await chip.textContent())?.trim() ?? "";
  const target = before.includes("仅好友") ? "private" : "connections";
  const targetLabel = target === "private" ? "仅自己" : "仅好友";

  await chip.click();
  const option = page.getByTestId(`moment-visibility-${target}`);
  await expect(option).toBeVisible();
  await option.click();

  await expect(chip).toHaveText(new RegExp(targetLabel));
  await expect(page.getByTestId(`moment-visibility-${target}`)).toHaveCount(0);

  // The choice is persisted, so a reload reads it back.
  await page.reload();
  await expect(page.getByTestId("moment-visibility")).toHaveText(new RegExp(targetLabel), { timeout: 20_000 });
});

test("正常发布后跳到动态列表，内容可见", async ({ page }) => {
  await openComposer(page);

  const text = `PC36 发布 ${Date.now()}`;
  await page.getByTestId("moment-content").fill(text);
  await expect(publishButton(page)).toBeEnabled();
  await publishButton(page).click();

  await page.waitForURL("**/moments", { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "动态" })).toBeVisible();

  // The feed opens on 推荐; the member's own post is guaranteed on 我的.
  await page.getByRole("button", { name: "我的", exact: true }).click();
  await expect(page.getByText(text)).toBeVisible({ timeout: 20_000 });
});

test("只有图片、没有文字也可以发布", async ({ page }) => {
  await openComposer(page);

  await page.getByTestId("moment-image-input").setInputFiles(imageFile("pc36-only.png"));
  await settleUploads(page);
  await expect(publishButton(page)).toBeEnabled();

  await publishButton(page).click();
  await page.waitForURL("**/moments", { timeout: 20_000 });
});

test("发布中显示进行态并防止重复提交", async ({ page }) => {
  await openComposer(page);

  let calls = 0;
  await page.route("**/api/v1/moments", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls += 1;
    // Hold the response long enough to observe the in-flight state.
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { id: "pc36" } }),
    });
  });

  await page.getByTestId("moment-content").fill("PC36 防重复提交");
  const button = publishButton(page);
  await expect(button).toBeEnabled();
  await button.click();

  // The CTA becomes the disabled "发布中…" state, so the idle button disappears.
  await expect(publishingButton(page)).toBeDisabled();
  await expect(publishButton(page)).toHaveCount(0);

  await publishingButton(page).click({ force: true }).catch(() => undefined);
  expect(calls).toBe(1);
});

test("发布失败时保留内容并给出错误提示", async ({ page }) => {
  await openComposer(page);

  await page.route("**/api/v1/moments", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        error: { code: "INTERNAL_ERROR", message: "服务器内部错误" },
      }),
    });
  });

  await page.getByTestId("moment-content").fill("PC36 发布失败用例");
  await publishButton(page).click();

  await expect(page.getByTestId("moment-error")).toBeVisible({ timeout: 20_000 });
  // The member stays on the composer with what they wrote intact.
  await expect(page.getByTestId("moment-content")).toHaveValue("PC36 发布失败用例");
  await expect(publishButton(page)).toBeEnabled();
});

test("返回时如有未保存内容会先确认", async ({ page }) => {
  await openComposer(page);

  await page.getByTestId("moment-content").fill("PC36 未保存内容");
  await page.getByRole("button", { name: "返回" }).click();

  const dialog = page.getByTestId("moment-leave-dialog");
  await expect(dialog).toBeVisible();

  // "继续编辑" keeps the member on the composer.
  await page.getByTestId("moment-leave-cancel").click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/moments\/compose$/);
  await expect(page.getByTestId("moment-content")).toHaveValue("PC36 未保存内容");

  // "放弃" leaves.
  await page.getByRole("button", { name: "返回" }).click();
  await page.getByTestId("moment-leave-confirm").click();
  await page.waitForURL("**/moments", { timeout: 20_000 });
});

for (const width of PHONE_WIDTHS) {
  test(`${width}px 宽度下没有横向滚动，发布按钮不被遮挡`, async ({ page }) => {
    await openComposer(page);
    await page.setViewportSize({ width, height: 812 });
    await page.waitForTimeout(200);

    const overflow = await horizontalOverflow(page);
    expect(overflow.document).toBeLessThanOrEqual(0);
    expect(overflow.body).toBeLessThanOrEqual(0);

    const button = await publishButton(page).boundingBox();
    expect(button).not.toBeNull();
    expect(button!.x).toBeGreaterThanOrEqual(0);
    expect(button!.x + button!.width).toBeLessThanOrEqual(width + 1);

    // With media and text in play the layout must still hold.
    await page.getByTestId("moment-content").fill("PC36 适配检查");
    await page.getByTestId("moment-image-input").setInputFiles(imageFile("pc36-w.png"));
    await settleUploads(page);
    const overflowWithMedia = await horizontalOverflow(page);
    expect(overflowWithMedia.document).toBeLessThanOrEqual(0);
  });
}

test("视口变矮（软键盘）时输入区与发布按钮仍可见", async ({ page }) => {
  await openComposer(page);

  await page.getByTestId("moment-content").fill("PC36 键盘布局");
  await page.getByTestId("moment-content").click();

  // Emulate the on-screen keyboard taking half the screen.
  await page.setViewportSize({ width: 390, height: 480 });
  await page.waitForTimeout(200);

  const content = page.getByTestId("moment-content");
  await expect(content).toBeVisible();

  const button = publishButton(page);
  await expect(button).toBeVisible();
  const buttonBox = (await button.boundingBox())!;
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(viewportHeight + 1);

  expect((await horizontalOverflow(page)).document).toBeLessThanOrEqual(0);
});
