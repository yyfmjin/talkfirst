import { ExchangeService } from "./exchange.service";
import type { SocialPlatform } from "@prisma/client";

/**
 * P0-1 regression: Contact Exchange social-account cross-conversation leak.
 *
 * The old implementation flipped the account-global `SocialAccount.visibility`
 * flag to EXCHANGE_ONLY and then read handles by platform alone. Any accepted
 * exchange therefore made an account readable from *every* conversation, so a
 * third user who never exchanged anything could see it.
 *
 * These tests pin the per-pair `SharedSocialAccount` grant model in place.
 */

type Account = {
  id: string;
  userId: string;
  platform: SocialPlatform;
  handle: string;
  visibility: string;
};

type Grant = {
  ownerId: string;
  viewerId: string;
  platform: SocialPlatform;
  socialAccountId: string;
  exchangeId: string;
};

/**
 * Minimal in-memory stand-in for the tables touched by ExchangeService.
 * `sharedSocialAccount.findMany` honours both the OR-pair predicate and the
 * optional platform narrowing, exactly like the real query.
 */
function makePrisma(opts: {
  accounts: Account[];
  conversations: Array<{
    id: string;
    members: string[];
    connectionId: string;
    connectionStatus: string;
  }>;
  exchanges: Array<Record<string, unknown>>;
  grants?: Grant[];
  blocked?: boolean;
}) {
  const grants: Grant[] = [...(opts.grants ?? [])];

  const conversationStore = opts.conversations.map((c) => ({
    id: c.id,
    connection: { id: c.connectionId, status: c.connectionStatus },
    members: c.members.map((userId) => ({
      userId,
      user: { id: userId, nickname: `nick-${userId}`, avatarUrl: null, countryCode: null },
    })),
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    _grants: grants,
    conversation: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        return conversationStore.find((c) => c.id === where.id) ?? null;
      }),
    },
    block: {
      findFirst: jest.fn().mockResolvedValue(opts.blocked ? { id: "block-1" } : null),
    },
    socialAccount: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { id?: { in: string[] }; userId?: string; platform?: { in: SocialPlatform[] } };
        }) => {
          const matched = opts.accounts.filter((a) => {
            if (where.id && !where.id.in.includes(a.id)) return false;
            if (where.userId && a.userId !== where.userId) return false;
            if (where.platform && !where.platform.in.includes(a.platform)) return false;
            return true;
          });
          // Mirror `include: { user: { select: { id, nickname } } }`.
          return matched.map((a) => ({
            ...a,
            user: { id: a.userId, nickname: `nick-${a.userId}` },
          }));
        },
      ),
    },
    exchangeRequest: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        return opts.exchanges.find((e) => e.id === where.id) ?? null;
      }),
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return opts.exchanges.filter((e) => {
          if (where.status && e.status !== where.status) return false;
          if (where.conversationId && e.conversationId !== where.conversationId) return false;
          return true;
        });
      }),
      update: jest.fn(),
    },
    sharedSocialAccount: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { OR: Array<{ ownerId: string; viewerId: string }>; platform?: { in: SocialPlatform[] } };
        }) => {
          const pairs = where.OR.map((o) => `${o.ownerId}->${o.viewerId}`);
          return grants.filter((g) => {
            if (!pairs.includes(`${g.ownerId}->${g.viewerId}`)) return false;
            if (where.platform && !where.platform.in.includes(g.platform)) return false;
            return true;
          });
        },
      ),
      createMany: jest.fn(
        async ({ data }: { data: Grant[] }) => {
          let count = 0;
          for (const row of data) {
            const dup = grants.some(
              (g) =>
                g.ownerId === row.ownerId &&
                g.viewerId === row.viewerId &&
                g.platform === row.platform,
            );
            if (dup) continue;
            grants.push(row);
            count += 1;
          }
          return { count };
        },
      ),
    },
    message: { create: jest.fn().mockResolvedValue({ id: "sys-msg" }) },
    notification: { create: jest.fn().mockResolvedValue({ id: "notif-1" }) },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };

  return prisma;
}

function account(userId: string, platform: SocialPlatform, handle: string): Account {
  return {
    id: `acct-${userId}-${platform}`,
    userId,
    platform,
    handle,
    visibility: "PRIVATE",
  };
}

const PLATFORMS: SocialPlatform[] = ["INSTAGRAM", "TELEGRAM"];

/** A 5-message conversation so the exchange is eligible. */
function conversationRow(id: string, a: string, b: string) {
  return { id, members: [a, b], connectionId: `conn-${id}`, connectionStatus: "ACTIVE" };
}

function acceptedExchange(id: string, requesterId: string, receiverId: string, conversationId: string) {
  return {
    id,
    connectionId: `conn-${conversationId}`,
    conversationId,
    requesterId,
    receiverId,
    platforms: PLATFORMS,
    message: null,
    status: "ACCEPTED",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    requester: { id: requesterId, nickname: `nick-${requesterId}`, avatarUrl: null, countryCode: null },
    receiver: { id: receiverId, nickname: `nick-${receiverId}`, avatarUrl: null, countryCode: null },
  };
}

describe("P0-1 ExchangeService cross-conversation privacy", () => {
  it("A. A<->B 已交换、A<->C 未交换 -> B 能看到 A 被授权的平台", async () => {
    // Two independent conversations, all three users have accounts.
    const prisma = makePrisma({
      accounts: [
        account("A", "INSTAGRAM", "@a.insta"),
        account("A", "TELEGRAM", "@a.tg"),
        account("B", "INSTAGRAM", "@b.insta"),
        account("B", "TELEGRAM", "@b.tg"),
        account("C", "INSTAGRAM", "@c.insta"),
        account("C", "TELEGRAM", "@c.tg"),
      ],
      conversations: [conversationRow("convAB", "A", "B"), conversationRow("convAC", "A", "C")],
      exchanges: [
        acceptedExchange("ex-AB", "A", "B", "convAB"),
        // A<->C accepted too, but on a *different* set of platforms is not the
        // point here; the point is the grant set is per-pair.
      ],
      grants: [
        // A<->B exchange produced exactly these four grants.
        { ownerId: "A", viewerId: "B", platform: "INSTAGRAM", socialAccountId: "acct-A-INSTAGRAM", exchangeId: "ex-AB" },
        { ownerId: "A", viewerId: "B", platform: "TELEGRAM", socialAccountId: "acct-A-TELEGRAM", exchangeId: "ex-AB" },
        { ownerId: "B", viewerId: "A", platform: "INSTAGRAM", socialAccountId: "acct-B-INSTAGRAM", exchangeId: "ex-AB" },
        { ownerId: "B", viewerId: "A", platform: "TELEGRAM", socialAccountId: "acct-B-TELEGRAM", exchangeId: "ex-AB" },
      ],
    });

    const service = new ExchangeService(prisma as never);

    // B looks at the A<->B conversation: must see A's two handles.
    const asB = await service.sharedContacts("B", "convAB");
    expect(asB.exchanged).toBe(true);
    const bSees = asB.contacts.map((c) => `${c.userId}:${c.platform}:${c.handle}`).sort();
    expect(bSees).toEqual([
      "A:INSTAGRAM:@a.insta",
      "A:TELEGRAM:@a.tg",
    ]);
  });

  it("B. A<->B 已交换、A<->C 未交换 -> C 不能看到 A 对 B 授权的平台", async () => {
    const prisma = makePrisma({
      accounts: [
        account("A", "INSTAGRAM", "@a.insta"),
        account("A", "TELEGRAM", "@a.tg"),
        account("B", "INSTAGRAM", "@b.insta"),
        account("B", "TELEGRAM", "@b.tg"),
        account("C", "INSTAGRAM", "@c.insta"),
        account("C", "TELEGRAM", "@c.tg"),
      ],
      conversations: [conversationRow("convAB", "A", "B"), conversationRow("convAC", "A", "C")],
      exchanges: [acceptedExchange("ex-AB", "A", "B", "convAB")],
      // Only the A<->B grants exist. Nothing grants C anything.
      grants: [
        { ownerId: "A", viewerId: "B", platform: "INSTAGRAM", socialAccountId: "acct-A-INSTAGRAM", exchangeId: "ex-AB" },
        { ownerId: "A", viewerId: "B", platform: "TELEGRAM", socialAccountId: "acct-A-TELEGRAM", exchangeId: "ex-AB" },
        { ownerId: "B", viewerId: "A", platform: "INSTAGRAM", socialAccountId: "acct-B-INSTAGRAM", exchangeId: "ex-AB" },
        { ownerId: "B", viewerId: "A", platform: "TELEGRAM", socialAccountId: "acct-B-TELEGRAM", exchangeId: "ex-AB" },
      ],
    });

    const service = new ExchangeService(prisma as never);

    // C is in the A<->C conversation, which has no ACCEPTED exchange at all.
    const asC = await service.sharedContacts("C", "convAC");
    expect(asC.exchanged).toBe(false);
    expect(asC.contacts).toEqual([]);

    // And C cannot even reach the A<->B conversation: C is not a member, so the
    // membership check rejects before any handle could be read.
    await expect(service.sharedContacts("C", "convAB")).rejects.toMatchObject({
      response: { error: { code: "CONVERSATION_NOT_FOUND" } },
    });
  });

  it("C. 反向测试：B<->C 交换后，A 仍然拿不到 B 没有授权给 A 的账号", async () => {
    // B authorizes only DISCORD to C (a platform A never received).
    const prisma = makePrisma({
      accounts: [
        account("A", "INSTAGRAM", "@a.insta"),
        account("B", "INSTAGRAM", "@b.insta"),
        account("B", "DISCORD", "@b.discord"),
        account("C", "DISCORD", "@c.discord"),
      ],
      conversations: [conversationRow("convAB", "A", "B"), conversationRow("convBC", "B", "C")],
      exchanges: [
        // A<->B exchanged only INSTAGRAM.
        {
          ...acceptedExchange("ex-AB", "A", "B", "convAB"),
          platforms: ["INSTAGRAM"],
        },
        // B<->C exchanged only DISCORD.
        {
          ...acceptedExchange("ex-BC", "B", "C", "convBC"),
          platforms: ["DISCORD"],
        },
      ],
      grants: [
        { ownerId: "A", viewerId: "B", platform: "INSTAGRAM", socialAccountId: "acct-A-INSTAGRAM", exchangeId: "ex-AB" },
        { ownerId: "B", viewerId: "A", platform: "INSTAGRAM", socialAccountId: "acct-B-INSTAGRAM", exchangeId: "ex-AB" },
        { ownerId: "B", viewerId: "C", platform: "DISCORD", socialAccountId: "acct-B-DISCORD", exchangeId: "ex-BC" },
        { ownerId: "C", viewerId: "B", platform: "DISCORD", socialAccountId: "acct-C-DISCORD", exchangeId: "ex-BC" },
      ],
    });

    const service = new ExchangeService(prisma as never);

    const asA = await service.sharedContacts("A", "convAB");
    const handles = asA.contacts.map((c) => c.handle);
    expect(handles).toEqual(["@b.insta"]);
    // B's DISCORD handle — authorized to C only — must NOT leak to A.
    expect(handles).not.toContain("@b.discord");
  });

  it("D. 两会话交叉授权：第三人绝不会因他人交换而获得任何账号", async () => {
    const prisma = makePrisma({
      accounts: [
        account("A", "INSTAGRAM", "@a.insta"),
        account("A", "TELEGRAM", "@a.tg"),
        account("B", "INSTAGRAM", "@b.insta"),
        account("B", "TELEGRAM", "@b.tg"),
        account("C", "INSTAGRAM", "@c.insta"),
        account("C", "TELEGRAM", "@c.tg"),
      ],
      conversations: [
        conversationRow("convAB", "A", "B"),
        conversationRow("convAC", "A", "C"),
        conversationRow("convBC", "B", "C"),
      ],
      exchanges: [
        acceptedExchange("ex-AB", "A", "B", "convAB"),
        acceptedExchange("ex-AC", "A", "C", "convAC"),
      ],
      grants: [
        { ownerId: "A", viewerId: "B", platform: "INSTAGRAM", socialAccountId: "acct-A-INSTAGRAM", exchangeId: "ex-AB" },
        { ownerId: "A", viewerId: "B", platform: "TELEGRAM", socialAccountId: "acct-A-TELEGRAM", exchangeId: "ex-AB" },
        { ownerId: "B", viewerId: "A", platform: "INSTAGRAM", socialAccountId: "acct-B-INSTAGRAM", exchangeId: "ex-AB" },
        { ownerId: "B", viewerId: "A", platform: "TELEGRAM", socialAccountId: "acct-B-TELEGRAM", exchangeId: "ex-AB" },
        { ownerId: "A", viewerId: "C", platform: "INSTAGRAM", socialAccountId: "acct-A-INSTAGRAM", exchangeId: "ex-AC" },
        { ownerId: "A", viewerId: "C", platform: "TELEGRAM", socialAccountId: "acct-A-TELEGRAM", exchangeId: "ex-AC" },
        { ownerId: "C", viewerId: "A", platform: "INSTAGRAM", socialAccountId: "acct-C-INSTAGRAM", exchangeId: "ex-AC" },
        { ownerId: "C", viewerId: "A", platform: "TELEGRAM", socialAccountId: "acct-C-TELEGRAM", exchangeId: "ex-AC" },
      ],
    });

    const service = new ExchangeService(prisma as never);

    // B's view: only A's handles. Never C's.
    const asB = await service.sharedContacts("B", "convAB");
    const bHandles = asB.contacts.map((c) => c.handle).sort();
    expect(bHandles).toEqual(["@a.insta", "@a.tg"]);
    expect(bHandles).not.toContain("@c.insta");

    // C's view: only A's handles. Never B's.
    const asC = await service.sharedContacts("C", "convAC");
    const cHandles = asC.contacts.map((c) => c.handle).sort();
    expect(cHandles).toEqual(["@a.insta", "@a.tg"]);
    expect(cHandles).not.toContain("@b.insta");

    // B and C have no accepted exchange in convBC, so neither sees the other.
    const asBInBC = await service.sharedContacts("B", "convBC");
    expect(asBInBC.exchanged).toBe(false);
    expect(asBInBC.contacts).toEqual([]);
  });

  it("E. Accept 只为本次交换的双方建立授权，且不依赖全局 visibility", async () => {
    const prisma = makePrisma({
      accounts: [
        account("A", "INSTAGRAM", "@a.insta"),
        account("A", "TELEGRAM", "@a.tg"),
        account("B", "INSTAGRAM", "@b.insta"),
        account("B", "TELEGRAM", "@b.tg"),
        account("C", "INSTAGRAM", "@c.insta"),
        // C has a TELEGRAM account too — the old code would have exposed it.
        account("C", "TELEGRAM", "@c.tg"),
      ],
      conversations: [conversationRow("convAB", "A", "B"), conversationRow("convAC", "A", "C")],
      // A pending exchange from A to B.
      exchanges: [
        {
          id: "ex-pending",
          connectionId: "conn-convAB",
          conversationId: "convAB",
          requesterId: "A",
          receiverId: "B",
          platforms: PLATFORMS,
          message: null,
          status: "PENDING",
          createdAt: new Date(),
          updatedAt: new Date(),
          requester: { id: "A", nickname: "nick-A", avatarUrl: null, countryCode: null },
          receiver: { id: "B", nickname: "nick-B", avatarUrl: null, countryCode: null },
        },
      ],
      grants: [],
    });
    prisma.exchangeRequest.update = jest.fn().mockResolvedValue({
      id: "ex-pending",
      connectionId: "conn-convAB",
      conversationId: "convAB",
      requesterId: "A",
      receiverId: "B",
      platforms: PLATFORMS,
      message: null,
      status: "ACCEPTED",
      createdAt: new Date(),
      updatedAt: new Date(),
      requester: { id: "A", nickname: "nick-A", avatarUrl: null, countryCode: null },
      receiver: { id: "B", nickname: "nick-B", avatarUrl: null, countryCode: null },
    });

    const service = new ExchangeService(prisma as never);
    const result = await service.respond("B", "ex-pending", "accept");

    // Exactly 4 grants: 2 platforms x 2 directions.
    expect(prisma.sharedSocialAccount.createMany).toHaveBeenCalledTimes(1);
    const created = prisma.sharedSocialAccount.createMany.mock.calls[0][0].data as Grant[];
    expect(created).toHaveLength(4);
    expect(new Set(created.map((g) => `${g.ownerId}->${g.viewerId}:${g.platform}`))).toEqual(
      new Set([
        "A->B:INSTAGRAM",
        "A->B:TELEGRAM",
        "B->A:INSTAGRAM",
        "B->A:TELEGRAM",
      ]),
    );
    // No grant mentions C.
    expect(created.some((g) => g.ownerId === "C" || g.viewerId === "C")).toBe(false);
    // `shared` in the response reflects the new per-pair grants only.
    expect(result.shared).toHaveLength(4);
    expect(result.shared!.some((a) => a.userId === "C")).toBe(false);
  });

  it("F. sharedContacts 对已 Block 的会话拒绝读取（不泄露 handle）", async () => {
    const prisma = makePrisma({
      accounts: [
        account("A", "INSTAGRAM", "@a.insta"),
        account("B", "INSTAGRAM", "@b.insta"),
      ],
      conversations: [conversationRow("convAB", "A", "B")],
      exchanges: [acceptedExchange("ex-AB", "A", "B", "convAB")],
      grants: [
        { ownerId: "A", viewerId: "B", platform: "INSTAGRAM", socialAccountId: "acct-A-INSTAGRAM", exchangeId: "ex-AB" },
        { ownerId: "B", viewerId: "A", platform: "INSTAGRAM", socialAccountId: "acct-B-INSTAGRAM", exchangeId: "ex-AB" },
      ],
      blocked: true,
    });

    const service = new ExchangeService(prisma as never);
    await expect(service.sharedContacts("B", "convAB")).rejects.toMatchObject({
      status: 403,
    });
    expect(prisma.socialAccount.findMany).not.toHaveBeenCalled();
  });
});
