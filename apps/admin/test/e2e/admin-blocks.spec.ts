import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { ACCOUNTS, FIXTURE_EMAILS, type SeedIds } from "../fixtures/admin-roles";
import { loginAndLand, openNav } from "../fixtures/browser";

/**
 * Phase C4 — real browser behaviour tests for the Blocks screens.
 *
 * ## What this suite is for
 *
 *   1. **Every number on screen equals a count taken independently from
 *      PostgreSQL.** Counted here through Prisma, deliberately *not* through the
 *      page's own endpoint, so the two sides are genuinely independent.
 *   2. **A block has no `id`.** `Block` declares `@@id([blockerId, blockedId])`,
 *      so a row is keyed by the pair, 「查看」 links to
 *      `/blocks/{blockerId}/{blockedId}`, and there is no 「屏蔽 ID」 column
 *      showing a value the database cannot resolve.
 *   3. **Direction is shown as stored.** The fixtures contain `Alice → Bob`,
 *      `Bob → Alice` and `Carol → Alice`. A screen that normalised the pair —
 *      sorted the ids, deduplicated, collapsed them into an unordered
 *      「关联用户」 pair — would pass a single-row test and fails here.
 *      Reversing it would tell an operator the opposite of the truth.
 *   4. **`user` matches either side.** Alice is the *blocker* of one fixture and
 *      the *blocked* party of two others, so a search for her can only return
 *      three rows if the filter genuinely checks both columns.
 *   5. **No social handle, no email, no credential ever reaches the screen.**
 *      The fixture carries a recognisable `PW_BLOCK_SECRET_HANDLE_…` literal on
 *      a `SocialAccount`, plus real fixture emails. Both are scanned for in the
 *      API's own JSON response *and* in the rendered page — because "the UI does
 *      not display it" is a weaker claim than "the API does not send it", and
 *      both are asserted.
 *   6. **Read-only.** No unblock, edit, delete or restore control exists; no
 *      audit row is written by a read; refreshing does not reload the page.
 *   7. **RBAC.** The nav entry and the page follow `blocks:read`, held by
 *      SUPER_ADMIN and ANALYST only — the same holder set as `connections:read`
 *      and `exchanges:read`.
 *
 * ## What this suite is NOT
 *
 * Not the security boundary. A hidden link is a convenience; the API's
 * `PermissionGuard` is the boundary, covered by
 * `apps/api/src/admin/admin-blocks.spec.ts` and
 * `scripts/phaseA-rbac-verify.mjs`.
 */

/**
 * Fixture marker. Every row this suite writes carries it, so cleanup removes
 * exactly these and can never touch product data.
 *
 * `Block` has no free-text column to mark — its only columns are two ids and a
 * timestamp — so the marker lives on the **users** the blocks point at (their
 * nickname and email), and cleanup then deletes the blocks by their
 * participants' ids. This is the only honest way to scope a fixture on a model
 * whose own columns carry no test label.
 */
const BLOCK_FIXTURE_PREFIX = "PW_BLOCK_UI_";

const ALICE_NICKNAME = `${BLOCK_FIXTURE_PREFIX}Alice`;
const BOB_NICKNAME = `${BLOCK_FIXTURE_PREFIX}Bob`;
const CAROL_NICKNAME = `${BLOCK_FIXTURE_PREFIX}Carol`;

const FIXTURE_EMAIL_DOMAIN = "pw-block-ui.invalid";

/**
 * Recognisable literals a leaked `SocialAccount.handle` would carry.
 *
 * Not `@alice` or a plausible-looking username: if a leak ever happens the
 * failure message should name the exact field that leaked, and a scan for a
 * literal is only meaningful when the literal cannot occur by accident.
 */
const SECRET_HANDLE_ALICE = "PW_BLOCK_SECRET_HANDLE_alice_tg";
const SECRET_HANDLE_BOB = "PW_BLOCK_SECRET_HANDLE_bob_wa";

/** Explicit instants, so ordering and the date filter are deterministic. */
const ALICE_TO_BOB_AT = new Date("2026-03-01T10:00:00.000Z");
const BOB_TO_ALICE_AT = new Date("2026-03-02T10:00:00.000Z");
const CAROL_TO_ALICE_AT = new Date("2026-03-03T10:00:00.000Z");

/** The one page size the console uses by default. */
const DEFAULT_PAGE_SIZE = 20;

/** How many filler rows the pagination test adds on top of the three fixtures. */
const PAGINATION_FILLER = 20;

/**
 * Baseline taken before the fixtures existed, so deltas are honest.
 *
 * Only `Block` is counted, because it is the only table this suite writes that
 * no other suite also writes. The fixture *users* are counted indirectly: they
 * are removed by email in cleanup and the removal count is asserted, which is a
 * stronger statement than a bare row count.
 */
type Baselines = {
  blocks: number;
  auditLogs: number;
};

type FixtureIds = {
  aliceId: string;
  bobId: string;
  carolId: string;
};

async function readBaselines(prisma: PrismaClient): Promise<Baselines> {
  const [blocks, auditLogs] = await Promise.all([
    prisma.block.count(),
    prisma.adminAuditLog.count(),
  ]);
  return { blocks, auditLogs };
}

/**
 * Creates the minimal real fixture the phase requires:
 *
 *   Alice → Bob     (Alice did the blocking)
 *   Carol → Alice
 *   Bob   → Alice   (the reverse of the first row — a different fact)
 *
 * Alice therefore appears **once as blocker and twice as the blocked party**,
 * which is what makes "user = Alice returns 3" a real either-side assertion
 * rather than a restatement of one column.
 *
 * A `SocialAccount` carrying a recognisable handle is created too. A `Block` has
 * no relation to it, so there is no path by which it could legitimately appear —
 * which is exactly why its absence is worth asserting.
 *
 * Idempotent: a crashed previous run must not leave rows behind.
 */
async function seedBlockFixtures(prisma: PrismaClient) {
  await cleanupBlockFixtures(prisma);

  const baselines = await readBaselines(prisma);

  const [alice, bob, carol] = await Promise.all([
    prisma.user.create({
      data: {
        email: `alice@${FIXTURE_EMAIL_DOMAIN}`,
        // P0-02 — required and unique. Prefixed per spec; see the same note in
        // `admin-connections.spec.ts`.
        username: "e2eblkalice",
        passwordHash: "not-a-real-login",
        nickname: ALICE_NICKNAME,
        status: "ACTIVE",
      },
      select: { id: true },
    }),
    prisma.user.create({
      data: {
        email: `bob@${FIXTURE_EMAIL_DOMAIN}`,
        username: "e2eblkbob",
        passwordHash: "not-a-real-login",
        nickname: BOB_NICKNAME,
        status: "ACTIVE",
      },
      select: { id: true },
    }),
    prisma.user.create({
      data: {
        email: `carol@${FIXTURE_EMAIL_DOMAIN}`,
        username: "e2eblkcarol",
        passwordHash: "not-a-real-login",
        nickname: CAROL_NICKNAME,
        status: "ACTIVE",
      },
      select: { id: true },
    }),
  ]);

  // The direction is the row's meaning: `blockerId` did the blocking.
  await prisma.block.create({
    data: { blockerId: alice.id, blockedId: bob.id, createdAt: ALICE_TO_BOB_AT },
  });
  await prisma.block.create({
    data: { blockerId: carol.id, blockedId: alice.id, createdAt: CAROL_TO_ALICE_AT },
  });
  await prisma.block.create({
    data: { blockerId: bob.id, blockedId: alice.id, createdAt: BOB_TO_ALICE_AT },
  });

  // Sensitive rows that must never surface on a blocks screen. They hang off the
  // fixture users, so they are removed by the user cascade — but they exist so
  // the privacy scans have something real to find if a leak ever appears.
  await prisma.socialAccount.createMany({
    data: [
      {
        userId: alice.id,
        platform: "TELEGRAM",
        handle: SECRET_HANDLE_ALICE,
        syncEnabled: true,
      },
      {
        userId: bob.id,
        platform: "WHATSAPP",
        handle: SECRET_HANDLE_BOB,
        syncEnabled: false,
      },
    ],
  });

  return {
    baselines,
    fixtureIds: {
      aliceId: alice.id,
      bobId: bob.id,
      carolId: carol.id,
    } satisfies FixtureIds,
  };
}

/**
 * Removes exactly the fixture rows, in dependency order.
 *
 * The users are found by their marker email; the blocks hang off them. Blocks
 * are deleted **explicitly** rather than left to the user cascade, because a
 * cascade would empty the table anyway and the baseline assertion in `afterAll`
 * would then pass whether or not the fixtures were scoped correctly.
 */
async function cleanupBlockFixtures(prisma: PrismaClient) {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: FIXTURE_EMAIL_DOMAIN } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length === 0) return;

  await prisma.block.deleteMany({
    where: { OR: [{ blockerId: { in: userIds } }, { blockedId: { in: userIds } }] },
  });
  await prisma.socialAccount.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

/** The composite key as the UI renders it into test ids. */
function pair(blockerId: string, blockedId: string): string {
  return `${blockerId}-${blockedId}`;
}

test.describe("Phase C4 — Blocks", () => {
  let prisma: PrismaClient;
  let ids: SeedIds;
  let baselines: Baselines;
  let fixtureIds: FixtureIds;

  test.beforeAll(async () => {
    prisma = new PrismaClient();
    const users = await prisma.user.findMany({
      where: { email: { in: FIXTURE_EMAILS } },
      select: { id: true, email: true },
    });
    const byEmail = new Map(users.map((u) => [u.email, u.id]));
    ids = {
      superadmin: byEmail.get(ACCOUNTS.superadmin.email)!,
      analyst: byEmail.get(ACCOUNTS.analyst.email)!,
      support: byEmail.get(ACCOUNTS.support.email)!,
      moderator: byEmail.get(ACCOUNTS.moderator.email)!,
      contentManager: byEmail.get(ACCOUNTS.contentManager.email)!,
      inactive: byEmail.get(ACCOUNTS.inactive.email)!,
      victim: byEmail.get(ACCOUNTS.victim.email)!,
    };
    for (const [key, value] of Object.entries(ids)) {
      expect(value, `fixture account ${key} was not seeded`).toBeTruthy();
    }

    ({ baselines, fixtureIds } = await seedBlockFixtures(prisma));
  });

  test.afterAll(async () => {
    // Fixtures are test-only and must not survive the run. Both counts are
    // asserted back to their baseline, so a leak fails the suite instead of
    // quietly polluting the database for the next phase.
    await cleanupBlockFixtures(prisma);
    const after = await readBaselines(prisma);
    expect(after, "block fixtures leaked into the database").toEqual(baselines);
    await prisma.$disconnect();
  });

  /** Signs in and opens the Blocks screen, waiting for its heading. */
  async function openBlocks(page: import("@playwright/test").Page) {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openNav(page, "屏蔽");
    await expect(page).toHaveURL(/\/blocks$/);
    await expect(page.getByRole("heading", { name: "屏蔽", exact: true })).toBeVisible();
  }

  /** Applies the draft filters by pressing 筛选 and waits for the response. */
  async function applyFilters(page: import("@playwright/test").Page) {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/admin/blocks") && r.status() === 200),
      page.getByTestId("block-apply-filters").click(),
    ]);
  }

  // ------------------------------------------------------------------ 1
  test("1. the Blocks nav entry is visible to a SUPER_ADMIN", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await expect(page.getByRole("link", { name: "屏蔽", exact: true })).toBeVisible();
  });

  // ------------------------------------------------------------------ 2
  test("2. the nav entry sits in 用户与关系, directly after 交换", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    // A strict equality, not a subset: the exhaustive nav check is what catches
    // an unreviewed route appearing anywhere in the console. The sidebar was
    // regrouped this phase (总览 / 用户与关系 / 内容治理 / 风险与审计), so 「屏蔽」
    // moved up next to its sibling relationship screens; the assertion still
    // covers the whole list, which is what keeps it able to fail.
    const labels = await page.locator("aside nav a").allTextContents();
    expect(labels.map((s) => s.trim())).toEqual([
      "仪表盘",
      "用户",
      "连接",
      "交换",
      "屏蔽",
      "举报",
      "审核工作台",
      "风险中心",
      "审计日志",
    ]);
  });

  // ------------------------------------------------------------------ 3
  test("3. a MODERATOR, SUPPORT and CONTENT_MANAGER do not see the nav entry", async ({ page }) => {
    for (const email of [
      ACCOUNTS.moderator.email,
      ACCOUNTS.support.email,
      ACCOUNTS.contentManager.email,
    ]) {
      await loginAndLand(page, email);
      await expect(
        page.getByRole("link", { name: "屏蔽", exact: true }),
        `${email} must not be offered the blocks screen`,
      ).toHaveCount(0);
    }
  });

  // ------------------------------------------------------------------ 4
  test("4. an ANALYST can open the screen and read the same rows", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.analyst.email);
    await openNav(page, "屏蔽");
    await expect(page.getByRole("heading", { name: "屏蔽", exact: true })).toBeVisible();

    await expect(
      page.getByTestId(`block-row-${pair(fixtureIds.aliceId, fixtureIds.bobId)}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`block-row-${pair(fixtureIds.carolId, fixtureIds.aliceId)}`),
    ).toBeVisible();
  });

  // ------------------------------------------------------------------ 5
  test("5. the page opens with its title, note and column headers", async ({ page }) => {
    await openBlocks(page);

    await expect(page.getByRole("heading", { name: "屏蔽", exact: true })).toBeVisible();
    await expect(page.getByText("此页面只读，不产生审计记录。")).toBeVisible();

    // `exact: true` matters here: Playwright's `getByRole(name)` matches by
    // substring by default, so 「屏蔽方」 would also match 「被屏蔽方」 and the
    // assertion would pass while proving nothing about the first column.
    for (const header of ["屏蔽方", "方向", "被屏蔽方", "创建时间"]) {
      await expect(page.getByRole("columnheader", { name: header, exact: true })).toBeVisible();
    }
    // There is no 「屏蔽 ID」 column, because there is no such value.
    await expect(page.getByRole("columnheader", { name: "屏蔽 ID", exact: true })).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 6
  test("6. the row count equals an independent count from PostgreSQL", async ({ page }) => {
    await openBlocks(page);

    const dbCount = await prisma.block.count();
    expect(dbCount).toBe(3);
    await expect(page.locator("main table tbody tr")).toHaveCount(dbCount);
  });

  // ------------------------------------------------------------------ 7
  test("7. Alice → Bob is rendered with the direction it was stored with", async ({ page }) => {
    await openBlocks(page);

    const row = page.getByTestId(`block-row-${pair(fixtureIds.aliceId, fixtureIds.bobId)}`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId(`block-blocker-${pair(fixtureIds.aliceId, fixtureIds.bobId)}`)).toHaveText(
      ALICE_NICKNAME,
    );
    await expect(row.getByTestId(`block-blocked-${pair(fixtureIds.aliceId, fixtureIds.bobId)}`)).toHaveText(
      BOB_NICKNAME,
    );
  });

  // ------------------------------------------------------------------ 8
  test("8. Bob → Alice exists as its own row, not as a duplicate of the first", async ({ page }) => {
    await openBlocks(page);

    const row = page.getByTestId(`block-row-${pair(fixtureIds.bobId, fixtureIds.aliceId)}`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId(`block-blocker-${pair(fixtureIds.bobId, fixtureIds.aliceId)}`)).toHaveText(
      BOB_NICKNAME,
    );
    await expect(row.getByTestId(`block-blocked-${pair(fixtureIds.bobId, fixtureIds.aliceId)}`)).toHaveText(
      ALICE_NICKNAME,
    );
  });

  // ------------------------------------------------------------------ 9
  test("9. Carol → Alice is rendered, and Carol is the blocker", async ({ page }) => {
    await openBlocks(page);

    const row = page.getByTestId(`block-row-${pair(fixtureIds.carolId, fixtureIds.aliceId)}`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId(`block-blocker-${pair(fixtureIds.carolId, fixtureIds.aliceId)}`)).toHaveText(
      CAROL_NICKNAME,
    );
    await expect(row.getByTestId(`block-blocked-${pair(fixtureIds.carolId, fixtureIds.aliceId)}`)).toHaveText(
      ALICE_NICKNAME,
    );
  });

  // ------------------------------------------------------------------ 10
  test("10. the direction is never normalised: the reversed pair renders reversed", async ({ page }) => {
    await openBlocks(page);

    const forward = page.getByTestId(`block-row-${pair(fixtureIds.aliceId, fixtureIds.bobId)}`);
    const reverse = page.getByTestId(`block-row-${pair(fixtureIds.bobId, fixtureIds.aliceId)}`);

    // Both rows exist, and their first column is a *different* name. A screen
    // that sorted the two ids, or collapsed them into an unordered pair, could
    // not satisfy both assertions at once.
    await expect(forward).toBeVisible();
    await expect(reverse).toBeVisible();
    const forwardBlocker = await forward
      .getByTestId(`block-blocker-${pair(fixtureIds.aliceId, fixtureIds.bobId)}`)
      .innerText();
    const reverseBlocker = await reverse
      .getByTestId(`block-blocker-${pair(fixtureIds.bobId, fixtureIds.aliceId)}`)
      .innerText();
    expect(forwardBlocker).not.toBe(reverseBlocker);

    // And the explicit marker is present on every row.
    await expect(
      forward.getByTestId(`block-direction-${pair(fixtureIds.aliceId, fixtureIds.bobId)}`),
    ).toContainText("屏蔽");
  });

  // ------------------------------------------------------------------ 11
  test("11. user = Alice returns all three rows, because she is on both sides", async ({ page }) => {
    await openBlocks(page);

    // Independent SQL-side expectation first.
    const expected = await prisma.block.count({
      where: { OR: [{ blockerId: fixtureIds.aliceId }, { blockedId: fixtureIds.aliceId }] },
    });
    expect(expected).toBe(3);

    await page.getByTestId("block-user-filter").fill(ALICE_NICKNAME);
    await applyFilters(page);

    await expect(page.locator("main table tbody tr")).toHaveCount(expected);
    // A filter that only checked `blockerId` would return exactly one row here.
    await expect(
      page.getByTestId(`block-row-${pair(fixtureIds.aliceId, fixtureIds.bobId)}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`block-row-${pair(fixtureIds.bobId, fixtureIds.aliceId)}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`block-row-${pair(fixtureIds.carolId, fixtureIds.aliceId)}`),
    ).toBeVisible();
  });

  // ------------------------------------------------------------------ 12
  test("12. user = Bob returns two rows, and user = Carol returns one", async ({ page }) => {
    await openBlocks(page);

    await page.getByTestId("block-user-filter").fill(BOB_NICKNAME);
    await applyFilters(page);
    await expect(page.locator("main table tbody tr")).toHaveCount(2);

    await page.getByTestId("block-user-filter").fill(CAROL_NICKNAME);
    await applyFilters(page);
    await expect(page.locator("main table tbody tr")).toHaveCount(1);
  });

  // ------------------------------------------------------------------ 13
  test("13. a user search by exact id works and does not degrade into a substring match", async ({
    page,
  }) => {
    await openBlocks(page);

    await page.getByTestId("block-user-filter").fill(fixtureIds.aliceId);
    await applyFilters(page);
    await expect(page.locator("main table tbody tr")).toHaveCount(3);

    // A partial id is not a UUID, so it falls back to a nickname search and
    // matches nothing — it must not be treated as a LIKE over the id columns.
    await page.getByTestId("block-user-filter").fill(fixtureIds.aliceId.slice(0, 8));
    await applyFilters(page);
    await expect(page.locator("main table tbody tr")).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 14
  test("14. the date range filters on both bounds and includes the whole end day", async ({
    page,
  }) => {
    await openBlocks(page);

    // From 2026-03-02: drops the 03-01 row.
    await page.getByTestId("block-created-from").fill("2026-03-02");
    await applyFilters(page);
    await expect(page.locator("main table tbody tr")).toHaveCount(2);

    // Clear, then to 2026-03-02: the console widens the bound to 23:59:59.999Z,
    // so the 03-02 row is included rather than excluded by a midnight cutoff.
    await page.getByTestId("block-clear-filters").click();
    await page.getByTestId("block-created-to").fill("2026-03-02");
    await applyFilters(page);
    await expect(page.locator("main table tbody tr")).toHaveCount(2);
    await expect(
      page.getByTestId(`block-row-${pair(fixtureIds.bobId, fixtureIds.aliceId)}`),
    ).toBeVisible();
  });

  // ------------------------------------------------------------------ 15
  test("15. the sort control changes the order, oldest first", async ({ page }) => {
    await openBlocks(page);

    await page.getByTestId("block-sort").selectOption("createdAt_asc");
    await applyFilters(page);

    const first = page.locator("main table tbody tr").first();
    await expect(first).toHaveAttribute(
      "data-testid",
      `block-row-${pair(fixtureIds.aliceId, fixtureIds.bobId)}`,
    );
  });

  // ------------------------------------------------------------------ 16
  test("16. a sort key the API does not accept is refused rather than silently ignored", async ({
    page,
  }) => {
    await openBlocks(page);

    // The select only offers real keys, so the bad value is sent directly. The
    // API request context shares the browser's cookie jar, so this is the same
    // authenticated session the page is using.
    const response = await page.request.get(
      "http://localhost:4000/api/v1/admin/blocks?sort=createdAt%3BDROP",
    );
    expect(response.status()).toBe(400);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });

  // ------------------------------------------------------------------ 17
  test("17. an unmatched filter shows the empty state, not an empty table", async ({ page }) => {
    await openBlocks(page);

    await page.getByTestId("block-user-filter").fill("nobody-by-this-name");
    await applyFilters(page);

    await expect(page.getByTestId("blocks-empty")).toBeVisible();
    await expect(page.getByTestId("blocks-empty")).toContainText("没有符合当前筛选条件的屏蔽记录");
    await expect(page.locator("main table tbody tr")).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 18
  test("18. 清除筛选 restores the full list", async ({ page }) => {
    await openBlocks(page);

    await page.getByTestId("block-user-filter").fill(CAROL_NICKNAME);
    await applyFilters(page);
    await expect(page.locator("main table tbody tr")).toHaveCount(1);

    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/admin/blocks") && r.status() === 200),
      page.getByTestId("block-clear-filters").click(),
    ]);
    await expect(page.locator("main table tbody tr")).toHaveCount(3);
  });

  // ------------------------------------------------------------------ 19
  test("19. the list paginates, and page 2 is a real second page", async ({ page }) => {
    // Filler rows are created and removed inside this test, so no other
    // assertion in the file ever sees them. They must be *users* as well as
    // blocks, because `@@id([blockerId, blockedId])` allows only one row per
    // ordered pair — three users can produce at most six distinct blocks.
    const fillerUsers: string[] = [];
    try {
      for (let i = 0; i < PAGINATION_FILLER; i += 1) {
        const user = await prisma.user.create({
          data: {
            email: `filler${i}@${FIXTURE_EMAIL_DOMAIN}`,
            username: `e2eblkfiller${String(i).padStart(2, "0")}`,
            passwordHash: "not-a-real-login",
            nickname: `${BLOCK_FIXTURE_PREFIX}Filler${String(i).padStart(2, "0")}`,
            status: "ACTIVE",
          },
          select: { id: true },
        });
        fillerUsers.push(user.id);
        await prisma.block.create({
          data: {
            blockerId: fixtureIds.aliceId,
            blockedId: user.id,
            // Older than the three fixtures, so page 1 still leads with them.
            createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
          },
        });
      }

      const total = await prisma.block.count();
      expect(total).toBe(3 + PAGINATION_FILLER);

      await openBlocks(page);
      await expect(page.locator("main table tbody tr")).toHaveCount(DEFAULT_PAGE_SIZE);
      await expect(page.getByText(`第 1 / 2 页（共 ${total} 条）`)).toBeVisible();

      // Page 1 leads with the newest rows, which are the three fixtures.
      await expect(
        page.getByTestId(`block-row-${pair(fixtureIds.carolId, fixtureIds.aliceId)}`),
      ).toBeVisible();

      await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/admin/blocks") && r.url().includes("page=2") && r.status() === 200,
        ),
        page.getByRole("button", { name: "下一页" }).click(),
      ]);

      await expect(page.getByText(`第 2 / 2 页（共 ${total} 条）`)).toBeVisible();
      await expect(page.locator("main table tbody tr")).toHaveCount(total - DEFAULT_PAGE_SIZE);
      // The newest rows are on page 1, so none of the fixtures is on page 2.
      await expect(
        page.getByTestId(`block-row-${pair(fixtureIds.carolId, fixtureIds.aliceId)}`),
      ).toHaveCount(0);
    } finally {
      if (fillerUsers.length > 0) {
        await prisma.block.deleteMany({ where: { blockedId: { in: fillerUsers } } });
        await prisma.user.deleteMany({ where: { id: { in: fillerUsers } } });
      }
    }
  });

  // ------------------------------------------------------------------ 20
  test("20. 查看 opens the pair-addressed detail screen", async ({ page }) => {
    await openBlocks(page);

    await page
      .getByTestId(`block-row-${pair(fixtureIds.aliceId, fixtureIds.bobId)}`)
      .getByRole("link", { name: "查看" })
      .click();

    await expect(page).toHaveURL(
      new RegExp(`/blocks/${fixtureIds.aliceId}/${fixtureIds.bobId}$`),
    );
    await expect(page.getByRole("heading", { name: "屏蔽关系" })).toBeVisible();
  });

  // ------------------------------------------------------------------ 21
  test("21. the detail screen states the direction explicitly", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await page.goto(`/blocks/${fixtureIds.aliceId}/${fixtureIds.bobId}`);

    await expect(page.getByTestId("block-detail-blocker")).toHaveText(ALICE_NICKNAME);
    await expect(page.getByTestId("block-detail-blocked")).toHaveText(BOB_NICKNAME);
    await expect(page.getByTestId("block-detail-direction")).toContainText("屏蔽");

    // Both roles are labelled, so the pair cannot be read as unordered.
    await expect(page.getByText("屏蔽方", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("被屏蔽方", { exact: true }).first()).toBeVisible();
  });

  // ------------------------------------------------------------------ 22
  test("22. the reversed pair's detail screen is reversed too", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await page.goto(`/blocks/${fixtureIds.bobId}/${fixtureIds.aliceId}`);

    await expect(page.getByTestId("block-detail-blocker")).toHaveText(BOB_NICKNAME);
    await expect(page.getByTestId("block-detail-blocked")).toHaveText(ALICE_NICKNAME);
  });

  // ------------------------------------------------------------------ 23
  test("23. the detail screen shows both ids and the creation time", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await page.goto(`/blocks/${fixtureIds.aliceId}/${fixtureIds.bobId}`);

    const main = page.locator("main");
    await expect(main).toContainText(fixtureIds.aliceId);
    await expect(main).toContainText(fixtureIds.bobId);
    await expect(page.getByTestId("block-detail-created")).toBeVisible();
  });

  // ------------------------------------------------------------------ 24
  test("24. the handling history is honestly empty", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await page.goto(`/blocks/${fixtureIds.aliceId}/${fixtureIds.bobId}`);

    await expect(page.getByTestId("block-history-empty")).toBeVisible();
    await expect(page.getByTestId("block-history-empty")).toContainText("暂无处理记录");

    const blockAuditRows = await prisma.adminAuditLog.count({ where: { targetType: "BLOCK" } });
    expect(blockAuditRows).toBe(0);
  });

  // ------------------------------------------------------------------ 25
  test("25. an unknown pair is reported as 「屏蔽记录不存在」", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await page.goto(`/blocks/${fixtureIds.carolId}/${fixtureIds.bobId}`);

    await expect(page.getByTestId("block-detail-error")).toBeVisible();
    await expect(page.getByTestId("block-detail-error")).toContainText("屏蔽记录不存在");
    // Never a stack trace, a Prisma message or a connection string.
    const text = await page.getByTestId("block-detail-error").innerText();
    expect(text).not.toMatch(/prisma|stack|\bat \w|ECONNREFUSED|ETIMEDOUT|\bSQL\b|500/i);
  });

  // ------------------------------------------------------------------ 26
  test("26. a denied role is refused by the API, not merely hidden from the nav", async ({
    page,
  }) => {
    await loginAndLand(page, ACCOUNTS.moderator.email);
    await page.goto("/blocks");

    await expect(page.getByTestId("blocks-error")).toBeVisible();
    await expect(page.getByTestId("blocks-error")).toContainText("无权限访问");
    await expect(page.locator("main table tbody tr")).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 27
  test("27. a read writes no audit row", async ({ page }) => {
    const before = await prisma.adminAuditLog.count();

    await openBlocks(page);
    await page.goto(`/blocks/${fixtureIds.aliceId}/${fixtureIds.bobId}`);
    await expect(page.getByTestId("block-detail-created")).toBeVisible();

    const after = await prisma.adminAuditLog.count();
    expect(after, "a GET must not write an audit row").toBe(before);
  });

  // ------------------------------------------------------------------ 28
  test("28. the page is read-only — no mutation control exists", async ({ page }) => {
    await openBlocks(page);

    for (const label of ["解封", "取消屏蔽", "编辑", "删除", "恢复", "新建", "批量"]) {
      await expect(page.getByRole("button", { name: label })).toHaveCount(0);
      await expect(page.getByRole("link", { name: label })).toHaveCount(0);
    }

    // The only per-row action is 查看.
    const actions = page.getByTestId(
      `block-row-${pair(fixtureIds.aliceId, fixtureIds.bobId)}`,
    ).getByRole("link");
    await expect(actions).toHaveCount(1);
    await expect(actions).toHaveText("查看");

    // The detail screen has no mutation control either.
    await page.goto(`/blocks/${fixtureIds.aliceId}/${fixtureIds.bobId}`);
    await expect(page.getByTestId("block-detail-created")).toBeVisible();
    for (const label of ["解封", "编辑", "删除"]) {
      await expect(page.getByRole("button", { name: label })).toHaveCount(0);
    }
  });

  // ------------------------------------------------------------------ 29
  test("29. no handle, email or credential is sent by the API or rendered", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    // Capture the list response, so the claim is about what the server sends
    // rather than only about what the screen renders.
    const [listResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/admin/blocks") && r.status() === 200),
      page.goto("/blocks"),
    ]);
    const listBody = await listResponse.text();
    expectNoLeak(listBody, "the blocks list response");

    // And the detail response.
    const [detailResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/admin/blocks/") && r.status() === 200),
      page.goto(`/blocks/${fixtureIds.aliceId}/${fixtureIds.bobId}`),
    ]);
    const detailBody = await detailResponse.text();
    expectNoLeak(detailBody, "the block detail response");

    // Now the rendered pages. `handle` is checked against the visible text, not
    // against the raw HTML: Next.js serialises its component tree into inline
    // scripts, and a match there would be about the framework rather than about
    // what an operator can read. The secret literal is checked against both,
    // because a literal can only be there on purpose.
    await page.goto("/blocks");
    await expect(page.locator("main table tbody tr")).toHaveCount(3);
    const listText = await page.locator("main").innerText();
    const listHtml = await page.content();
    expect(listText).not.toContain("PW_BLOCK_SECRET_HANDLE");
    expect(listText.toLowerCase()).not.toContain("handle");
    expect(listHtml).not.toContain("PW_BLOCK_SECRET_HANDLE");
    expect(listText).not.toContain(FIXTURE_EMAIL_DOMAIN);

    await page.goto(`/blocks/${fixtureIds.aliceId}/${fixtureIds.bobId}`);
    await expect(page.getByTestId("block-detail-created")).toBeVisible();
    const detailText = await page.locator("main").innerText();
    const detailHtml = await page.content();
    expect(detailText).not.toContain("PW_BLOCK_SECRET_HANDLE");
    expect(detailText.toLowerCase()).not.toContain("handle");
    expect(detailHtml).not.toContain("PW_BLOCK_SECRET_HANDLE");
    expect(detailText).not.toContain(FIXTURE_EMAIL_DOMAIN);
  });

  // ------------------------------------------------------------------ 30
  test("30. the API response body carries no forbidden field name at any depth", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/admin/blocks") && r.status() === 200),
      page.goto("/blocks"),
    ]);
    const payload = (await response.json()) as { data?: unknown };

    // Recursive key scan over the real response, not a substring grep.
    const paths = keyPaths(payload);
    for (const field of [
      "passwordHash",
      "tokenHash",
      "refreshToken",
      "accessToken",
      "oauth",
      "secret",
      "clientSecret",
      "ip",
      "userAgent",
      "handle",
      "email",
    ]) {
      expect(
        paths.filter((path) => path.toLowerCase().endsWith(`.${field.toLowerCase()}`)),
        `the response exposes ${field}`,
      ).toEqual([]);
    }

    // The pair is what identifies a row — never a synthetic id.
    const first = (payload.data as { items: Array<Record<string, unknown>> }).items[0];
    expect(first).toHaveProperty("blockerId");
    expect(first).toHaveProperty("blockedId");
    expect(first).not.toHaveProperty("id");
  });

  // ------------------------------------------------------------------ 31
  test("31. the loading state appears before the data arrives", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    await page.route("**/admin/blocks*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.continue();
    });

    await page.goto("/blocks");
    await expect(page.getByTestId("blocks-loading")).toBeVisible();
    await expect(page.locator("main table tbody tr")).toHaveCount(3);
  });

  // ------------------------------------------------------------------ 32
  test("32. a failed request shows a retry affordance and never a raw error", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await page.route("**/admin/blocks*", (route) => route.abort());

    await page.goto("/blocks");
    const error = page.getByTestId("blocks-error");
    await expect(error).toBeVisible();

    const text = await error.innerText();
    expect(text).not.toMatch(/prisma|stack|\bat \w|ECONNREFUSED|ETIMEDOUT|\bSQL\b|500/i);
    await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
  });

  // ------------------------------------------------------------------ 33
  test("33. 重试 recovers without a full page reload", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await page.route("**/admin/blocks*", (route) => route.abort());
    await page.goto("/blocks");
    await expect(page.getByTestId("blocks-error")).toBeVisible();

    // Mark the document, then unblock the API and retry. If the retry were a
    // full navigation the marker would be gone.
    await page.evaluate(() => {
      (window as unknown as { __c4Marker: boolean }).__c4Marker = true;
    });
    await page.unroute("**/admin/blocks*");

    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/admin/blocks") && r.status() === 200),
      page.getByRole("button", { name: "重试" }).click(),
    ]);

    await expect(page.locator("main table tbody tr")).toHaveCount(3);
    const marker = await page.evaluate(
      () => (window as unknown as { __c4Marker?: boolean }).__c4Marker,
    );
    expect(marker, "the retry must not reload the document").toBe(true);
  });
});

/** Every key path in a nested value, e.g. `data.items[0].blocker.email`. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => keyPaths(entry, `${prefix}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
      `${prefix}.${key}`,
      ...keyPaths(child, `${prefix}.${key}`),
    ]);
  }
  return [];
}

/**
 * Scans a serialised API response for anything a blocks screen must never
 * carry.
 *
 * `handle` is checked as a bare substring rather than as `"handle"`, because a
 * leak that renamed the field would still be a disclosure and a key-name scan
 * would miss it. The fixture's own literals are checked separately so a failure
 * names the exact value that escaped.
 */
function expectNoLeak(body: string, label: string) {
  const lower = body.toLowerCase();
  for (const forbidden of [
    "handle",
    "passwordhash",
    "tokenhash",
    "refreshtoken",
    "accesstoken",
    "oauth",
    "clientsecret",
    "useragent",
  ]) {
    expect(lower, `${label} leaks ${forbidden}`).not.toContain(forbidden);
  }
  expect(body, `${label} leaks a social handle`).not.toContain("PW_BLOCK_SECRET_HANDLE");
  expect(body, `${label} leaks a fixture email`).not.toContain(FIXTURE_EMAIL_DOMAIN);
}
