import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { ACCOUNTS } from "../fixtures/admin-roles";
import { loginAndLand, openUserDetail } from "../fixtures/browser";

/**
 * Phase A+ — real browser tests for the admin user *detail* screen.
 *
 * What this adds over `admin-rbac.spec.ts`: the list screen was covered, but the
 * detail screen had no status controls at all, so nothing proved that clicking
 * through to a user produced a working screen. These tests drive the whole path
 * — list → click → detail → confirmation dialog → API → database → re-render.
 *
 * IMPORTANT: the button visibility assertions are presentation-only. The API's
 * `PermissionGuard` + `AdminService` checks remain the sole security boundary.
 * One test does perform a real write, which is the point: it proves the wiring
 * end to end rather than just that a button renders.
 */

const API_URL = "http://localhost:4000/api/v1";

/** A well-formed UUID that no fixture and no seed can collide with. */
const MISSING_USER_ID = "00000000-0000-4000-8000-000000000000";

/** The four labels the detail screen can render, in display order. */
const ALL_ACTIONS = ["解封", "停用", "临时封禁", "永久封禁"];

const REASON_PLACEHOLDER = "请说明本次操作的原因，将写入审计日志";

test.describe("admin user detail — behaviour by role", () => {
  // ------------------------------------------------------------------ 1
  test("SUPER_ADMIN reaches the detail screen and every confirmation gate behaves", async ({
    page,
  }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openUserDetail(page, "victim");

    // The screen rendered a real user, not an empty shell.
    await expect(page.getByRole("heading", { name: "用户详情" })).toBeVisible();
    await expect(page.getByText("pw.victim@example.test")).toBeVisible();

    // Every status action is offered to a SUPER_ADMIN.
    for (const label of ALL_ACTIONS) {
      await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
    }

    // --- a plain action: reason required, no extra confirmation ------------
    await page.getByRole("button", { name: "停用", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("停用用户")).toBeVisible();

    // A blank reason must not be confirmable — the gate is not decorative.
    const disableConfirm = dialog.getByRole("button", { name: "停用", exact: true });
    await expect(disableConfirm).toBeDisabled();
    await dialog.getByPlaceholder(REASON_PLACEHOLDER).fill("phase A+ browser test");
    await expect(disableConfirm).toBeEnabled();
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // --- permanent ban: extra danger copy and a typed phrase ---------------
    await page.getByRole("button", { name: "永久封禁", exact: true }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByText("永久封禁用户")).toBeVisible();
    await expect(dialog.getByText("这是永久性操作，不会自动解除。")).toBeVisible();

    const banConfirm = dialog.getByRole("button", { name: "永久封禁", exact: true });
    await dialog.getByPlaceholder(REASON_PLACEHOLDER).fill("phase A+ browser test");
    // The ban dialog has exactly one <input>: the phrase field.
    await expect(banConfirm).toBeDisabled();
    await dialog.locator("input").fill("BAN");
    await expect(banConfirm).toBeEnabled();
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // --- suspension: an expiry picker, pre-filled and confirmable ----------
    await page.getByRole("button", { name: "临时封禁", exact: true }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByText("临时封禁用户")).toBeVisible();
    await expect(dialog.getByText(/解封时间（必填/)).toBeVisible();
    await dialog.getByPlaceholder(REASON_PLACEHOLDER).fill("phase A+ browser test");
    await expect(dialog.getByRole("button", { name: "临时封禁", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: "取消" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Every dialog above was cancelled, so nothing was written.
    await expect(page.locator("main")).toContainText("正常");
  });

  // ------------------------------------------------------------------ 2
  test("MODERATOR may act on a member but is never offered a permanent ban", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.moderator.email);
    await openUserDetail(page, "victim");

    await expect(page.getByRole("heading", { name: "用户详情" })).toBeVisible();

    // Allowed: temporary suspension. Forbidden: permanent ban.
    await expect(page.getByRole("button", { name: "临时封禁", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "永久封禁", exact: true })).toHaveCount(0);

    // The member starts ACTIVE, so the change below is a real transition.
    await expect(page.locator("main")).toContainText("正常");

    // An allowed action completes end to end: button → dialog → API → DB → re-render.
    await page.getByRole("button", { name: "停用", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByPlaceholder(REASON_PLACEHOLDER).fill("phase A+ moderator action");
    await dialog.getByRole("button", { name: "停用", exact: true }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("main")).toContainText("已停用");
  });

  // ------------------------------------------------------------------ 3
  test("SUPPORT may view a member but only gets basic account controls", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.support.email);
    await openUserDetail(page, "victim");

    await expect(page.getByRole("heading", { name: "用户详情" })).toBeVisible();
    await expect(page.getByText("pw.victim@example.test")).toBeVisible();

    // Allowed: basic account handling.
    await expect(page.getByRole("button", { name: "停用", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "解封", exact: true })).toBeVisible();

    // Forbidden: suspension and permanent ban are both escalation.
    await expect(page.getByRole("button", { name: "临时封禁", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "永久封禁", exact: true })).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 4
  test("ANALYST sees the detail screen read-only", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.analyst.email);
    await openUserDetail(page, "victim");

    await expect(page.getByRole("heading", { name: "用户详情" })).toBeVisible();
    await expect(page.getByText(/只读/)).toBeVisible();

    for (const label of ALL_ACTIONS) {
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
    }
  });

  // ------------------------------------------------------------------ 5
  test("an unknown user id is a 404, never a 200 with a null body", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    // The API contract, asserted over real HTTP with the session cookie.
    const response = await page.request.get(`${API_URL}/admin/users/${MISSING_USER_ID}`);
    expect(response.status()).toBe(404);

    const body = (await response.json()) as {
      success?: boolean;
      data?: unknown;
      error?: { code?: string; message?: string };
    };
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe("USER_NOT_FOUND");
    // The bug being fixed: this used to be 200 + { success: true, data: null }.
    expect(body).not.toHaveProperty("data");

    // And the console renders a Not Found state instead of hanging on 「加载中…」.
    await page.goto(`/users/${MISSING_USER_ID}`);
    await expect(page.getByRole("heading", { name: "用户不存在" })).toBeVisible();
    await expect(page.getByText("加载中…")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "用户详情" })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Phase B3 — aggregate cards, audit summary, and read-only roles
// ---------------------------------------------------------------------------

/** A dedicated target user for B3 aggregate tests, outside the fixture set so
 * globalSetup's cleanup never touches it. */
const B3_TARGET_EMAIL = "pw.b3target@example.test";
const B3_PEER_EMAIL = "pw.b3peer@example.test";
const B3_CONTENT_MANAGER_EMAIL = "pw.b3contentmgr@example.test";
const B3_CONTENT_MANAGER_PASSWORD = "PhaseAplus!2026";

test.describe("admin user detail — Phase B3 aggregates", () => {
  const prisma = new PrismaClient();

  test.beforeAll(async () => {
    // Idempotent: delete any stale rows from a crashed previous run.
    const stale = await prisma.user.findUnique({ where: { email: B3_TARGET_EMAIL }, select: { id: true } });
    if (stale) {
      await prisma.adminAuditLog.deleteMany({ where: { targetId: stale.id } });
      await prisma.socialAccount.deleteMany({ where: { userId: stale.id } });
      await prisma.block.deleteMany({ where: { OR: [{ blockerId: stale.id }, { blockedId: stale.id }] } });
      await prisma.report.deleteMany({ where: { OR: [{ reporterId: stale.id }, { reportedUserId: stale.id }] } });
      await prisma.connection.deleteMany({ where: { OR: [{ userAId: stale.id }, { userBId: stale.id }] } });
      await prisma.user.deleteMany({ where: { id: stale.id } });
    }
    await prisma.user.deleteMany({ where: { email: B3_PEER_EMAIL } });

    // Create the target user with a birthDate so profile completion = 100%.
    const target = await prisma.user.create({
      data: {
        email: B3_TARGET_EMAIL,
        passwordHash: "x",
        emailVerified: true,
        nickname: "B3 Target",
        countryCode: "US",
        birthDate: new Date("1995-06-15T00:00:00.000Z"),
      },
      select: { id: true },
    });

    // Create a peer user for connections / blocks / reports.
    const peer = await prisma.user.create({
      data: {
        email: B3_PEER_EMAIL,
        passwordHash: "x",
        emailVerified: true,
        nickname: "B3 Peer",
        countryCode: "US",
      },
      select: { id: true },
    });

    // Connection.
    await prisma.connection.create({
      data: { userAId: target.id, userBId: peer.id, status: "ACTIVE" },
    });

    // Reports received by target (2).
    await prisma.report.createMany({
      data: [
        { reporterId: peer.id, reportedUserId: target.id, reason: "SPAM", status: "OPEN" },
        { reporterId: peer.id, reportedUserId: target.id, reason: "HARASSMENT", status: "OPEN" },
      ],
    });

    // Report made by target (1).
    await prisma.report.create({
      data: { reporterId: target.id, reportedUserId: peer.id, reason: "ABUSE", status: "OPEN" },
    });

    // Block made by target (1).
    await prisma.block.create({
      data: { blockerId: target.id, blockedId: peer.id },
    });

    // Block received by target (1).
    await prisma.block.create({
      data: { blockerId: peer.id, blockedId: target.id },
    });

    // Social accounts (2).
    await prisma.socialAccount.createMany({
      data: [
        { userId: target.id, platform: "TELEGRAM", handle: "@target_tg" },
        { userId: target.id, platform: "WECHAT", handle: "target_wx" },
      ],
    });

    // Audit rows: one USER, one SYSTEM.
    const superAdmin = await prisma.user.findUnique({
      where: { email: ACCOUNTS.superadmin.email },
      select: { id: true },
    });
    await prisma.adminAuditLog.createMany({
      data: [
        {
          actorType: "USER",
          adminId: superAdmin!.id,
          action: "ADMIN_USER_DISABLE",
          targetType: "USER",
          targetId: target.id,
          reason: "B3 fixture",
        },
        {
          actorType: "SYSTEM",
          adminId: null,
          action: "USER_SUSPENSION_EXPIRED",
          targetType: "USER",
          targetId: target.id,
          reason: null,
        },
      ],
    });

    // CONTENT_MANAGER read-only account for test 10.
    const cm = await prisma.user.upsert({
      where: { email: B3_CONTENT_MANAGER_EMAIL },
      update: { passwordHash: await require("bcryptjs").hash(B3_CONTENT_MANAGER_PASSWORD, 10) },
      create: {
        email: B3_CONTENT_MANAGER_EMAIL,
        passwordHash: await require("bcryptjs").hash(B3_CONTENT_MANAGER_PASSWORD, 10),
        emailVerified: true,
        nickname: "B3 CM",
        countryCode: "US",
        isAdmin: true,
      },
      select: { id: true },
    });
    await prisma.adminUser.upsert({
      where: { userId: cm.id },
      update: { role: "CONTENT_MANAGER", isActive: true },
      create: { userId: cm.id, role: "CONTENT_MANAGER", isActive: true },
    });
  });

  test.afterAll(async () => {
    const target = await prisma.user.findUnique({ where: { email: B3_TARGET_EMAIL }, select: { id: true } });
    if (target) {
      await prisma.adminAuditLog.deleteMany({ where: { targetId: target.id } });
      await prisma.socialAccount.deleteMany({ where: { userId: target.id } });
      await prisma.block.deleteMany({ where: { OR: [{ blockerId: target.id }, { blockedId: target.id }] } });
      await prisma.report.deleteMany({ where: { OR: [{ reporterId: target.id }, { reportedUserId: target.id }] } });
      await prisma.connection.deleteMany({ where: { OR: [{ userAId: target.id }, { userBId: target.id }] } });
      await prisma.user.deleteMany({ where: { id: target.id } });
    }
    await prisma.user.deleteMany({ where: { email: B3_PEER_EMAIL } });
    const cm = await prisma.user.findUnique({ where: { email: B3_CONTENT_MANAGER_EMAIL }, select: { id: true } });
    if (cm) {
      await prisma.adminUser.deleteMany({ where: { userId: cm.id } });
      await prisma.user.deleteMany({ where: { id: cm.id } });
    }
    await prisma.$disconnect();
  });

  test("6. profile completion is rendered when the user has a birthDate", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openUserDetail(page, "b3target");

    const section = page.getByTestId("profile-completion");
    await expect(section).toBeVisible();
    await expect(section).toContainText("2 / 2");
    await expect(section).toContainText("100%");
  });

  test("7. aggregate cards show real PostgreSQL counts", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openUserDetail(page, "b3target");

    await expect(page.getByTestId("stat-connections")).toContainText("1");
    await expect(page.getByTestId("stat-reports-received")).toContainText("2");
    await expect(page.getByTestId("stat-reports-made")).toContainText("1");
    await expect(page.getByTestId("stat-blocks-made")).toContainText("1");
    await expect(page.getByTestId("stat-blocks-received")).toContainText("1");
    await expect(page.getByTestId("stat-social-accounts")).toContainText("2");
  });

  test("8. audit summary renders USER rows with admin id", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openUserDetail(page, "b3target");

    await expect(page.locator("main")).toContainText("ADMIN_USER_DISABLE");
    await expect(page.locator("main")).toContainText("B3 fixture");
  });

  test("9. audit summary renders SYSTEM rows as 系统 · 自动", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openUserDetail(page, "b3target");

    await expect(page.locator("main")).toContainText("系统 · 自动");
    await expect(page.locator("main")).toContainText("USER_SUSPENSION_EXPIRED");
  });

  test("10. CONTENT_MANAGER sees the detail screen read-only", async ({ page }) => {
    await loginAndLand(page, B3_CONTENT_MANAGER_EMAIL);
    await openUserDetail(page, "b3target");

    await expect(page.getByRole("heading", { name: "用户详情" })).toBeVisible();
    await expect(page.getByText(/只读/)).toBeVisible();

    for (const label of ALL_ACTIONS) {
      await expect(page.getByRole("button", { name: label, exact: true })).toHaveCount(0);
    }
  });

  test("11. a member with empty relations shows zero counts, not missing cards", async ({ page }) => {
    // The analyst fixture user has no B3 data and no pre-existing reports.
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openUserDetail(page, "analyst");

    await expect(page.getByTestId("stat-connections")).toContainText("0");
    await expect(page.getByTestId("stat-reports-received")).toContainText("0");
    await expect(page.getByTestId("stat-reports-made")).toContainText("0");
    await expect(page.getByTestId("stat-blocks-made")).toContainText("0");
    await expect(page.getByTestId("stat-blocks-received")).toContainText("0");
    await expect(page.getByTestId("stat-social-accounts")).toContainText("0");
  });

  test("12. sensitive fields do not appear in the page text", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openUserDetail(page, "b3target");

    const main = page.locator("main");
    await expect(main).not.toContainText("passwordHash");
    await expect(main).not.toContainText("tokenHash");
    await expect(main).not.toContainText("refreshToken");
    await expect(main).not.toContainText("accessToken");
    await expect(main).not.toContainText("oauth");
    await expect(main).not.toContainText("secret");
    await expect(main).not.toContainText("203.0.113.7");
    await expect(main).not.toContainText("jest-patch");
  });
});
