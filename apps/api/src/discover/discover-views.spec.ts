import { DiscoverService } from "./discover.service";

/**
 * FEATURE (post-audit) — the Discover daily quota is actually consumed.
 *
 * `POST /discover/views/:userId` existed, `getRecommendations` respected it
 * (`DAILY_VIEW_LIMIT - viewedIds.size`), and **no client ever called it** — not
 * the web app, not the native one. So the 「今日剩余 N」 badge never moved and the
 * "you have seen everyone for today" state was unreachable.
 *
 * Two halves had to land together: a caller (the web bubble wall now posts when a
 * card opens) and a response the caller can use without guessing. The second half
 * is what this suite pins — `remaining` is recomputed from the same per-day count
 * the recommendation list uses, so a re-opened card, a second tab, or a
 * duplicated request cannot drift the number shown.
 *
 * The upsert being idempotent matters for the same reason: opening one profile
 * twice must not cost two of the twenty slots.
 */

const TODAY = new Date();

function makePrisma(options: { existing?: string[] } = {}) {
  const existing = options.existing ?? [];
  const rows: string[] = [...existing];
  return {
    user: {
      findUnique: jest.fn(async () => ({ id: "peer-1", status: "ACTIVE" })),
    },
    discoverView: {
      upsert: jest.fn(async ({ create }: { create: { viewedUserId: string } }) => {
        // The real unique key is `(userId, viewedUserId, viewDate)`, so a repeat
        // of the same pair changes nothing.
        if (!rows.includes(create.viewedUserId)) rows.push(create.viewedUserId);
        return { id: "view-1" };
      }),
      count: jest.fn(async () => rows.length),
    },
    __rows: rows,
  };
}

function makeService(prisma: ReturnType<typeof makePrisma>) {
  return new DiscoverService(prisma as never);
}

describe("markViewed — 返回权威的剩余额度", () => {
  it("首次查看 -> used=1，remaining=19", async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    await expect(service.markViewed("me", "peer-1")).resolves.toEqual({
      viewed: true,
      remaining: 19,
      limit: 20,
      used: 1,
    });
  });

  it("同一个人看两次 -> 不重复消耗额度（upsert 幂等）", async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    await service.markViewed("me", "peer-1");
    await expect(service.markViewed("me", "peer-1")).resolves.toMatchObject({
      remaining: 19,
      used: 1,
    });
    expect(prisma.__rows).toHaveLength(1);
  });

  it("已看满 20 人 -> remaining 为 0，不会出现负数", async () => {
    const prisma = makePrisma({
      existing: Array.from({ length: 19 }, (_, index) => `peer-${index + 2}`),
    });
    const service = makeService(prisma);

    await expect(service.markViewed("me", "peer-1")).resolves.toMatchObject({
      remaining: 0,
      used: 20,
    });

    // And a 21st distinct view reports 0 rather than -1.
    prisma.user.findUnique.mockResolvedValue({ id: "peer-99", status: "ACTIVE" });
    await expect(service.markViewed("me", "peer-99")).resolves.toMatchObject({
      remaining: 0,
      used: 21,
    });
  });

  it("看自己 -> 400 CANNOT_VIEW_SELF，且不写任何行", async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    await expect(service.markViewed("me", "me")).rejects.toMatchObject({
      response: { error: { code: "CANNOT_VIEW_SELF" } },
    });
    expect(prisma.discoverView.upsert).not.toHaveBeenCalled();
  });

  it("目标不存在或非 ACTIVE -> 400 USER_NOT_FOUND，且不写任何行", async () => {
    const prisma = makePrisma();
    // `as never`: the mock's inferred return type is the non-nullable row above,
    // so `null` is rejected by the signature even though it is the case under
    // test (target user missing). Casting here rather than widening the factory
    // keeps every other call site's type intact.
    prisma.user.findUnique.mockResolvedValue(null as never);
    const service = makeService(prisma);

    await expect(service.markViewed("me", "ghost")).rejects.toMatchObject({
      response: { error: { code: "USER_NOT_FOUND" } },
    });
    expect(prisma.discoverView.upsert).not.toHaveBeenCalled();
  });

  it("使用的窗口是「今天」，与推荐列表同一口径", async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    await service.markViewed("me", "peer-1");

    const upsertArgs = prisma.discoverView.upsert.mock.calls[0] as unknown as [
      { where: { userId_viewedUserId_viewDate: { viewDate: Date } } },
    ];
    const countArgs = prisma.discoverView.count.mock.calls[0] as unknown as [
      { where: { userId: string; viewDate: Date } },
    ];
    expect(upsertArgs[0].where.userId_viewedUserId_viewDate.viewDate).toBeInstanceOf(Date);
    expect(countArgs[0].where.userId).toBe("me");
    expect(countArgs[0].where.viewDate).toBeInstanceOf(Date);
    // Both must be midnight of the same day the module considers "today".
    expect(countArgs[0].where.viewDate.getHours()).toBe(0);
    expect(countArgs[0].where.viewDate.getTime()).toBeLessThanOrEqual(TODAY.getTime());
  });
});
