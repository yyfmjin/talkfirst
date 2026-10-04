import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { ACCOUNTS, FIXTURE_EMAILS, type SeedIds } from "../fixtures/admin-roles";
import { loginAndLand, openNav } from "../fixtures/browser";

/**
 * Phase C3 — real browser behaviour tests for the Contact Exchange screens.
 *
 * ## What this suite is for
 *
 *   1. **Every number on screen equals a count taken independently from
 *      PostgreSQL.** Counted here through Prisma, deliberately *not* through the
 *      page's own endpoint, so the two sides are genuinely independent.
 *   2. **`platforms` is an array, and all of it is shown.** One fixture requests
 *      two platforms. A screen that rendered `platforms[0]` would look correct
 *      on a one-platform row and silently drop the rest, so the two-platform row
 *      is the one that carries the assertion.
 *   3. **`user` matches either side.** Alice is the *requester* of one fixture
 *      and the *receiver* of the other, so a search for her can only return both
 *      if the filter genuinely checks both columns.
 *   4. **The share direction is shown as stored.** `SharedSocialAccount` records
 *      `ownerId` granted → `viewerId` received. The fixtures contain a share in
 *      each direction, so a screen that normalised the pair — or reversed it —
 *      fails here. Reversing it would tell an operator the opposite of the truth.
 *   5. **A social handle never reaches the screen.** The fixture handles are
 *      recognisable literals (`PW_EXCHANGE_SECRET_HANDLE_…`). They are scanned
 *      for in the rendered text, in the raw page HTML, *and* in the API's own
 *      JSON response — because "the UI does not display it" is a weaker claim
 *      than "the API does not send it", and both are asserted.
 *   6. **`connectionId` has no foreign key.** One fixture points at a
 *      connection that does not exist. The detail screen must render the
 *      exchange in full and say 「连接记录不可用」 — never 500, never 404.
 *   7. **No chat history.** The conversation has a real `Message` row. The
 *      detail screen shows the conversation *id* and nothing else, and the
 *      message body must not appear anywhere on the page.
 *   8. **Read-only.** No mutation control, no audit row written, no full-page
 *      reload on refresh.
 *   9. **RBAC.** The nav entry and the page follow `exchanges:read`, held by
 *      SUPER_ADMIN and ANALYST only — the same holder set as `connections:read`.
 *
 * ## What this suite is NOT
 *
 * Not the security boundary. A hidden link is a convenience; the API's
 * `PermissionGuard` is the boundary, covered by
 * `apps/api/src/admin/admin-exchanges.spec.ts` and
 * `scripts/phaseA-rbac-verify.mjs`.
 */

/**
 * Fixture marker. Every row this suite writes carries it, so cleanup removes
 * exactly these and can never touch product data.
 *
 * `ExchangeRequest` has no free-text column to mark, so the marker lives on the
 * **users** the exchanges point at (their nickname prefix); cleanup then deletes
 * the exchanges by their participants' ids. This is the only honest way to scope
 * a fixture on a model whose own columns carry no test label.
 */
const EXCHANGE_FIXTURE_PREFIX = "PW_EXCH_UI_";

const ALICE_NICKNAME = `${EXCHANGE_FIXTURE_PREFIX}Alice`;
const BOB_NICKNAME = `${EXCHANGE_FIXTURE_PREFIX}Bob`;
const CAROL_NICKNAME = `${EXCHANGE_FIXTURE_PREFIX}Carol`;

const FIXTURE_EMAIL_DOMAIN = "pw-exch-ui.invalid";

/**
 * Recognisable literals a leaked `SocialAccount.handle` would carry.
 *
 * Not `@alice` or a plausible-looking username: if a leak ever happens the
 * failure message should name the exact field that leaked, and a scan for a
 * literal is only meaningful when the literal cannot occur by accident.
 */
const SECRET_HANDLE_ALICE = "PW_EXCHANGE_SECRET_HANDLE_alice_tg";
const SECRET_HANDLE_BOB = "PW_EXCHANGE_SECRET_HANDLE_bob_wa";

/** A recognisable chat body, so "the conversation was not loaded" is provable. */
const PRIVATE_CHAT_BODY = "PW_EXCH_UI_PRIVATE_CHAT_BODY";

/**
 * A well-formed UUID that is not in the database.
 *
 * `ExchangeRequest.connectionId` has no foreign key, so this is legal stored
 * data and the detail screen has to handle it rather than assume the connection
 * exists.
 */
const DANGLING_CONNECTION_ID = "deadbeef-0000-4000-8000-00000000c3c3";

/** Explicit instants, so ordering and the date filter are deterministic. */
const ACCEPTED_AT = new Date("2026-03-01T10:00:00.000Z");
const PENDING_AT = new Date("2026-03-02T10:00:00.000Z");

/** Baseline taken before the fixtures existed, so deltas are honest. */
type Baselines = {
  exchanges: number;
  shares: number;
  socialAccounts: number;
  /**
   * The conversation is counted too.
   *
   * `ExchangeRequest.conversationId` is a required column, so this suite has to
   * create a `Conversation` to satisfy the foreign key. That makes it the one
   * row a careless cleanup would leave orphaned — and an orphan conversation is
   * invisible to every other assertion here, because nothing points at it any
   * more. Counting it is what turns a silent leak into a failing test.
   */
  conversations: number;
};

type FixtureIds = {
  aliceId: string;
  bobId: string;
  carolId: string;
  conversationId: string;
  connectionId: string;
  /** Alice → Bob, ACCEPTED, TELEGRAM, connection exists. */
  acceptedExchangeId: string;
  /** Bob → Alice, PENDING, WHATSAPP + DISCORD, connection does not exist. */
  pendingExchangeId: string;
};

async function readBaselines(prisma: PrismaClient): Promise<Baselines> {
  const [exchanges, shares, socialAccounts, conversations] = await Promise.all([
    prisma.exchangeRequest.count(),
    prisma.sharedSocialAccount.count(),
    prisma.socialAccount.count(),
    prisma.conversation.count(),
  ]);
  return { exchanges, shares, socialAccounts, conversations };
}

/**
 * Creates the minimal real fixture the phase requires:
 *
 *   Alice → Bob   ACCEPTED  TELEGRAM              connection exists
 *   Bob   → Alice PENDING   WHATSAPP + DISCORD    connection does not exist
 *
 *   SharedSocialAccount  Alice → Bob   TELEGRAM
 *   SharedSocialAccount  Bob   → Alice WHATSAPP
 *
 * Both exchange directions exist so the `user` filter has to check both columns,
 * both share directions exist so the screen cannot normalise the pair, and the
 * second exchange requests two platforms so "the whole array" is testable.
 *
 * Idempotent: a crashed previous run must not leave rows behind.
 */
async function seedExchangeFixtures(prisma: PrismaClient) {
  await cleanupExchangeFixtures(prisma);

  const baselines = await readBaselines(prisma);

  const [alice, bob, carol] = await Promise.all([
    prisma.user.create({
      data: {
        email: `alice@${FIXTURE_EMAIL_DOMAIN}`,
        // P0-02 — required and unique. Prefixed per spec; see the same note in
        // `admin-connections.spec.ts`.
        username: "e2eexchalice",
        passwordHash: "not-a-real-login",
        nickname: ALICE_NICKNAME,
        status: "ACTIVE",
      },
      select: { id: true },
    }),
    prisma.user.create({
      data: {
        email: `bob@${FIXTURE_EMAIL_DOMAIN}`,
        username: "e2eexchbob",
        passwordHash: "not-a-real-login",
        nickname: BOB_NICKNAME,
        status: "ACTIVE",
      },
      select: { id: true },
    }),
    prisma.user.create({
      data: {
        email: `carol@${FIXTURE_EMAIL_DOMAIN}`,
        username: "e2eexchcarol",
        passwordHash: "not-a-real-login",
        nickname: CAROL_NICKNAME,
        status: "ACTIVE",
      },
      select: { id: true },
    }),
  ]);

  // A real conversation. `ExchangeRequest.conversationId` is a required column
  // with a real foreign key, so one has to exist. It also carries a real
  // `Message`, which is what makes "the chat was never loaded" a provable claim
  // rather than an absence of evidence.
  const conversation = await prisma.conversation.create({
    data: {},
    select: { id: true },
  });

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderId: alice.id,
      content: PRIVATE_CHAT_BODY,
      type: "TEXT",
    },
  });

  const connection = await prisma.connection.create({
    data: {
      userAId: [alice.id, bob.id].sort()[0],
      userBId: [alice.id, bob.id].sort()[1],
      status: "ACTIVE",
      conversationId: conversation.id,
    },
    select: { id: true },
  });

  const aliceTelegram = await prisma.socialAccount.create({
    data: {
      userId: alice.id,
      platform: "TELEGRAM",
      handle: SECRET_HANDLE_ALICE,
      syncEnabled: true,
    },
    select: { id: true },
  });

  const bobWhatsapp = await prisma.socialAccount.create({
    data: {
      userId: bob.id,
      platform: "WHATSAPP",
      handle: SECRET_HANDLE_BOB,
      syncEnabled: false,
    },
    select: { id: true },
  });

  const accepted = await prisma.exchangeRequest.create({
    data: {
      connectionId: connection.id,
      conversationId: conversation.id,
      requesterId: alice.id,
      receiverId: bob.id,
      platforms: ["TELEGRAM"],
      message: "Let's swap Telegram",
      status: "ACCEPTED",
      createdAt: ACCEPTED_AT,
    },
    select: { id: true },
  });

  const pending = await prisma.exchangeRequest.create({
    data: {
      connectionId: DANGLING_CONNECTION_ID,
      conversationId: conversation.id,
      requesterId: bob.id,
      receiverId: alice.id,
      platforms: ["WHATSAPP", "DISCORD"],
      message: null,
      status: "PENDING",
      createdAt: PENDING_AT,
    },
    select: { id: true },
  });

  // One share in each direction, attached to the ACCEPTED exchange. The owner
  // is the account's real owner in both cases, which is what makes the direction
  // meaningful rather than arbitrary.
  await prisma.sharedSocialAccount.createMany({
    data: [
      {
        ownerId: alice.id,
        viewerId: bob.id,
        platform: "TELEGRAM",
        socialAccountId: aliceTelegram.id,
        exchangeId: accepted.id,
        createdAt: ACCEPTED_AT,
      },
      {
        ownerId: bob.id,
        viewerId: alice.id,
        platform: "WHATSAPP",
        socialAccountId: bobWhatsapp.id,
        exchangeId: accepted.id,
        createdAt: PENDING_AT,
      },
    ],
  });

  return {
    baselines,
    fixtureIds: {
      aliceId: alice.id,
      bobId: bob.id,
      carolId: carol.id,
      conversationId: conversation.id,
      connectionId: connection.id,
      acceptedExchangeId: accepted.id,
      pendingExchangeId: pending.id,
    } satisfies FixtureIds,
  };
}

/**
 * Removes exactly the fixture rows, in dependency order.
 *
 * The users are found by their marker email; everything else hangs off them.
 * Exchanges are removed first because `SharedSocialAccount` cascades from
 * `ExchangeRequest`, and the conversation is removed last because
 * `Connection.conversationId` is `SetNull` rather than `Cascade` — deleting it
 * early would be legal but would leave the connection pointing at nothing.
 */
async function cleanupExchangeFixtures(prisma: PrismaClient) {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: FIXTURE_EMAIL_DOMAIN } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (userIds.length === 0) return;

  const exchanges = await prisma.exchangeRequest.findMany({
    where: { OR: [{ requesterId: { in: userIds } }, { receiverId: { in: userIds } }] },
    select: { id: true, conversationId: true },
  });
  const exchangeIds = exchanges.map((e) => e.id);

  await prisma.sharedSocialAccount.deleteMany({
    where: {
      OR: [
        { ownerId: { in: userIds } },
        { viewerId: { in: userIds } },
        { exchangeId: { in: exchangeIds } },
      ],
    },
  });
  await prisma.exchangeRequest.deleteMany({ where: { id: { in: exchangeIds } } });
  await prisma.socialAccount.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.connection.deleteMany({
    where: { OR: [{ userAId: { in: userIds } }, { userBId: { in: userIds } }] },
  });

  const conversationIds = [
    ...new Set(exchanges.map((e) => e.conversationId).filter((v): v is string => !!v)),
  ];
  await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });

  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

test.describe("Phase C3 — Contact Exchange", () => {
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

    ({ baselines, fixtureIds } = await seedExchangeFixtures(prisma));
  });

  test.afterAll(async () => {
    // Fixtures are test-only and must not survive the run. The three counts are
    // asserted back to their baseline, so a leak fails the suite instead of
    // quietly polluting the database for the next phase.
    await cleanupExchangeFixtures(prisma);
    const after = await readBaselines(prisma);
    expect(after, "exchange fixtures leaked into the database").toEqual(baselines);
    await prisma.$disconnect();
  });

  /** Signs in and opens the Exchanges screen, waiting for its heading. */
  async function openExchanges(page: import("@playwright/test").Page) {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await openNav(page, "交换");
    await expect(page).toHaveURL(/\/exchanges$/);
    await expect(page.getByRole("heading", { name: "交换" })).toBeVisible();
  }

  /** Applies the draft filters by pressing 筛选 and waits for the response. */
  async function applyFilters(page: import("@playwright/test").Page) {
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/admin/exchanges") && r.status() === 200),
      page.getByTestId("exchange-apply-filters").click(),
    ]);
  }

  // ------------------------------------------------------------------ 1
  test("1. the Exchanges nav entry is visible to a SUPER_ADMIN", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await expect(page.getByRole("link", { name: "交换", exact: true })).toBeVisible();
  });

  // ------------------------------------------------------------------ 2
  test("2. the nav entry sits between 连接 and 屏蔽", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    // The sidebar was regrouped this phase, so 「交换」 now sits between 「连接」
    // and 「屏蔽」 inside 用户与关系. The assertion stays a strict equality over
    // the whole list — a subset check would no longer be able to catch an
    // unauthorised route appearing anywhere.
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
        page.getByRole("link", { name: "交换", exact: true }),
        `${email} must not be offered the exchanges screen`,
      ).toHaveCount(0);
    }
  });

  // ------------------------------------------------------------------ 4
  test("4. an ANALYST can open the screen and read the same rows", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.analyst.email);
    await openNav(page, "交换");
    await expect(page.getByRole("heading", { name: "交换" })).toBeVisible();

    await expect(page.getByTestId(`exchange-row-${fixtureIds.acceptedExchangeId}`)).toBeVisible();
    await expect(page.getByTestId(`exchange-row-${fixtureIds.pendingExchangeId}`)).toBeVisible();
  });

  // ------------------------------------------------------------------ 5
  test("5. the screen renders the title and the read-only note", async ({ page }) => {
    await openExchanges(page);
    await expect(page.getByRole("heading", { name: "交换" })).toBeVisible();
    await expect(page.getByText("此页面只读，不产生审计记录。")).toBeVisible();
  });

  // ------------------------------------------------------------------ 6
  test("6. the total on screen equals an independent count from PostgreSQL", async ({ page }) => {
    await openExchanges(page);

    const dbCount = await prisma.exchangeRequest.count();
    const rows = page.locator("main table tbody tr");
    await expect(rows).toHaveCount(dbCount);

    // Both fixture rows are present, identified by their own ids rather than by
    // position — a row order change must not be able to fake this.
    await expect(page.getByTestId(`exchange-row-${fixtureIds.acceptedExchangeId}`)).toBeVisible();
    await expect(page.getByTestId(`exchange-row-${fixtureIds.pendingExchangeId}`)).toBeVisible();
  });

  // ------------------------------------------------------------------ 7
  test("7. each row shows requester, receiver, status and creation time", async ({ page }) => {
    await openExchanges(page);

    const accepted = page.getByTestId(`exchange-row-${fixtureIds.acceptedExchangeId}`);
    await expect(accepted).toContainText(ALICE_NICKNAME);
    await expect(accepted).toContainText(BOB_NICKNAME);
    await expect(accepted.getByTestId("exchange-status-ACCEPTED")).toBeVisible();

    const pending = page.getByTestId(`exchange-row-${fixtureIds.pendingExchangeId}`);
    await expect(pending).toContainText(BOB_NICKNAME);
    await expect(pending).toContainText(ALICE_NICKNAME);
    await expect(pending.getByTestId("exchange-status-PENDING")).toBeVisible();
  });

  // ------------------------------------------------------------------ 8
  test("8. a two-platform request shows both badges, not just the first", async ({ page }) => {
    await openExchanges(page);

    const pending = page.getByTestId(`exchange-row-${fixtureIds.pendingExchangeId}`);
    await expect(pending.getByTestId("exchange-platform-WHATSAPP")).toBeVisible();
    // This is the assertion that matters: rendering `platforms[0]` would pass a
    // one-platform row and silently drop DISCORD.
    await expect(pending.getByTestId("exchange-platform-DISCORD")).toBeVisible();

    const accepted = page.getByTestId(`exchange-row-${fixtureIds.acceptedExchangeId}`);
    await expect(accepted.getByTestId("exchange-platform-TELEGRAM")).toBeVisible();
    await expect(accepted.getByTestId("exchange-platform-DISCORD")).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 9
  test("9. the default order is newest first", async ({ page }) => {
    await openExchanges(page);

    const rows = page.locator("main table tbody tr");
    // The PENDING fixture was created later, so it leads.
    await expect(rows.first()).toHaveAttribute(
      "data-testid",
      `exchange-row-${fixtureIds.pendingExchangeId}`,
    );
  });

  // ------------------------------------------------------------------ 10
  test("10. status=ACCEPTED filters to that status only", async ({ page }) => {
    await openExchanges(page);

    await page.getByTestId("exchange-status-filter").selectOption("ACCEPTED");
    await applyFilters(page);

    await expect(page.getByTestId(`exchange-row-${fixtureIds.acceptedExchangeId}`)).toBeVisible();
    await expect(page.getByTestId(`exchange-row-${fixtureIds.pendingExchangeId}`)).toHaveCount(0);

    const dbCount = await prisma.exchangeRequest.count({ where: { status: "ACCEPTED" } });
    await expect(page.locator("main table tbody tr")).toHaveCount(dbCount);
  });

  // ------------------------------------------------------------------ 11
  test("11. status=PENDING filters to that status only", async ({ page }) => {
    await openExchanges(page);

    await page.getByTestId("exchange-status-filter").selectOption("PENDING");
    await applyFilters(page);

    await expect(page.getByTestId(`exchange-row-${fixtureIds.pendingExchangeId}`)).toBeVisible();
    await expect(page.getByTestId(`exchange-row-${fixtureIds.acceptedExchangeId}`)).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 12
  test("12. a status with no rows shows the honest empty state", async ({ page }) => {
    await openExchanges(page);

    await page.getByTestId("exchange-status-filter").selectOption("CANCELLED");
    await applyFilters(page);

    await expect(page.getByTestId("exchanges-empty")).toBeVisible();
    await expect(page.getByTestId("exchanges-empty")).toContainText("没有符合当前筛选条件的交换记录");
    await expect(page.locator("main table tbody tr")).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 13
  test("13. the platform filter uses array-contains, not equality", async ({ page }) => {
    await openExchanges(page);

    // DISCORD appears only as the *second* element of a two-platform array. An
    // equality filter would return nothing here.
    await page.getByTestId("exchange-platform-filter").selectOption("DISCORD");
    await applyFilters(page);

    await expect(page.getByTestId(`exchange-row-${fixtureIds.pendingExchangeId}`)).toBeVisible();
    await expect(page.getByTestId(`exchange-row-${fixtureIds.acceptedExchangeId}`)).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 14
  test("14. a platform with no rows shows the honest empty state", async ({ page }) => {
    await openExchanges(page);

    await page.getByTestId("exchange-platform-filter").selectOption("STEAM");
    await applyFilters(page);

    await expect(page.getByTestId("exchanges-empty")).toBeVisible();
  });

  // ------------------------------------------------------------------ 15
  test("15. a nickname search matches the requester side", async ({ page }) => {
    await openExchanges(page);

    await page.getByTestId("exchange-user-filter").fill(ALICE_NICKNAME);
    await applyFilters(page);

    await expect(page.getByTestId(`exchange-row-${fixtureIds.acceptedExchangeId}`)).toBeVisible();
    await expect(page.getByTestId(`exchange-row-${fixtureIds.pendingExchangeId}`)).toBeVisible();
  });

  // ------------------------------------------------------------------ 16
  test("16. the user filter matches either side, not one column", async ({ page }) => {
    await openExchanges(page);

    // Alice is the *requester* of one fixture and the *receiver* of the other.
    // A single-column filter returns 1; the correct answer is 2, and the
    // database agrees.
    await page.getByTestId("exchange-user-filter").fill(ALICE_NICKNAME);
    await applyFilters(page);

    const dbCount = await prisma.exchangeRequest.count({
      where: {
        OR: [{ requester: { nickname: ALICE_NICKNAME } }, { receiver: { nickname: ALICE_NICKNAME } }],
      },
    });
    expect(dbCount, "the fixture must put Alice on both sides").toBe(2);
    await expect(page.locator("main table tbody tr")).toHaveCount(dbCount);
  });

  // ------------------------------------------------------------------ 17
  test("17. a user who is party to nothing shows the honest empty state", async ({ page }) => {
    await openExchanges(page);

    await page.getByTestId("exchange-user-filter").fill(CAROL_NICKNAME);
    await applyFilters(page);

    await expect(page.getByTestId("exchanges-empty")).toBeVisible();
  });

  // ------------------------------------------------------------------ 18
  test("18. an exact user id is matched as an id, not widened into a text search", async ({
    page,
  }) => {
    await openExchanges(page);

    await page.getByTestId("exchange-user-filter").fill(fixtureIds.aliceId);
    await applyFilters(page);

    const dbCount = await prisma.exchangeRequest.count({
      where: { OR: [{ requesterId: fixtureIds.aliceId }, { receiverId: fixtureIds.aliceId }] },
    });
    expect(dbCount).toBe(2);
    await expect(page.locator("main table tbody tr")).toHaveCount(dbCount);
  });

  // ------------------------------------------------------------------ 19
  test("19. createdFrom includes the fixtures and createdTo can exclude them", async ({ page }) => {
    await openExchanges(page);

    await page.getByTestId("exchange-created-from").fill("2026-03-01");
    await applyFilters(page);
    await expect(page.getByTestId(`exchange-row-${fixtureIds.acceptedExchangeId}`)).toBeVisible();
    await expect(page.getByTestId(`exchange-row-${fixtureIds.pendingExchangeId}`)).toBeVisible();

    // The fixtures are 1–2 March, so an upper bound of 31 December 2020 excludes
    // both. This also pins the `T23:59:59.999Z` widening: a bare date would be
    // parsed as midnight and behave differently at the boundary.
    await page.getByTestId("exchange-created-from").fill("");
    await page.getByTestId("exchange-created-to").fill("2020-12-31");
    await applyFilters(page);
    await expect(page.getByTestId("exchanges-empty")).toBeVisible();
  });

  // ------------------------------------------------------------------ 20
  test("20. a date filter that includes the whole day is inclusive of it", async ({ page }) => {
    await openExchanges(page);

    // Both fixtures are on 2026-03-02 or earlier; `createdTo=2026-03-02` must
    // include the 10:00 UTC row created that day, which only holds if the value
    // is widened past midnight.
    await page.getByTestId("exchange-created-to").fill("2026-03-02");
    await applyFilters(page);

    await expect(page.getByTestId(`exchange-row-${fixtureIds.acceptedExchangeId}`)).toBeVisible();
    await expect(page.getByTestId(`exchange-row-${fixtureIds.pendingExchangeId}`)).toBeVisible();
  });

  // ------------------------------------------------------------------ 21
  test("21. 清除筛选 restores the unfiltered list", async ({ page }) => {
    await openExchanges(page);

    await page.getByTestId("exchange-status-filter").selectOption("CANCELLED");
    await applyFilters(page);
    await expect(page.getByTestId("exchanges-empty")).toBeVisible();

    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/admin/exchanges") && r.status() === 200),
      page.getByTestId("exchange-clear-filters").click(),
    ]);

    const dbCount = await prisma.exchangeRequest.count();
    await expect(page.locator("main table tbody tr")).toHaveCount(dbCount);
  });

  // ------------------------------------------------------------------ 22
  test("22. the loading state is shown while the request is in flight", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);

    // Held open deliberately, so the state is observed rather than raced.
    await page.route("**/admin/exchanges*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });

    await openNav(page, "交换");
    await expect(page.getByTestId("exchanges-loading")).toBeVisible();
    await expect(page.getByTestId("exchanges-loading")).toHaveCount(0, { timeout: 15_000 });
  });

  // ------------------------------------------------------------------ 23
  test("23. a failing request offers 重试 and leaks nothing technical", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await page.route("**/admin/exchanges*", (route) => route.abort());

    await openNav(page, "交换");
    const error = page.getByTestId("exchanges-error");
    await expect(error).toBeVisible();
    await expect(error.getByRole("button", { name: /重试/ })).toBeVisible();

    // No Prisma error, no SQL, no stack, no database URL.
    const text = await error.innerText();
    for (const leak of ["Prisma", "prisma", "SELECT", "postgresql://", "at Object.", "stack"]) {
      expect(text, `the error state leaks ${leak}`).not.toContain(leak);
    }
  });

  // ------------------------------------------------------------------ 24
  test("24. retry after a failure recovers the list without a page reload", async ({ page }) => {
    await loginAndLand(page, ACCOUNTS.superadmin.email);
    await page.route("**/admin/exchanges*", (route) => route.abort());
    await openNav(page, "交换");
    await expect(page.getByTestId("exchanges-error")).toBeVisible();

    let navigated = false;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigated = true;
    });

    await page.unroute("**/admin/exchanges*");
    await page.getByTestId("exchanges-error").getByRole("button", { name: /重试/ }).click();

    await expect(page.getByTestId("exchanges-error")).toHaveCount(0);
    await expect(page.getByTestId(`exchange-row-${fixtureIds.acceptedExchangeId}`)).toBeVisible();
    expect(navigated, "retrying must not reload the whole page").toBe(false);
  });

  // ------------------------------------------------------------------ 25
  test("25. 查看 navigates to the detail screen for that exchange", async ({ page }) => {
    await openExchanges(page);

    await page
      .getByTestId(`exchange-row-${fixtureIds.acceptedExchangeId}`)
      .getByRole("link", { name: "查看" })
      .click();

    await expect(page).toHaveURL(
      new RegExp(`/exchanges/${fixtureIds.acceptedExchangeId}$`),
    );
    await expect(page.getByRole("heading", { name: "交换详情" })).toBeVisible();
  });

  // ------------------------------------------------------------------ 26
  test("26. the detail screen shows the exchange's own data", async ({ page }) => {
    await openExchanges(page);
    await page.goto(`/exchanges/${fixtureIds.acceptedExchangeId}`);

    await expect(page.getByTestId("exchange-detail-status")).toHaveText("已接受");
    await expect(page.getByTestId("exchange-detail-platform-TELEGRAM")).toBeVisible();
    await expect(page.getByTestId("exchange-detail-message")).toContainText(
      "Let's swap Telegram",
    );
    await expect(page.getByRole("heading", { name: "请求方" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "接收方" })).toBeVisible();
    // Alice asked, Bob received — the sides are named, not interchangeable.
    await expect(page.getByText(ALICE_NICKNAME).first()).toBeVisible();
    await expect(page.getByText(BOB_NICKNAME).first()).toBeVisible();
  });

  // ------------------------------------------------------------------ 27
  test("27. a null message is stated as 无留言, not left blank", async ({ page }) => {
    await openExchanges(page);
    await page.goto(`/exchanges/${fixtureIds.pendingExchangeId}`);

    await expect(page.getByTestId("exchange-detail-message")).toContainText("无留言");
  });

  // ------------------------------------------------------------------ 28
  test("28. both platform badges render on the detail screen", async ({ page }) => {
    await openExchanges(page);
    await page.goto(`/exchanges/${fixtureIds.pendingExchangeId}`);

    await expect(page.getByTestId("exchange-detail-platform-WHATSAPP")).toBeVisible();
    await expect(page.getByTestId("exchange-detail-platform-DISCORD")).toBeVisible();
  });

  // ------------------------------------------------------------------ 29
  test("29. the share direction is shown as stored — owner → viewer", async ({ page }) => {
    await openExchanges(page);
    await page.goto(`/exchanges/${fixtureIds.acceptedExchangeId}`);

    const telegram = page.getByTestId("exchange-share-TELEGRAM");
    const whatsapp = page.getByTestId("exchange-share-WHATSAPP");
    await expect(telegram).toBeVisible();
    await expect(whatsapp).toBeVisible();

    // Alice granted Bob her Telegram; Bob granted Alice his WhatsApp. Reversing
    // either would tell an operator the opposite of the truth.
    await expect(telegram).toContainText(`${ALICE_NICKNAME} → ${BOB_NICKNAME}`);
    await expect(whatsapp).toContainText(`${BOB_NICKNAME} → ${ALICE_NICKNAME}`);
  });

  // ------------------------------------------------------------------ 30
  test("30. no social handle appears in the UI, and none is sent by the API", async ({ page }) => {
    await openExchanges(page);

    // Capture the API's own response, so the claim is about what the server
    // sends rather than only about what the screen renders.
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/admin/exchanges/") && r.status() === 200),
      page.goto(`/exchanges/${fixtureIds.acceptedExchangeId}`),
    ]);
    const body = await response.text();

    for (const secret of [SECRET_HANDLE_ALICE, SECRET_HANDLE_BOB]) {
      expect(body, "the API must not send a social handle").not.toContain(secret);
    }
    expect(body).not.toContain("PW_EXCHANGE_SECRET_HANDLE");
    // The field name is absent too, so there is nothing to leak later.
    expect(body.toLowerCase()).not.toContain('"handle"');
    // No credential either.
    for (const forbidden of ["passwordHash", "tokenHash", "oauth", "secret"]) {
      expect(body.toLowerCase(), `the API leaks ${forbidden}`).not.toContain(
        forbidden.toLowerCase(),
      );
    }

    // And the rendered page. `handle` is checked against the visible text, not
    // against the raw HTML: Next.js serialises its own component tree into
    // inline scripts, and a match there would be about the framework rather than
    // about what an operator can read. The secret literal is checked against
    // both, because a literal can only be there on purpose.
    await expect(page.getByTestId("exchange-shares")).toBeVisible();
    const text = await page.locator("main").innerText();
    const html = await page.content();
    expect(text).not.toContain("PW_EXCHANGE_SECRET_HANDLE");
    expect(text.toLowerCase()).not.toContain("handle");
    expect(html).not.toContain("PW_EXCHANGE_SECRET_HANDLE");
  });

  // ------------------------------------------------------------------ 31
  test("31. the connection is shown when it exists", async ({ page }) => {
    await openExchanges(page);
    await page.goto(`/exchanges/${fixtureIds.acceptedExchangeId}`);

    const context = page.getByTestId("exchange-connection");
    await expect(context).toBeVisible();
    await expect(context).toContainText(fixtureIds.connectionId);
    await expect(context).toContainText("已连接");
    await expect(page.getByTestId("exchange-connection-missing")).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 32
  test("32. a dangling connectionId is stated, not turned into an error", async ({ page }) => {
    await openExchanges(page);
    await page.goto(`/exchanges/${fixtureIds.pendingExchangeId}`);

    // The exchange itself is fully readable — an operator inspecting it must not
    // be blocked because a link is stale.
    await expect(page.getByTestId("exchange-detail-status")).toHaveText("待响应");
    await expect(page.getByTestId("exchange-connection-missing")).toBeVisible();
    await expect(page.getByTestId("exchange-connection-missing")).toContainText(
      "连接记录不可用",
    );
    await expect(page.getByTestId("exchange-connection")).toHaveCount(0);
    await expect(page.getByTestId("exchange-detail-error")).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 33
  test("33. the conversation is an id only, and no chat history is loaded", async ({ page }) => {
    await openExchanges(page);
    await page.goto(`/exchanges/${fixtureIds.acceptedExchangeId}`);

    await expect(page.getByTestId("exchange-detail-conversation")).toHaveText(
      fixtureIds.conversationId,
    );

    // The conversation has a real Message row. Its body must not appear — the
    // participants' private chat is not this screen's subject.
    const html = await page.content();
    expect(html).not.toContain(PRIVATE_CHAT_BODY);
    await expect(page.getByText(PRIVATE_CHAT_BODY)).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 34
  test("34. the history panel states that there is none", async ({ page }) => {
    await openExchanges(page);
    await page.goto(`/exchanges/${fixtureIds.acceptedExchangeId}`);

    // No admin action ever targets an exchange, so an empty list is the honest
    // answer rather than a fabricated one.
    await expect(page.getByTestId("exchange-history-empty")).toBeVisible();
    await expect(page.getByTestId("exchange-history-empty")).toContainText("暂无处理记录");
  });

  // ------------------------------------------------------------------ 35
  test("35. an unknown exchange id shows 交换记录不存在, not a blank screen", async ({ page }) => {
    await openExchanges(page);
    await page.goto("/exchanges/00000000-0000-4000-8000-000000000000");

    const error = page.getByTestId("exchange-detail-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("交换记录不存在");
    await expect(page.getByTestId("exchange-detail-loading")).toHaveCount(0);
  });

  // ------------------------------------------------------------------ 36
  test("36. 返回列表 goes back to the list", async ({ page }) => {
    await openExchanges(page);
    await page.goto(`/exchanges/${fixtureIds.acceptedExchangeId}`);

    await page.getByRole("link", { name: "返回列表" }).click();
    await expect(page).toHaveURL(/\/exchanges$/);
    await expect(page.getByRole("heading", { name: "交换" })).toBeVisible();
  });

  // ------------------------------------------------------------------ 37
  test("37. viewing and filtering writes no audit row", async ({ page }) => {
    const before = await prisma.adminAuditLog.count();

    await openExchanges(page);
    await page.getByTestId("exchange-status-filter").selectOption("ACCEPTED");
    await applyFilters(page);
    await page.goto(`/exchanges/${fixtureIds.acceptedExchangeId}`);
    await expect(page.getByTestId("exchange-detail-status")).toBeVisible();

    const after = await prisma.adminAuditLog.count();
    expect(after, "reading an exchange must not write an audit row").toBe(before);
  });

  // ------------------------------------------------------------------ 38
  test("38. the screens ship no mutation control", async ({ page }) => {
    await openExchanges(page);

    for (const label of ["取消", "通过", "拒绝", "删除", "保存", "创建"]) {
      await expect(
        page.getByRole("button", { name: label, exact: true }),
        `the list must not offer ${label}`,
      ).toHaveCount(0);
    }

    await page.goto(`/exchanges/${fixtureIds.acceptedExchangeId}`);
    await expect(page.getByTestId("exchange-detail-status")).toBeVisible();
    for (const label of ["取消", "通过", "拒绝", "删除", "保存"]) {
      await expect(
        page.getByRole("button", { name: label, exact: true }),
        `the detail must not offer ${label}`,
      ).toHaveCount(0);
    }
  });

  // ------------------------------------------------------------------ 39
  test("39. the list paginates when there is more than one page", async ({ page }) => {
    // The pager only appears above one page, so this test creates the rows it
    // needs and removes them again in the same test. Nothing is left behind for
    // the `afterAll` baseline check to trip over.
    const extras = await prisma.exchangeRequest.createManyAndReturn({
      data: Array.from({ length: 21 }, (_, index) => ({
        connectionId: fixtureIds.connectionId,
        conversationId: fixtureIds.conversationId,
        requesterId: fixtureIds.aliceId,
        receiverId: fixtureIds.bobId,
        platforms: ["TELEGRAM"],
        status: "PENDING" as const,
        createdAt: new Date(Date.UTC(2026, 2, 3, 0, index)),
      })),
      select: { id: true },
    });
    const extraIds = extras.map((e) => e.id);

    try {
      await openExchanges(page);

      const dbCount = await prisma.exchangeRequest.count();
      expect(dbCount).toBeGreaterThan(20);

      await expect(page.getByText(`共 ${dbCount} 条`)).toBeVisible();
      const firstPageRows = await page.locator("main table tbody tr").count();
      expect(firstPageRows).toBe(20);

      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/admin/exchanges") && r.status() === 200),
        page.getByRole("button", { name: "下一页" }).click(),
      ]);

      const secondPageRows = await page.locator("main table tbody tr").count();
      expect(secondPageRows).toBe(dbCount - 20);
      await expect(page.getByText(`第 2 / `)).toBeVisible();
    } finally {
      await prisma.exchangeRequest.deleteMany({ where: { id: { in: extraIds } } });
    }
  });

  // ------------------------------------------------------------------ 40
  test("40. the list is filtered in the database, not in the browser", async ({ page }) => {
    await openExchanges(page);

    // The status filter must reach the API as a query parameter. If the page
    // filtered a fetched page in JavaScript, a total would drift from the rows
    // the moment there were more rows than one page.
    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().includes("/admin/exchanges")),
      (async () => {
        await page.getByTestId("exchange-status-filter").selectOption("ACCEPTED");
        await page.getByTestId("exchange-apply-filters").click();
      })(),
    ]);

    expect(request.url()).toContain("status=ACCEPTED");
  });
});
