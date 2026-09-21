import { expect, test, type Page } from "@playwright/test";
import { loginAndLand } from "../fixtures/browser";
import { EMAILS } from "../fixtures/profile";

/**
 * PC-3.2R — the phone shell's simulated status bar.
 *
 * The shell frames the web app at phone dimensions during review, and its top
 * bar used to be frozen at the design file's "9:41". These tests pin the
 * restored behaviour: the clock reports the viewer's own local time in HH:mm
 * and keeps ticking, while the glyphs beside it stay decoration.
 *
 * They run against the real built app and the real API — the point is that the
 * clock comes from the browser, so a mocked payload would prove nothing.
 */

function statusBar(page: Page) {
  return page.getByTestId("phone-status-bar");
}

function statusTime(page: Page) {
  return page.getByTestId("phone-status-bar-time");
}

/** Two-digit hour + two-digit minute, and nothing else. */
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Minutes between the displayed clock and the browser's own local time, read
 * inside the page so the assertion never assumes the runner's timezone. The
 * window is one minute wide because the displayed value legitimately lags by up
 * to a tick.
 */
async function minutesBehind(page: Page, shown: string) {
  return page.evaluate((value) => {
    const parts = value.split(":");
    const shownTotal = Number(parts[0] ?? 0) * 60 + Number(parts[1] ?? 0);
    const now = new Date();
    let delta = now.getHours() * 60 + now.getMinutes() - shownTotal;
    if (delta > 720) delta -= 1440;
    if (delta < -720) delta += 1440;
    return delta;
  }, shown);
}

/** Reads the clock once it has been filled in after hydration. */
async function readTime(page: Page) {
  await expect(statusTime(page)).toHaveText(HH_MM, { timeout: 20_000 });
  return statusTime(page).innerText();
}

test("状态栏显示浏览器本地时间，而不是写死的 9:41", async ({ page }) => {
  await loginAndLand(page, EMAILS.carol);
  await expect(statusBar(page)).toBeVisible();

  const shown = await readTime(page);

  // The format always zero-pads, so the design file's "9:41" can never appear.
  expect(shown).not.toBe("9:41");
  // Nothing on the page renders it either. The match is exact on purpose: a
  // genuine 19:41 contains "9:41" as a substring and must not fail this test.
  await expect(page.getByText("9:41", { exact: true })).toHaveCount(0);

  // …and what is shown really is this browser's own wall clock.
  const behind = await minutesBehind(page, shown);
  expect(behind, `状态栏 ${shown} 应等于浏览器本地时间`).toBeGreaterThanOrEqual(0);
  expect(behind).toBeLessThanOrEqual(1);
});

test("时间格式始终是两位小时和两位分钟", async ({ page }) => {
  // Twice over, on an unauthenticated screen and a logged-in one, because the
  // shell wraps both.
  await page.goto("/login");
  await expect(statusBar(page)).toBeVisible();
  expect(await readTime(page)).toMatch(HH_MM);

  await loginAndLand(page, EMAILS.carol);
  const shown = await readTime(page);
  expect(shown).toMatch(HH_MM);
  expect(shown).toHaveLength(5);
});

test("任何页面都只渲染一个状态栏，右侧图标仍在", async ({ page }) => {
  await page.goto("/login");
  await expect(statusBar(page)).toHaveCount(1);
  expect(await readTime(page)).toMatch(HH_MM);

  await loginAndLand(page, EMAILS.carol);

  for (const route of ["/discover", "/moments", "/me"]) {
    await page.goto(route);
    await expect(statusBar(page), route).toHaveCount(1);
    await expect(statusTime(page)).toHaveText(HH_MM, { timeout: 20_000 });
    // The signal / network / battery glyphs are decorative and stay put; they
    // never read real device state.
    await expect(statusBar(page)).toContainText("●●●");
  }
});

test("离开页面后状态栏的计时器被清理", async ({ page }) => {
  // Count the page's own timers so the cleanup can be observed from the outside.
  await page.addInitScript(() => {
    const record = { created: [] as { id: number; delay: number }[], cleared: [] as number[] };
    const nativeSet = window.setInterval.bind(window);
    const nativeClear = window.clearInterval.bind(window);
    (window as unknown as { __pwTimers: typeof record }).__pwTimers = record;
    window.setInterval = ((handler: TimerHandler, delay?: number, ...rest: unknown[]) => {
      const id = nativeSet(handler as never, delay, ...(rest as never[]));
      record.created.push({ id: Number(id), delay: Number(delay ?? 0) });
      return id;
    }) as typeof window.setInterval;
    window.clearInterval = ((id?: number) => {
      record.cleared.push(Number(id));
      return nativeClear(id);
    }) as typeof window.clearInterval;
  });

  await loginAndLand(page, EMAILS.carol);
  await expect(statusBar(page)).toBeVisible();

  const clockTimers = await page.evaluate(() =>
    (window as unknown as { __pwTimers: { created: { id: number; delay: number }[] } }).__pwTimers.created
      .filter((entry) => entry.delay === 60_000)
      .map((entry) => entry.id),
  );
  expect(clockTimers.length, "状态栏应注册每分钟一次的计时器").toBeGreaterThan(0);

  // A client-side navigation replaces the page tree, so the shell unmounts.
  await page.getByRole("link", { name: "我的", exact: true }).click();
  await expect(page).toHaveURL(/\/me$/);
  await expect(statusTime(page)).toHaveText(HH_MM, { timeout: 20_000 });

  const cleared = await page.evaluate(
    () => (window as unknown as { __pwTimers: { cleared: number[] } }).__pwTimers.cleared,
  );
  expect(
    clockTimers.some((id) => cleared.includes(id)),
    "卸载时应清理状态栏计时器",
  ).toBe(true);
});

test("跨过一分钟边界后时间自动更新", async ({ page }) => {
  // Log in on real time first: a paused clock would stall the auth flow. The
  // fake clock is installed for the *next* document, where the shell registers
  // its interval against it, and then advanced by exactly one minute.
  await loginAndLand(page, EMAILS.carol);
  await page.clock.install({ time: new Date() });
  await page.goto("/discover");
  await expect(statusBar(page)).toBeVisible();

  const before = await readTime(page);
  await page.clock.fastForward("01:00");

  await expect(statusTime(page)).not.toHaveText(before, { timeout: 20_000 });
  expect(await statusTime(page).innerText()).toMatch(HH_MM);
});
