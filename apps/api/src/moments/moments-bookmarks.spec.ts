import { encodeKeysetCursor } from "../common/keyset-cursor";
import { MomentsService } from "./moments.service";

/**
 * C4 — 收藏（`docs/P0-00-BASELINE.md` §C 的 C4）。
 *
 * 这套用例盯住三件事，它们分别是这条功能最容易坏的地方：
 *
 * 1. **幂等**：收藏/取消都必须是「重复到达也不出错、也不多一行」。客户端是双击、
 *    网络会重试，把幂等寄托在调用方不重复上是不成立的。
 * 2. **「能不能收藏」=「能不能看」**：收藏是一个**按用户持久化下来的读取通道**。
 *    如果允许收藏看不见的东西，它就成了绕过拉黑与隐私的暗道 —— 收藏之后对方即使
 *    拉黑你，内容还躺在你的列表里。
 * 3. **列表每次读取都重新判一遍可见性**：收藏是一份会过期的快照。收藏之后对方可能
 *    拉黑你、可能把可见性收紧成 private、动态也可能被审核置为 `PENDING`。
 *
 * ## 哪些断言是「查形状」，哪些是「查行为」
 *
 * 拉黑与审核状态的过滤**发生在 SQL 里**（`where.moment.AND`），桩件不执行 SQL，
 * 所以那两条只能钉住**查询形状**；可见性（private / connections）依赖作者的设置行，
 * 是在 JS 里过滤的，**能**钉住行为。用例里逐条注明了 —— 免得后来者把「形状断言」
 * 误读成「行为已经被覆盖」。
 */

const VIEWER = "viewer-1";
const AUTHOR = "author-1";

function makeMoment(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    userId: AUTHOR,
    platform: "TALKFIRST",
    platformName: null,
    content: "hello world",
    images: [],
    videoUrl: null,
    durationSec: null,
    tags: [],
    likeCount: 2,
    commentCount: 0,
    source: "USER",
    reviewStatus: "APPROVED",
    syncedAt: null,
    createdAt: new Date("2026-10-05T00:00:00.000Z"),
    user: { id: AUTHOR, nickname: "Author", avatarUrl: null, countryCode: "CN" },
    likes: [],
    bookmarks: [{ userId: VIEWER }],
    ...overrides,
  };
}

function makeHarness(
  opts: {
    moment?: unknown;
    bookmarkRows?: Array<{ id: string; createdAt: Date; moment: unknown }>;
    authorSettings?: Array<{ userId: string; visibleTo: string }>;
    /**
     * `momentSetting.findUnique` 的返回值，按 userId 区分。
     *
     * 必须能区分：`resolveMomentAccess` 读的是**作者**的设置行，而列表读的是
     * **浏览者**自己的设置行（敏感内容过滤）。两者都在同一个桩上，所以用 userId 分派。
     */
    settings?: Record<string, { visibleTo: string } | null>;
    blocks?: Array<{ blockerId: string; blockedId: string }>;
    connections?: Array<{ userAId: string; userBId: string }>;
  } = {},
) {
  const prisma = {
    moment: { findUnique: jest.fn(async () => opts.moment ?? null) },
    momentBookmark: {
      upsert: jest.fn(async () => ({})),
      deleteMany: jest.fn(async () => ({ count: 1 })),
      // 参数以 `unknown` 接收，断言处再 `as unknown as` 转成具体形状：
      // 这个桩的入参形状是 Prisma 生成的，逐字写出来只会变成一份会和 schema 漂移的副本。
      findMany: jest.fn(async (_args: unknown) => opts.bookmarkRows ?? []),
    },
    momentSetting: {
      findMany: jest.fn(async () => opts.authorSettings ?? []),
      findUnique: jest.fn(
        async ({ where }: { where: { userId: string } }) => opts.settings?.[where.userId] ?? null,
      ),
    },
    // `findMany` 给列表用，`findFirst` 给 `resolveMomentAccess` 用 —— 两者都在路径上，
    // 少一个就会在「收藏自己的动态」之外的用例里变成 TypeError。
    block: {
      findMany: jest.fn(async () => opts.blocks ?? []),
      findFirst: jest.fn(async () => null),
    },
    connection: {
      findMany: jest.fn(async () => opts.connections ?? []),
      findFirst: jest.fn(async () => null),
    },
  };
  const service = new MomentsService(
    prisma as never,
    { scanText: () => ({ blocked: false }) } as never,
    { notify: jest.fn() } as never,
  );
  return { prisma, service };
}

describe("MomentsService.setBookmark —— 收藏与取消", () => {
  it("收藏是幂等的：重复到达仍然返回 bookmarked:true，且不靠唯一索引报错来兜", async () => {
    const { prisma, service } = makeHarness({
      moment: { id: "m1", userId: AUTHOR, user: { status: "ACTIVE" } },
    });

    await expect(service.setBookmark(VIEWER, "m1", true)).resolves.toEqual({ bookmarked: true });
    await expect(service.setBookmark(VIEWER, "m1", true)).resolves.toEqual({ bookmarked: true });

    // `update: {}` 是关键：命中已有行时**什么都不改**（尤其不更新 createdAt，
    // 否则重复收藏会把这条挤到列表最前面）。
    const calls = prisma.momentBookmark.upsert.mock.calls as unknown as Array<
      [{ where: { userId_momentId: { userId: string; momentId: string } }; update: unknown }]
    >;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].where.userId_momentId).toEqual({ userId: VIEWER, momentId: "m1" });
    expect(calls[0][0].update).toEqual({});
  });

  it("取消收藏也是幂等的：没有这一行时不报错", async () => {
    const { prisma, service } = makeHarness({
      moment: { id: "m1", userId: AUTHOR, user: { status: "ACTIVE" } },
    });

    await expect(service.setBookmark(VIEWER, "m1", false)).resolves.toEqual({ bookmarked: false });
    // deleteMany 而不是 delete：删不存在的行不抛 P2025。
    expect(prisma.momentBookmark.deleteMany).toHaveBeenCalledWith({
      where: { userId: VIEWER, momentId: "m1" },
    });
    expect(prisma.momentBookmark.upsert).not.toHaveBeenCalled();
  });

  it("看不见的动态不能被收藏，且**一个写操作都不发生**", async () => {
    // 作者把动态设成 private → `resolveMomentAccess` 读到的设置行让它变成 locked。
    const { prisma, service } = makeHarness({
      moment: { id: "m1", userId: AUTHOR, user: { status: "ACTIVE" } },
      settings: { [AUTHOR]: { visibleTo: "private" } },
    });

    await expect(service.setBookmark(VIEWER, "m1", true)).resolves.toBeNull();

    expect(prisma.momentBookmark.upsert).not.toHaveBeenCalled();
    expect(prisma.momentBookmark.deleteMany).not.toHaveBeenCalled();
  });

  it("作者非 ACTIVE 的动态不能被收藏（与 getMoment 同口径）", async () => {
    const { prisma, service } = makeHarness({
      moment: { id: "m1", userId: AUTHOR, user: { status: "BANNED" } },
    });

    await expect(service.setBookmark(VIEWER, "m1", true)).resolves.toBeNull();
    expect(prisma.momentBookmark.upsert).not.toHaveBeenCalled();
  });

  it("不存在的动态 → null，且不查可见性", async () => {
    const { prisma, service } = makeHarness({ moment: null });

    await expect(service.setBookmark(VIEWER, "missing", true)).resolves.toBeNull();
    // 不存在就没必要去读作者的设置行（`resolveMomentAccess` 只走 findUnique）。
    expect(prisma.momentSetting.findUnique).not.toHaveBeenCalled();
  });

  it("收藏自己动态时跳过可见性判断", async () => {
    const { prisma, service } = makeHarness({
      moment: { id: "m1", userId: VIEWER, user: { status: "ACTIVE" } },
    });

    await expect(service.setBookmark(VIEWER, "m1", true)).resolves.toEqual({ bookmarked: true });
    expect(prisma.momentSetting.findUnique).not.toHaveBeenCalled();
  });
});

describe("MomentsService.bookmarks —— 我的收藏列表", () => {
  it("按收藏时间倒序、多取一行判「还有下一页」，游标取返回页的最后一行", async () => {
    const older = { id: "b1", createdAt: new Date("2026-10-04T00:00:00.000Z"), moment: makeMoment({ id: "m1" }) };
    const newer = { id: "b2", createdAt: new Date("2026-10-05T00:00:00.000Z"), moment: makeMoment({ id: "m2" }) };
    const { prisma, service } = makeHarness({ bookmarkRows: [newer, older] });

    const result = await service.bookmarks(VIEWER, { limit: 1 });

    const args = prisma.momentBookmark.findMany.mock.calls[0][0] as unknown as {
      where: Record<string, unknown>;
      orderBy: unknown;
      take: number;
    };
    // 只查自己的收藏（别人的收藏不在这个查询的语义里）。
    expect(args.where.userId).toBe(VIEWER);
    // 共用的 keyset 序：(createdAt desc, id desc)。
    expect(args.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
    // limit + 1：多取的那一行只用来判断「还有下一页」，不进结果。
    expect(args.take).toBe(2);

    expect(result.items.map((item) => item.id)).toEqual(["m2"]);
    expect(result.nextCursor).toBe(encodeKeysetCursor({ createdAt: newer.createdAt, id: newer.id }));
  });

  it("拉黑与审核状态在 SQL 里判（钉查询形状）", async () => {
    // 先制造一条「我拉黑了作者」的关系，否则 notIn 那一支根本不会被拼进去。
    const { prisma, service } = makeHarness({
      bookmarkRows: [],
      blocks: [{ blockerId: VIEWER, blockedId: AUTHOR }],
    });

    await service.bookmarks(VIEWER, { limit: 20 });

    const args = prisma.momentBookmark.findMany.mock.calls[0][0] as unknown as {
      where: { moment: { AND: unknown[] } };
    };
    const and = args.where.moment.AND;
    // 拉黑的人：`userId notIn` 那一条。
    expect(and).toContainEqual({ userId: { notIn: [AUTHOR] } });
    // 审核状态：`reviewVisibilityFilter(VIEWER)` 的形状（已通过 OR 自己可见）。
    expect(and).toContainEqual({
      OR: [{ reviewStatus: { in: ["APPROVED"] } }, { userId: VIEWER }],
    });
  });

  it("没有拉黑任何人时不塞一个空的 notIn（空数组会让 SQL 变成恒假）", async () => {
    const { prisma, service } = makeHarness({ bookmarkRows: [] });

    await service.bookmarks(VIEWER, { limit: 20 });

    const args = prisma.momentBookmark.findMany.mock.calls[0][0] as unknown as {
      where: { moment: { AND: unknown[] } };
    };
    expect(args.where.moment.AND).toHaveLength(1);
  });

  it("作者设成 private 的收藏项**不再出现**（行为断言）", async () => {
    // 列表走的是 `findMany`（一次取回整页作者的设置），所以这里用 authorSettings。
    const { service } = makeHarness({
      bookmarkRows: [
        { id: "b1", createdAt: new Date("2026-10-05T00:00:00.000Z"), moment: makeMoment({ id: "m1" }) },
      ],
      authorSettings: [{ userId: AUTHOR, visibleTo: "private" }],
    });

    const result = await service.bookmarks(VIEWER, { limit: 20 });

    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  it("connections-only：未连接看不到，已连接看得到（行为断言）", async () => {
    const rows = [
      { id: "b1", createdAt: new Date("2026-10-05T00:00:00.000Z"), moment: makeMoment({ id: "m1" }) },
    ];
    const settings = [{ userId: AUTHOR, visibleTo: "connections" }];

    const stranger = makeHarness({ bookmarkRows: rows, authorSettings: settings });
    expect((await stranger.service.bookmarks(VIEWER, { limit: 20 })).items).toEqual([]);

    const connected = makeHarness({
      bookmarkRows: rows,
      authorSettings: settings,
      connections: [{ userAId: VIEWER, userBId: AUTHOR }],
    });
    const result = await connected.service.bookmarks(VIEWER, { limit: 20 });
    expect(result.items.map((item) => item.id)).toEqual(["m1"]);
  });

  it("投影里 bookmarked 恒为 true、liked 按行给出", async () => {
    const { service } = makeHarness({
      bookmarkRows: [
        {
          id: "b1",
          createdAt: new Date("2026-10-05T00:00:00.000Z"),
          moment: makeMoment({ id: "m1", likes: [{ userId: VIEWER }] }),
        },
        {
          id: "b2",
          createdAt: new Date("2026-10-04T00:00:00.000Z"),
          moment: makeMoment({ id: "m2", likes: [] }),
        },
      ],
    });

    const result = await service.bookmarks(VIEWER, { limit: 20 });

    expect(result.items.map((item) => [item.id, item.bookmarked, item.liked])).toEqual([
      ["m1", true, true],
      ["m2", true, false],
    ]);
  });

  it("畸形游标 → INVALID_CURSOR（由控制器翻成 400，不是 500）", async () => {
    const { prisma, service } = makeHarness({ bookmarkRows: [] });

    await expect(service.bookmarks(VIEWER, { limit: 20, cursor: "not-a-cursor" })).rejects.toThrow();
    expect(prisma.momentBookmark.findMany).not.toHaveBeenCalled();
  });
});
