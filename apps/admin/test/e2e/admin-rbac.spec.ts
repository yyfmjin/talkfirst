import { expect, test } from "@playwright/test";
import { ACCOUNTS } from "../fixtures/admin-roles";
import { loginAndLand, openNav, submitLogin } from "../fixtures/browser";

/**
 * Phase A+ — real browser behaviour tests for the admin console.
 *
 * Scope is deliberately minimal: prove that each role sees the controls it may
 * use and not the ones it may not, and that a session the backend rejects never
 * reaches the shell. Full-page E2E for every screen is out of scope for this
 * phase.
 *
 * IMPORTANT: these assertions are presentation-only. The API's `PermissionGuard`
 * and `AdminService` scope checks remain the sole security boundary — a hidden
 * button is not an authorization control. Backend enforcement is covered by
 * `apps/api/src/admin/*.spec.ts` and `scripts/phaseA-rbac-verify.mjs`.
 */

/**
 * Every route the console actually ships, in the order the sidebar renders them.
 *
 * This list is intentionally exhaustive and order-sensitive: its job is to fail
 * the moment a route appears that no phase authorised. So it has to grow in the
 * same commit as a legitimate new screen — which is what Phase B5 did when it
 * added 「审核工作台」, Phase C1 when it added 「风险中心」, Phase C2 when it
 * added 「连接」, and Phase C3 when it added 「交换」. Keeping it exhaustive
 * (rather than asserting a subset) is the whole point.
 *
 * This is the **SUPER_ADMIN** view — the only role holding every permission.
 * Roles with a narrower grant see a shorter nav; see `MODERATOR_NAV_LABELS`.
 */
const NAV_LABELS = [
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

/**
 * The nav a MODERATOR sees: `NAV_LABELS` minus the entries their role may not
 * read.
 *
 * Three entries are missing, and all for the same reason. Phase C2's 「连接」 is
 * gated on `connections:read`, Phase C3's 「交换」 on `exchanges:read` and Phase
 * C4's 「屏蔽」 on `blocks:read` — and MODERATOR holds **none** of the three.
 * Holding `moderation:read` does not confer connection, exchange or block
 * access; those are different jobs. So this role's exhaustive list is **three**
 * entries shorter, and the length difference is part of what the assertion
 * below pins.
 *
 * Written out rather than derived from the permission matrix on purpose: a new
 * screen must still be added here deliberately, which is what makes the
 * equality assertion below able to catch an unauthorised route.
 */
const MODERATOR_NAV_LABELS = ["仪表盘", "用户", "举报", "审核工作台", "风险中心", "审计日志"];

test.describe("admin console — role behaviour", () => {
  // ------------------------------------------------------------------ 1
  test("an active SUPER_ADMIN can enter the console", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    // Identity is resolved from the backend, not a client-side flag.
    await expect(page.getByText("SUPER_ADMIN", { exact: true })).toBeVisible();
    await expect(page.getByText("超级管理员")).toBeVisible();

    // Every Phase A route is reachable.
    for (const label of NAV_LABELS) {
      await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
    }

    // The dashboard actually loaded data rather than erroring. Phase B1 renamed
    // these KPI labels (「总用户」→「用户总数」, 「待审举报」→「待处理举报」), so the
    // assertion tracks the real page structure rather than being dropped.
    await expect(page.getByText("用户总数")).toBeVisible();
    await expect(page.getByText("待处理举报")).toBeVisible();
    await expect(page.getByText("在线管理员")).toBeVisible();

    // Users screen: a SUPER_ADMIN may perform every status action.
    await openNav(page, "用户");
    await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
    for (const label of ["解封", "停用", "临时封禁", "永久封禁"]) {
      await expect(
        page.getByRole("button", { name: label, exact: true }).first(),
      ).toBeVisible();
    }
  });

  // ------------------------------------------------------------------ 2
  test("an administrator with AdminUser.isActive = false is refused", async ({ page }) => {
    await submitLogin(page, ACCOUNTS.inactive.email);

    // The backend returns ADMIN_INACTIVE and the console surfaces it verbatim.
    await expect(page.getByText("该管理员账号已被停用，请联系超级管理员。")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    // It must never render the shell. Even though User.isAdmin is true for this
    // fixture, the disabled AdminUser row wins — the legacy fallback does not
    // open a door for a deactivated admin.
    await expect(page.getByRole("heading", { name: "仪表盘" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "用户", exact: true })).toHaveCount(0);

    // And the session is dead: going straight to the console bounces back.
    // This exercises the Phase A+ UNAUTHORIZED code path in a real browser —
    // previously this failure was the opaque HTTP_ERROR.
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  // ------------------------------------------------------------------ 3
  test("ANALYST can read every screen but sees no write controls", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.analyst.email);

    await expect(page.getByText("ANALYST", { exact: true })).toBeVisible();

    // Read surfaces are reachable.
    await expect(page.getByRole("link", { name: "审计日志", exact: true })).toBeVisible();
    await openNav(page, "审计日志");
    await expect(page.getByRole("heading", { name: "审计日志" })).toBeVisible();

    await openNav(page, "用户");
    await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
    await expect(page.getByText(/只读/)).toBeVisible();

    // No status control of any kind, and no note composer.
    for (const label of ["解封", "停用", "临时封禁", "永久封禁"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
    }
    await expect(page.getByPlaceholder("写一条内部备注…")).toHaveCount(0);

    // Reports are readable but not reviewable.
    await openNav(page, "举报");
    await expect(page.getByRole("heading", { name: "举报审核" })).toBeVisible();
    await expect(page.getByText(/只有查看权限/)).toBeVisible();
    for (const label of ["受理", "处理", "驳回"]) {
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
    }
  });

  // ------------------------------------------------------------------ 4
  test("SUPPORT may disable and activate, but never ban or suspend", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.support.email);
    await openNav(page, "用户");
    await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();

    // Allowed: basic account handling.
    await expect(page.getByRole("button", { name: "停用", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "解封", exact: true }).first()).toBeVisible();

    // Forbidden: no temporary suspension, and permanent ban is SUPER_ADMIN-only.
    await expect(page.getByRole("button", { name: "临时封禁", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "永久封禁", exact: true })).toHaveCount(0);

    // SUPPORT cannot review reports either.
    await openNav(page, "举报");
    await expect(page.getByText(/只有查看权限/)).toBeVisible();
    await expect(page.getByRole("button", { name: "处理", exact: true })).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 5
  test("MODERATOR may review reports but not permanently ban", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.moderator.email);
    await expect(page.getByText("MODERATOR", { exact: true })).toBeVisible();

    // Report review is the moderator's job.
    await openNav(page, "举报");
    await expect(page.getByRole("heading", { name: "举报审核" })).toBeVisible();
    await expect(page.getByRole("button", { name: "受理", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "处理", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "驳回", exact: true }).first()).toBeVisible();

    // Users: temporary suspension yes, permanent ban no.
    await openNav(page, "用户");
    await expect(page.getByRole("button", { name: "临时封禁", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "永久封禁", exact: true })).toHaveCount(0);

    // The nav exposes exactly the routes this role may reach — nothing more.
    // A MODERATOR holds `risk:read` but not `connections:read`, so 「连接」 is
    // absent here while the rest of the order is unchanged.
    const navLabels = await page.locator("aside nav a").allTextContents();
    expect(navLabels.map((s) => s.trim())).toEqual(MODERATOR_NAV_LABELS);

    // NOTE: the Phase A console ships no settings screen and no audit-export
    // control, so these two assertions are true for every role today. They
    // record the contract and start carrying real weight once those modules
    // land in a later phase.
    await expect(page.getByRole("link", { name: /设置/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /导出/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /导出/ })).toHaveCount(0);
  });
});
