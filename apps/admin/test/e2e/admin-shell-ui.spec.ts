import { expect, test, type Page } from "@playwright/test";
import { ACCOUNTS } from "../fixtures/admin-roles";
import { loginAndLand, openNav } from "../fixtures/browser";

/**
 * The console chrome — sidebar, header, and the phone layout.
 *
 * The nine screens each have their own suite. What is asserted here is only what
 * belongs to the shell: that the sidebar is grouped and navigable, that the
 * group headings follow the permissions (a section with nothing visible in it
 * must not leave its heading behind), that the identity chip renders exactly
 * once, and that the whole thing works on a phone rather than being a squeezed
 * desktop table.
 *
 * Presentation only, as ever: the API's guards remain the security boundary.
 */

const SECTIONS = ["总览", "用户与关系", "内容治理", "风险与审计"];

const FULL_NAV = [
  "仪表盘",
  "用户",
  "连接",
  "交换",
  "屏蔽",
  "举报",
  "审核工作台",
  "风险中心",
  "审计日志",
];

/** The sidebar, located by the element the suites already rely on. */
function sidebar(page: Page) {
  return page.locator("aside");
}

async function sidebarX(page: Page) {
  const box = await sidebar(page).boundingBox();
  return box?.x ?? Number.NEGATIVE_INFINITY;
}

test.describe("shell — grouped sidebar on desktop", () => {
  test("the sidebar renders the four workflow sections, in order", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    for (const heading of SECTIONS) {
      await expect(
        sidebar(page).getByText(heading, { exact: true }),
        `section heading ${heading} is missing`,
      ).toBeVisible();
    }

    // Order is the workflow: what is happening, who the users are, what needs
    // adjudicating, what to verify afterwards.
    const rendered = await sidebar(page)
      .locator("nav > div > p")
      .allTextContents();
    expect(rendered.map((text) => text.trim())).toEqual(SECTIONS);
  });

  test("every nav entry routes to its own screen", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    const routes: Array<[string, RegExp]> = [
      ["用户", /\/users$/],
      ["连接", /\/connections$/],
      ["交换", /\/exchanges$/],
      ["屏蔽", /\/blocks$/],
      ["举报", /\/reports$/],
      ["审核工作台", /\/moderation$/],
      ["风险中心", /\/risk$/],
      ["审计日志", /\/audit$/],
      ["仪表盘", /\/dashboard$/],
    ];

    for (const [label, url] of routes) {
      await openNav(page, label);
      await expect(page).toHaveURL(url);
    }
  });

  test("the collapse toggle narrows the rail and keeps every link name", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    const toggle = page.getByTestId("nav-collapse-toggle");
    await expect(toggle).toBeVisible();

    const expanded = await sidebar(page).boundingBox();
    expect(expanded?.width ?? 0).toBeGreaterThan(200);

    await toggle.click();

    // Narrower rail…
    await expect
      .poll(async () => (await sidebar(page).boundingBox())?.width ?? 0)
      .toBeLessThan(100);
    // …with the section headings gone, because there is no room for them…
    await expect(sidebar(page).getByText("用户与关系", { exact: true })).toBeHidden();

    // …but the labels themselves must survive: they are `sr-only`, never
    // removed, so the accessible name of every link is still its label.
    const labels = await sidebar(page)
      .locator("nav a")
      .allTextContents();
    expect(labels.map((text) => text.trim())).toEqual(FULL_NAV);
    await expect(page.getByRole("link", { name: "风险中心", exact: true })).toHaveCount(1);

    // And it is a preference, not a one-way door.
    await toggle.click();
    await expect
      .poll(async () => (await sidebar(page).boundingBox())?.width ?? 0)
      .toBeGreaterThan(200);
  });
});

test.describe("shell — section headings follow the permissions", () => {
  const CASES: Array<{ role: string; email: string; expected: string[]; absent: string[] }> = [
    {
      role: "MODERATOR",
      email: ACCOUNTS.moderator.email,
      expected: ["仪表盘", "用户", "举报", "审核工作台", "风险中心", "审计日志"],
      absent: ["连接", "交换", "屏蔽"],
    },
    {
      role: "SUPPORT",
      email: ACCOUNTS.support.email,
      expected: ["仪表盘", "用户", "举报", "审核工作台", "审计日志"],
      absent: ["连接", "交换", "屏蔽", "风险中心"],
    },
    {
      role: "CONTENT_MANAGER",
      email: ACCOUNTS.contentManager.email,
      expected: ["仪表盘", "用户", "举报", "审核工作台", "审计日志"],
      absent: ["连接", "交换", "屏蔽", "风险中心"],
    },
  ];

  for (const testCase of CASES) {
    test(`${testCase.role}: the grouped sidebar is exactly what the role may read`, async ({
      page,
    }) => {
      await loginAndLand(page, testCase.email);

      const labels = (await sidebar(page).locator("nav a").allTextContents()).map((text) =>
        text.trim(),
      );
      expect(labels).toEqual(testCase.expected);
      for (const missing of testCase.absent) {
        expect(labels).not.toContain(missing);
      }

      // The invariant that makes a group heading trustworthy: a heading is only
      // rendered when at least one of its entries survived the permission
      // filter. An empty section header would advertise a screen the role
      // cannot open.
      const sections = sidebar(page).locator("nav > div");
      const count = await sections.count();
      expect(count).toBeGreaterThan(0);
      for (let index = 0; index < count; index += 1) {
        const section = sections.nth(index);
        await expect(section.locator("p").first()).not.toBeEmpty();
        expect(await section.locator("a").count()).toBeGreaterThan(0);
      }
    });
  }
});

test.describe("shell — the phone layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the sidebar is an off-canvas drawer that opens, navigates and closes", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    // Off-canvas, not merely transparent: the rail must be outside the viewport
    // so a phone never starts half-covered by navigation.
    expect(await sidebarX(page)).toBeLessThan(0);

    await page.getByRole("button", { name: "打开导航" }).click();
    await expect.poll(() => sidebarX(page)).toBeGreaterThanOrEqual(0);
    await expect(sidebar(page).getByText("用户与关系", { exact: true })).toBeVisible();

    // Choosing a destination closes the drawer rather than leaving it over the
    // screen the operator just asked for.
    await sidebar(page).getByRole("link", { name: "用户", exact: true }).click();
    await expect(page).toHaveURL(/\/users$/);
    await expect(page.getByRole("button", { name: "关闭导航" })).toHaveCount(0);
    await expect.poll(() => sidebarX(page)).toBeLessThan(0);
  });

  test("a wide data grid becomes a stacked list, never a sideways scroll", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    // One deterministic row, served at the API boundary. Asserting the phone
    // layout against whatever happens to be in the database would make this
    // test fail the day the fixtures are cleaned up, for a reason that has
    // nothing to do with the CSS.
    await page.route("**/admin/blocks**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            items: [
              {
                blockerId: "11111111-1111-4111-8111-111111111111",
                blockedId: "22222222-2222-4222-8222-222222222222",
                createdAt: "2026-03-01T10:00:00.000Z",
                blocker: { id: "11111111-1111-4111-8111-111111111111", nickname: "Alice" },
                blocked: { id: "22222222-2222-4222-8222-222222222222", nickname: "Bob" },
              },
            ],
            total: 1,
            page: 1,
            pageSize: 20,
            totalPages: 1,
          },
        }),
      });
    });

    await page.goto("/blocks");
    await expect(page.getByRole("heading", { name: "屏蔽" })).toBeVisible();
    await expect(page.locator("main table tbody tr")).toHaveCount(1);

    // The row is still a row — the DOM is untouched, so every row count in the
    // other suites keeps meaning what it meant — but the header row is gone and
    // each cell has become its own line.
    await expect(page.locator("main table thead")).toBeHidden();
    await expect(page.locator("main table td").first()).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);
  });

  test("the dashboard fits a phone without horizontal overflow", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(2);

    // The four headline figures stay legible as two columns rather than being
    // compressed into one very tall strip.
    const cards = page.locator("main div.rounded-2xl").filter({
      has: page.getByText("用户总数", { exact: true }),
    });
    const box = await cards.first().boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(140);
  });
});

test.describe("shell — one identity, one copy", () => {
  test("the signed-in role renders exactly once in the chrome", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    // A second copy (sidebar identity block plus header chip) would make every
    // `getByText(role)` assertion in the other suites ambiguous, so the count is
    // pinned here rather than left to chance.
    await expect(page.getByText("SUPER_ADMIN", { exact: true })).toHaveCount(1);
    await expect(page.getByText("超级管理员", { exact: true })).toHaveCount(1);
  });
});
