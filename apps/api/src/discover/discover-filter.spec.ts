import { DiscoverService } from "./discover.service";

/**
 * P0-3: Discover must filter out blocked relationships and existing connections.
 *
 * Before the fix the candidate query was `id: { not: userId }` plus the day's
 * already-viewed ids — nothing else. A user you had blocked (or who had blocked
 * you) still showed up in your feed, and so did people you had already
 * connected with.
 */

type Row = { id: string; lastActiveAt?: Date | null };

/** Build a Prisma stub whose candidate query applies the real `notIn` filter. */
function makePrisma(opts: {
  candidates: Row[];
  blocks?: Array<{ blockerId: string; blockedId: string }>;
  connections?: Array<{ userAId: string; userBId: string }>;
  viewed?: string[];
  current?: Row | null;
}) {
  const blocks = opts.blocks ?? [];
  const connections = opts.connections ?? [];
  const viewed = opts.viewed ?? [];

  const emptyRelations = {
    languages: [],
    interests: [],
    purposes: [],
    preferredCountries: [],
  };

  const service = {
    discoverView: {
      findMany: jest.fn().mockResolvedValue(viewed.map((id) => ({ viewedUserId: id }))),
    },
    block: {
      findMany: jest.fn(async ({ where }: { where: { OR: Array<Record<string, string>> } }) => {
        const me = where.OR[0].blockerId ?? where.OR[0].blockedId;
        return blocks.filter((b) => b.blockerId === me || b.blockedId === me);
      }),
    },
    connection: {
      findMany: jest.fn(
        async ({ where }: { where: { OR: Array<Record<string, string>> } }) => {
          const me = where.OR[0].userAId ?? where.OR[0].userBId;
          return connections.filter((c) => c.userAId === me || c.userBId === me);
        },
      ),
    },
    user: {
      findUnique: jest.fn(async () => {
        const me = opts.current;
        if (!me) return null;
        return {
          id: me.id,
          nickname: `nick-${me.id}`,
          avatarUrl: null,
          countryCode: "US",
          birthDate: new Date("2000-01-01"),
          bio: null,
          lastActiveAt: me.lastActiveAt ?? new Date(),
          ...emptyRelations,
        };
      }),
      findMany: jest.fn(async ({ where }: { where: { id: { not: string; notIn: string[] } } }) => {
        const excluded = new Set([where.id.not, ...where.id.notIn]);
        return opts.candidates
          .filter((c) => !excluded.has(c.id))
          .map((c) => ({
            id: c.id,
            nickname: `nick-${c.id}`,
            avatarUrl: null,
            countryCode: "US",
            birthDate: new Date("2000-01-01"),
            bio: null,
            lastActiveAt: c.lastActiveAt ?? new Date(),
            ...emptyRelations,
          }));
      }),
    },
  };

  return service;
}

function ids(result: { items: Array<{ id: string }> }) {
  return result.items.map((item) => item.id).sort();
}

describe("P0-3 DiscoverService block / connection filtering", () => {
  const candidates: Row[] = [{ id: "B" }, { id: "C" }, { id: "D" }, { id: "E" }];

  it("场景 1：我拉黑了 B -> B 不出现在 Discover", async () => {
    const prisma = makePrisma({
      candidates,
      blocks: [{ blockerId: "A", blockedId: "B" }],
      current: { id: "A" },
    });
    const service = new DiscoverService(prisma as never);
    const result = await service.getRecommendations("A", 20);

    expect(ids(result)).toEqual(["C", "D", "E"]);
    expect(ids(result)).not.toContain("B");
  });

  it("场景 2：B 拉黑了我 -> B 同样不出现在 Discover", async () => {
    const prisma = makePrisma({
      candidates,
      blocks: [{ blockerId: "B", blockedId: "A" }],
      current: { id: "A" },
    });
    const service = new DiscoverService(prisma as never);
    const result = await service.getRecommendations("A", 20);

    expect(ids(result)).toEqual(["C", "D", "E"]);
    expect(ids(result)).not.toContain("B");
  });

  it("场景 3：与 B 已是 ACTIVE Connection -> B 不出现在 Discover", async () => {
    const prisma = makePrisma({
      candidates,
      connections: [{ userAId: "A", userBId: "B" }],
      current: { id: "A" },
    });
    const service = new DiscoverService(prisma as never);
    const result = await service.getRecommendations("A", 20);

    expect(ids(result)).toEqual(["C", "D", "E"]);
    expect(ids(result)).not.toContain("B");
  });

  it("综合：Block（双向）+ Connection + 自己 + 今日已看 全部被排除", async () => {
    const prisma = makePrisma({
      candidates: [
        ...candidates,
        { id: "A" }, // self — must never appear
        { id: "F" }, // already viewed today
      ],
      blocks: [
        { blockerId: "A", blockedId: "B" }, // I blocked B
        { blockerId: "C", blockedId: "A" }, // C blocked me
      ],
      connections: [{ userAId: "A", userBId: "D" }],
      viewed: ["F"],
      current: { id: "A" },
    });
    const service = new DiscoverService(prisma as never);
    const result = await service.getRecommendations("A", 20);

    expect(ids(result)).toEqual(["E"]);
  });

  it("对照：没有任何 Block / Connection 时，候选正常出现", async () => {
    const prisma = makePrisma({
      candidates,
      current: { id: "A" },
    });
    const service = new DiscoverService(prisma as never);
    const result = await service.getRecommendations("A", 20);

    expect(ids(result)).toEqual(["B", "C", "D", "E"]);
  });

  it("只排除 ACTIVE Connection；非 ACTIVE（如 REMOVED）不影响推荐", async () => {
    // The service filters by status ACTIVE at the query level, so a stub that
    // returns only ACTIVE rows should yield no exclusions.
    const prisma = makePrisma({
      candidates,
      connections: [],
      current: { id: "A" },
    });
    const service = new DiscoverService(prisma as never);
    const result = await service.getRecommendations("A", 20);

    expect(ids(result)).toEqual(["B", "C", "D", "E"]);
    expect(prisma.connection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "ACTIVE" }),
      }),
    );
  });

  it("block 查询使用双向 OR，不会漏掉任一方向", async () => {
    const prisma = makePrisma({ candidates, current: { id: "A" } });
    const service = new DiscoverService(prisma as never);
    await service.getRecommendations("A", 20);

    expect(prisma.block.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ blockerId: "A" }, { blockedId: "A" }],
        },
      }),
    );
  });
});
