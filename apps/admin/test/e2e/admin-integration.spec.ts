import { expect, test } from "@playwright/test";
import { ACCOUNTS } from "../fixtures/admin-roles";
import { loginAndLand, openNav, submitLogin } from "../fixtures/browser";

/**
 * Phase C5 — Integration, in a real browser.
 *
 * This suite deliberately does **not** re-test the nine screens. Each domain
 * already has its own browser spec that drives its own UI. What is asserted here
 * is only what no single-screen spec can see:
 *
 *   1. **The sidebar agrees with the server, for every role.** The expected
 *      lists below are written out by hand from the permission matrix, and the
 *      console renders its nav from the permissions `/admin/me` returns. So this
 *      is a genuine two-sided check: a nav entry that outlives its permission
 *      fails here, and so does one that disappears while the permission remains.
 *
 *   2. **A hidden link is not the boundary.** Typing a URL directly must be
 *      refused by the API and must show the operator a message — not a blank
 *      page, not a spinner that never resolves, and never a stack trace.
 *
 *   3. **Two screens that show the same number agree.** 「待处理举报」 appears on
 *      both the dashboard and the risk centre; 「用户总数」 on the dashboard and
 *      as the users list total. Both pairs are read from the rendered page, so
 *      the assertion holds whatever the fixtures happen to be.
 *
 *   4. **No screen leaks internals.** Every refusal state is scanned for
 *      Prisma/SQL/stack/connection-string text.
 *
 * Presentation only, as ever: the API's guards remain the security boundary.
 */

/**
 * The nine routes the console ships, in the order the sidebar renders them.
 *
 * Read from `shell.tsx`'s `NAV` table, which is the single place a screen is
 * declared. A new screen must be added here too — that is what makes the
 * per-role equality assertions able to catch an unauthorised route.
 */
const CANONICAL_NAV: Array<{ href: string; label: string; permission: string }> = [
  { href: "/dashboard", label: "仪表盘", permission: "dashboard:read" },
  { href: "/users", label: "用户", permission: "users:read" },
  { href: "/reports", label: "举报", permission: "reports:read" },
  { href: "/moderation", label: "审核工作台", permission: "reports:read" },
  { href: "/risk", label: "风险中心", permission: "risk:read" },
  { href: "/connections", label: "连接", permission: "connections:read" },
  { href: "/exchanges", label: "交换", permission: "exchanges:read" },
  { href: "/blocks", label: "屏蔽", permission: "blocks:read" },
  { href: "/audit", label: "审计日志", permission: "audit:read" },
];

/**
 * The read permissions each role holds, transcribed from the real matrix.
 *
 * Unique permissions, not nav entries: `reports:read` gates two screens (the
 * reports queue and the moderation workbench), and both must appear for a role
 * that holds it. Filtering the nav table by membership gives that for free.
 */
const ROLE_READS: Record<string, string[]> = {
  SUPER_ADMIN: [
    "dashboard:read",
    "users:read",
    "reports:read",
    "risk:read",
    "connections:read",
    "exchanges:read",
    "blocks:read",
    "audit:read",
  ],
  MODERATOR: ["dashboard:read", "users:read", "reports:read", "risk:read", "audit:read"],
  SUPPORT: ["dashboard:read", "users:read", "reports:read", "audit:read"],
  ANALYST: [
    "dashboard:read",
    "users:read",
    "reports:read",
    "risk:read",
    "connections:read",
    "exchanges:read",
    "blocks:read",
    "audit:read",
  ],
  CONTENT_MANAGER: ["dashboard:read", "users:read", "reports:read", "audit:read"],
};

/** The labels a role must see — derived from `ROLE_READS`, not copied by hand. */
function expectedNav(role: keyof typeof ROLE_READS): string[] {
  return CANONICAL_NAV.filter((entry) => ROLE_READS[role]?.includes(entry.permission)).map(
    (entry) => entry.label,
  );
}

/** Role → the fixture account that signs in as it. */
const EMAIL_FOR: Record<string, string> = {
  SUPER_ADMIN: ACCOUNTS.superadmin.email,
  MODERATOR: ACCOUNTS.moderator.email,
  SUPPORT: ACCOUNTS.support.email,
  ANALYST: ACCOUNTS.analyst.email,
  CONTENT_MANAGER: ACCOUNTS.contentManager.email,
};

/** Every role in the matrix. */
const ALL_ROLES = Object.keys(ROLE_READS);

/** Roles that do **not** hold `permission` — derived, never hand-listed. */
function nonHoldersOf(permission: string): string[] {
  return ALL_ROLES.filter((role) => !ROLE_READS[role]?.includes(permission));
}

/** Text that must never reach an operator, whatever went wrong. */
const LEAK_MARKERS =
  /prisma|stack|\bat \w+ \(|ECONNREFUSED|ETIMEDOUT|\bSQL\b|postgres(ql)?:\/\/|DATABASE_URL|passwordHash|tokenHash|clientSecret/i;

/**
 * The reason a refusal panel states, as an alternation rather than a sentence.
 *
 * The nine screens do **not** share one copy. The C4 screens run the API error
 * through a local `friendlyError` and render 「无权限访问」; the C1 and C2
 * screens render the API's `error.message` verbatim, which for a 403 is
 * `Your role (SUPPORT) is not allowed to perform this action`. That divergence
 * predates this phase and is recorded as a finding rather than silently fixed
 * here — a copy change is a product decision, and this suite is not the place
 * to make one.
 *
 * What *is* a contract, and what this regex pins, is that the panel gives a
 * reason at all: an empty panel, or one that reports success, must fail.
 */
const REFUSAL_REASON = /not allowed|PERMISSION_DENIED|无权限/;

/** The error container each of the four C-era screens renders on a refusal. */
const ERROR_TESTID: Record<string, string> = {
  "/risk": "risk-error",
  "/connections": "connections-error",
  "/exchanges": "exchanges-error",
  "/blocks": "blocks-error",
};

/** The testid each of those screens renders when it has data. */
const DATA_TESTID: Record<string, string> = {
  "/connections": "connections-empty",
  "/exchanges": "exchanges-empty",
  "/blocks": "blocks-empty",
};

test.describe("C5 — nav ↔ permission, for every role", () => {
  // ------------------------------------------------------------------ 1
  for (const role of ALL_ROLES) {
    test(`the ${role} sidebar is exactly what the server permits`, async ({ page }) => {
      await loginAndLand(page, EMAIL_FOR[role] as string);

      const rendered = (await page.locator("aside nav a").allTextContents()).map((s) => s.trim());
      expect(rendered).toEqual(expectedNav(role));

      // The canonical order is a subsequence of every role's list: a screen may
      // be missing, but the surviving ones never swap places. A reordering would
      // otherwise pass the equality above for SUPER_ADMIN only.
      const canonicalLabels = CANONICAL_NAV.map((entry) => entry.label);
      let cursor = 0;
      for (const label of rendered) {
        const at = canonicalLabels.indexOf(label, cursor);
        expect({ role, label, foundAt: at >= cursor }).toEqual({ role, label, foundAt: true });
        cursor = at + 1;
      }
    });
  }

  // ------------------------------------------------------------------ 1b
  test("the role list under test is the whole matrix", () => {
    // A derived loop is only as good as its input: if a role were dropped from
    // `ROLE_READS`, every per-role test above would silently disappear.
    //
    // Spread before sorting: `ALL_ROLES.sort()` would sort the shared array in
    // place, and `nonHoldersOf()` below returns roles in `ALL_ROLES` order — so
    // mutating it here would reorder the expected arrays further down and make
    // an order-sensitive assertion fail for a reason that has nothing to do
    // with permissions.
    expect([...ALL_ROLES].sort()).toEqual([
      "ANALYST",
      "CONTENT_MANAGER",
      "MODERATOR",
      "SUPER_ADMIN",
      "SUPPORT",
    ]);
  });

  // ------------------------------------------------------------------ 2
  test("ANALYST sees the whole menu — read-only-everything, not a reduced view", async ({ page }) => {
    // Worth its own assertion: ANALYST and SUPER_ADMIN render identical
    // sidebars. That is correct (every nav entry is gated on a read permission
    // and ANALYST holds all of them) but it looks like a bug unless stated.
    await loginAndLand(page, ACCOUNTS.analyst.email);
    const rendered = (await page.locator("aside nav a").allTextContents()).map((s) => s.trim());
    expect(rendered).toEqual(CANONICAL_NAV.map((entry) => entry.label));
  });

  // ------------------------------------------------------------------ 3
  test("a MODERATOR gains no relationship screen from moderation or risk access", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.moderator.email);
    const rendered = await page.locator("aside nav a").allTextContents();

    // Holds risk:read, so the risk centre is present…
    expect(rendered.map((s) => s.trim())).toContain("风险中心");
    // …and holds none of the three relationship reads.
    for (const label of ["连接", "交换", "屏蔽"]) {
      expect({ label, present: rendered.map((s) => s.trim()).includes(label) }).toEqual({
        label,
        present: false,
      });
    }
  });
});

test.describe("C5 — a direct URL is refused by the API, not by the nav", () => {
  // ------------------------------------------------------------------ 4
  for (const role of nonHoldersOf("risk:read")) {
    test(`${role} typing /risk is refused with a visible message`, async ({ page }) => {
      await loginAndLand(page, EMAIL_FOR[role] as string);
      await page.goto("/risk");

      // The API answers 403 PERMISSION_DENIED; the page must surface it.
      const panel = page.getByTestId("risk-error");
      await expect(panel).toBeVisible();
      // No data grid may appear alongside the refusal.
      await expect(page.getByTestId("risk-kpis")).toHaveCount(0);
      // The panel itself states the reason — see `REFUSAL_REASON`.
      await expect(panel).toContainText(REFUSAL_REASON);

      const text = await page.locator("main").innerText();
      expect({ role, leaks: LEAK_MARKERS.test(text) }).toEqual({ role, leaks: false });
    });
  }

  for (const role of nonHoldersOf("connections:read")) {
    test(`${role} typing each relationship URL is refused`, async ({ page }) => {
      await loginAndLand(page, EMAIL_FOR[role] as string);

      for (const path of ["/connections", "/exchanges", "/blocks"]) {
        await page.goto(path);
        const panel = page.getByTestId(ERROR_TESTID[path] as string);
        await expect(panel).toBeVisible();
        await expect(panel).toContainText(REFUSAL_REASON);
        // The empty-state marker only renders after a successful fetch, so its
        // absence proves the request never succeeded.
        await expect(page.getByTestId(DATA_TESTID[path] as string)).toHaveCount(0);

        const text = await page.locator("main").innerText();
        expect({ path, leaks: LEAK_MARKERS.test(text) }).toEqual({ path, leaks: false });
      }
    });
  }

  // ------------------------------------------------------------------ 4b
  test("the three relationship domains share one holder set, so one check covers all three", () => {
    // Guards the loop above: if a future change made the three sets differ, the
    // derived role list would silently stop covering one of the domains.
    for (const permission of ["exchanges:read", "blocks:read"]) {
      expect(nonHoldersOf(permission)).toEqual(nonHoldersOf("connections:read"));
    }
    expect(nonHoldersOf("connections:read")).toEqual(["MODERATOR", "SUPPORT", "CONTENT_MANAGER"]);
    expect(nonHoldersOf("risk:read")).toEqual(["SUPPORT", "CONTENT_MANAGER"]);
  });

  // ------------------------------------------------------------------ 5
  test("a role that holds the permission reaches the screen normally", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.analyst.email);

    for (const [path, heading] of [
      ["/risk", "风险中心"],
      ["/connections", "连接"],
      ["/exchanges", "交换"],
      ["/blocks", "屏蔽"],
      ["/audit", "审计日志"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      // A permitted screen must not be showing a refusal panel at all. Asserted
      // by the panel's presence rather than by its wording, so it holds whatever
      // copy each screen happens to use — and it is the stronger statement:
      // the refusal container must be absent, not merely unmentioned.
      await expect(page.locator('main [data-testid$="-error"]')).toHaveCount(0);
    }
  });

  // ------------------------------------------------------------------ 6
  test("the sidebar is the only thing a role loses — the URLs stay guarded", async ({ page }) => {
    // Stated as a test because the temptation is to "fix" a 403 by widening the
    // permission. The nav hides the link; the API is what refuses.
    await loginAndLand(page, ACCOUNTS.support.email);
    const rendered = (await page.locator("aside nav a").allTextContents()).map((s) => s.trim());
    expect(rendered).not.toContain("风险中心");

    await page.goto("/risk");
    await expect(page.getByTestId("risk-error")).toBeVisible();
  });
});

test.describe("C5 — anonymous access", () => {
  // ------------------------------------------------------------------ 7
  test("every console route bounces an anonymous visitor to /login", async ({ page }) => {
    for (const entry of CANONICAL_NAV) {
      await page.goto(entry.href);
      await expect(page).toHaveURL(/\/login/);
      // The shell must not render at all — no nav, no identity chip.
      await expect(page.locator("aside nav")).toHaveCount(0);
    }
  });

  // ------------------------------------------------------------------ 8
  test("a signed-out visitor with no session cannot reach the API through the page", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("button", { name: "进入后台" })).toBeVisible();
  });
});

test.describe("C5 — two screens, one number", () => {
  // ------------------------------------------------------------------ 9
  test("the dashboard's open-report count equals the risk centre's", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    // The dashboard card: the value <p> immediately precedes the label <p>.
    // Reading `preceding-sibling::p[1]` binds the number to its own label; a
    // container-based locator would also match every ancestor grid.
    const dashboardValue = await page
      .getByText("待处理举报", { exact: true })
      .locator("xpath=preceding-sibling::p[1]")
      .innerText();

    await openNav(page, "风险中心");
    await expect(page.getByRole("heading", { name: "风险中心" })).toBeVisible();
    const riskValue = await page
      .getByTestId("risk-kpi-待处理举报")
      .getByTestId("risk-kpi-value")
      .innerText();

    // Both are `Report.count({ status: "OPEN" })`. If one screen ever changes
    // its definition, this is where it shows up.
    expect(riskValue.trim()).toBe(dashboardValue.trim());
  });

  // ------------------------------------------------------------------ 10
  test("the dashboard's user total equals the users list total", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    const dashboardValue = await page
      .getByText("用户总数", { exact: true })
      .locator("xpath=preceding-sibling::p[1]")
      .innerText();

    await openNav(page, "用户");
    await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
    // `users-summary` reads 「共 N 人 · 第 X / Y 页」 and only renders above zero.
    const summary = await page.getByTestId("users-summary").innerText();
    const listTotal = /共\s*(\d+)\s*人/.exec(summary)?.[1];

    expect(listTotal).toBeDefined();
    expect(Number(listTotal)).toBe(Number(dashboardValue.trim()));
  });

  // ------------------------------------------------------------------ 11
  test("the connections screen's total agrees with the dashboard's connection KPI", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    const dashboardValue = Number(
      (
        await page
          .getByText("有效连接", { exact: true })
          .locator("xpath=preceding-sibling::p[1]")
          .innerText()
      ).trim(),
    );

    await openNav(page, "连接");
    await expect(page.getByRole("heading", { name: "连接" })).toBeVisible();

    // The list shows REMOVED rows too, so its total is a superset of the
    // dashboard's ACTIVE-only count. With no REMOVED rows the two are equal, and
    // the list can never show fewer than the dashboard counts.
    const body = await page.locator("main").innerText();
    const listTotal = /共\s*(\d+)\s*条/.exec(body)?.[1];
    if (listTotal === undefined) {
      // Empty state: the list states it rather than showing a gap.
      await expect(page.getByTestId("connections-empty")).toBeVisible();
      expect(dashboardValue).toBe(0);
      return;
    }
    expect(Number(listTotal)).toBeGreaterThanOrEqual(dashboardValue);
  });
});

test.describe("C5 — no screen leaks internals", () => {
  // ------------------------------------------------------------------ 12
  test("the refusal states of all four C-era screens are free of internals", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.support.email);

    for (const path of Object.keys(ERROR_TESTID)) {
      await page.goto(path);
      await expect(page.getByTestId(ERROR_TESTID[path] as string)).toBeVisible();
      const text = await page.locator("main").innerText();
      expect({ path, leaks: LEAK_MARKERS.test(text) }).toEqual({ path, leaks: false });
    }
  });

  // ------------------------------------------------------------------ 13
  test("an unknown id on a detail route renders a refusal, not a crash", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    const unknown = "00000000-0000-4000-8000-000000000000";
    for (const path of [
      `/users/${unknown}`,
      `/reports/${unknown}`,
      `/connections/${unknown}`,
      `/exchanges/${unknown}`,
      `/blocks/${unknown}/${unknown}`,
    ]) {
      await page.goto(path);
      // The page must settle into a visible state. Either an explicit
      // not-found message, or the screen's own error container.
      const main = page.locator("main");
      await expect(main).not.toBeEmpty();
      const text = await main.innerText();
      expect({ path, leaks: LEAK_MARKERS.test(text) }).toEqual({ path, leaks: false });
      expect({ path, settled: text.trim().length > 0 }).toEqual({ path, settled: true });
    }
  });

  // ------------------------------------------------------------------ 14
  test("a malformed id in the URL is a refusal, never a server error", async ({ page }) => {
    // The C5 defect: Prisma answered a non-UUID with P2023, which surfaced as a
    // 500 on every id-addressed route. The UUID pipe now answers 400
    // VALIDATION_ERROR, and the page must present that as a normal refusal.
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    for (const path of [
      "/users/not-a-uuid",
      "/reports/not-a-uuid",
      "/connections/not-a-uuid",
      "/exchanges/not-a-uuid",
      "/blocks/not-a-uuid/not-a-uuid",
    ]) {
      await page.goto(path);
      const text = await page.locator("main").innerText();
      expect({ path, leaks: LEAK_MARKERS.test(text) }).toEqual({ path, leaks: false });
      // No screen may claim a server failure for a malformed URL.
      expect({ path, serverError: /500|INTERNAL_ERROR|Something went wrong/.test(text) }).toEqual({
        path,
        serverError: false,
      });
    }
  });
});

test.describe("C5 — the matrix is not quietly widened", () => {
  // ------------------------------------------------------------------ 15
  test("no screen offers a write control in a read-only domain", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    for (const path of ["/risk", "/connections", "/exchanges", "/blocks"]) {
      await page.goto(path);
      const main = page.locator("main");
      // The three relationship domains and risk ship no mutation, even for the
      // role that holds every write permission in the matrix.
      for (const label of ["删除", "解除", "新建", "编辑", "保存", "提交", "导出"]) {
        await expect(main.getByRole("button", { name: label, exact: true })).toHaveCount(0);
      }
    }
  });

  // ------------------------------------------------------------------ 16
  test("only the audit screen mentions an operator's user-agent", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    // `ip` / `userAgent` are part of the audit screen's contract — it exists to
    // answer "where did this action come from". No summary screen repeats them.
    await openNav(page, "审计日志");
    await expect(page.getByRole("heading", { name: "审计日志" })).toBeVisible();

    for (const path of ["/dashboard", "/risk", "/users"]) {
      await page.goto(path);
      const text = await page.locator("main").innerText();
      expect({ path, mentionsUserAgent: /user-?agent/i.test(text) }).toEqual({
        path,
        mentionsUserAgent: false,
      });
    }
  });
});
