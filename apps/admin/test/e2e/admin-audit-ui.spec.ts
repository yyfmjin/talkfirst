import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import {
  AUDIT_FIXTURE_PREFIX,
  cleanupAuditRows,
  seedAuditRows,
  type AuditFixtureIds,
  type SeedIds,
} from "../fixtures/admin-roles";
import { openNav, loginAndLand } from "../fixtures/browser";

/**
 * Audit screen — both kinds of actor must render.
 *
 * ## The defect this covers
 *
 * `apps/admin/src/app/audit/page.tsx` rendered the actor unconditionally from
 * `item.adminId.slice(0, 8)`. Once a SYSTEM row exists, `adminId` is `null`, so
 * that expression throws during render and the whole page dies — one machine
 * action would have blanked the audit log for every operator.
 *
 * The fix has to satisfy three separate things, and a source-regex test cannot
 * tell them apart:
 *
 *   1. a human row still renders exactly as it always did (no visual drift);
 *   2. a machine row renders as a machine, not as a blank or `null` admin;
 *   3. the page survives at all — no white screen, no error boundary.
 *
 * ## Why the fixture writes rows directly
 *
 * No admin endpoint can create a SYSTEM row. The only producer is the
 * suspension-expiry scheduler, which cannot be fired on demand from a browser
 * test. So the two rows are inserted through Prisma, marked with a prefix so
 * cleanup removes exactly them. The database CHECK guarantees the inserted
 * SYSTEM row is a legal one.
 */

const MARKER_HUMAN = `${AUDIT_FIXTURE_PREFIX}HUMAN_ACTION`;
const MARKER_SYSTEM = `${AUDIT_FIXTURE_PREFIX}SYSTEM_ACTION`;

let prisma: PrismaClient;
let ids: SeedIds;
let rows: AuditFixtureIds;

test.beforeAll(async () => {
  prisma = new PrismaClient();
  const users = await prisma.user.findMany({
    where: { email: "pw.superadmin@example.test" },
    select: { id: true },
  });
  if (users.length !== 1) {
    throw new Error(
      `expected exactly one seeded superadmin, found ${users.length}; is globalSetup wired up?`,
    );
  }
  const victim = await prisma.user.findMany({
    where: { email: "pw.victim@example.test" },
    select: { id: true },
  });
  if (victim.length !== 1) {
    throw new Error(`expected exactly one seeded victim, found ${victim.length}`);
  }
  ids = { superadmin: users[0].id, victim: victim[0].id } as SeedIds;
  rows = await seedAuditRows(prisma, ids);
});

test.afterAll(async () => {
  if (!prisma) return;
  await cleanupAuditRows(prisma);
  await prisma.$disconnect();
});

/**
 * The audit list is ordered `createdAt DESC` and paginated at 20 per page, and
 * these fixtures are the newest rows in the table, so both land on page 1.
 */
async function openAuditPage(page: import("@playwright/test").Page) {
  await loginAndLand(page, "pw.superadmin@example.test");
  await openNav(page, "审计日志");
  await expect(page.getByRole("heading", { name: "审计日志" })).toBeVisible();
  await expect(page).toHaveURL(/\/audit$/);
}

/** The card wrapping a given action, located from its own title element. */
function cardFor(page: import("@playwright/test").Page, action: string) {
  return page.getByText(action, { exact: true }).locator("..");
}

test.describe("audit screen — SYSTEM vs USER actors", () => {
  // --------------------------------------------------------- mandated case 10
  test("Test 10: a human audit row still renders the acting admin", async ({ page }) => {
    await openAuditPage(page);

    const card = cardFor(page, MARKER_HUMAN);
    await expect(card).toBeVisible();

    // Exactly the pre-existing presentation: `admin <first 8 of the uuid>`.
    await expect(card).toContainText(`admin ${ids.superadmin.slice(0, 8)}`);
    // A human row must never be labelled as automated.
    await expect(card).not.toContainText("系统");
    // And it still shows its target.
    await expect(card).toContainText(`target ${ids.victim.slice(0, 8)}`);
  });

  // --------------------------------------------------------- mandated case 11
  test("Test 11: a SYSTEM audit row renders as 系统 · 自动, with no admin id", async ({ page }) => {
    await openAuditPage(page);

    const card = cardFor(page, MARKER_SYSTEM);
    await expect(card).toBeVisible();

    await expect(card.getByText("系统 · 自动")).toBeVisible();

    // The regression this whole change exists for: no fabricated actor. The row
    // must not print an admin prefix, and must not leak `null` into the UI.
    await expect(card).not.toContainText("admin ");
    await expect(card).not.toContainText("null");
    await expect(card).not.toContainText("undefined");

    // A batch machine action has no single target, so it shows the placeholder
    // rather than a broken slice of a missing id.
    await expect(card).toContainText("target -");
  });

  // --------------------------------------------------------- mandated case 12
  test("Test 12: a null adminId does not crash or blank the page", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openAuditPage(page);

    // The page rendered its chrome — a render-time throw would have replaced
    // this with an error boundary instead.
    await expect(page.getByRole("heading", { name: "审计日志" })).toBeVisible();
    await expect(page.getByText("共", { exact: false })).toBeVisible();

    // Both fixture rows are present simultaneously: the SYSTEM row did not stop
    // the human row (or any other row) from rendering.
    await expect(page.getByText(MARKER_SYSTEM, { exact: true })).toBeVisible();
    await expect(page.getByText(MARKER_HUMAN, { exact: true })).toBeVisible();

    // The list is not empty and not half-rendered.
    const cards = page.locator("main div.rounded-2xl");
    expect(await cards.count()).toBeGreaterThan(1);

    // No uncaught render exception anywhere.
    expect(pageErrors).toEqual([]);

    // Nothing in the DOM exposes a raw null-ish actor.
    await expect(page.locator("body")).not.toContainText("Cannot read properties");
    await expect(page.locator("body")).not.toContainText("Application error");
  });

  test("Test 12b: the SYSTEM row is still a single, correctly-attributed card", async ({ page }) => {
    await openAuditPage(page);

    // Exactly one card for the marker: no duplicate render from a bad key.
    await expect(page.getByText(MARKER_SYSTEM, { exact: true })).toHaveCount(1);

    const card = cardFor(page, MARKER_SYSTEM);
    // The detail text survives, so the row is fully rendered rather than
    // partially bailing out after the actor span.
    await expect(card).toContainText("audit UI fixture — machine action");
    // The action name itself is still shown.
    await expect(card).toContainText(MARKER_SYSTEM);
    // A human row carries its own detail too — proof both branches ran.
    await expect(cardFor(page, MARKER_HUMAN)).toContainText("audit UI fixture — human action");
  });
});
