import { MomentsService } from "./moments.service";

/**
 * C1 — 话题（`docs/P0-00-BASELINE.md` §C 的 C1；`FUNCTIONAL-TEST-UI-UX.md` §2.22 点名缺的那一块）。
 *
 * §2.22 的结论是「动态本来就带 tags，缺的只是按 tag 聚合浏览的查询接口」。所以这里钉的是
 * 三件事：
 *
 *  1. **归一化必须与写入端逐字一致**。写入时是 `trim → 去掉开头的 # → 小写 → 截 32`，
 *     查询端若用「看起来一样」的另一套，`#旅行` 与 `旅行` 就会互相查不到，而两边都不报错。
 *  2. **计数必须在同一套可见性下做**。一个话题的条数如果能被看不见它所属动态的人推出来，
 *     那它就是一个侧信道：「某个只被私密动态用过的话题有 3 条」本身就泄漏了那 3 条的存在。
 *  3. **零参数时零过滤**。`topic` 为空不能变成 `tags: { has: "" }`（那会匹配到空标签，
 *     或者什么也匹配不到 —— 两种都是静默的错误行为）。
 */

const VIEWER = "viewer-1";
const AUTHOR = "author-1";

function makeHarness(
  opts: {
    /** feed 用：`moment.findMany` 的返回。 */
    feedMoments?: unknown[];
    /** topics 用：窗口内的动态（只取 tags 与 userId）。 */
    windowMoments?: Array<{ userId: string; tags: string[] }>;
    authorSettings?: Array<{ userId: string; visibleTo: string }>;
    blocks?: Array<{ blockerId: string; blockedId: string }>;
    connections?: Array<{ userAId: string; userBId: string }>;
  } = {},
) {
  const prisma = {
    moment: {
      /**
       * 两个调用方共用这一个桩，用**参数**区分而不是靠调用顺序：
       * `topics` 传的是 `select: { tags, userId }`，而 `feed` 传的是 `include`。
       *
       * 这里写错过一次（漏了 `windowMoments`），结果是 topics 永远拿到空数组 ——
       * 失掉的正好是四条断言「有内容」的用例，而断言「查询形状」的那几条照样全绿。
       */
      findMany: jest.fn(async (args: { select?: unknown } = {}) =>
        args?.select ? (opts.windowMoments ?? []) : (opts.feedMoments ?? []),
      ),
    },
    momentSetting: {
      findMany: jest.fn(async () => opts.authorSettings ?? []),
      findUnique: jest.fn(async () => null),
    },
    block: { findMany: jest.fn(async () => opts.blocks ?? []), findFirst: jest.fn(async () => null) },
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

/** 话题用例只关心 `where` 与 `take`，所以查询参数按 `unknown` 收再转。 */
function findManyArgs(prisma: { moment: { findMany: jest.Mock } }, call = 0) {
  return prisma.moment.findMany.mock.calls[call][0] as unknown as {
    where: Record<string, unknown>;
    take?: number;
    select?: Record<string, boolean>;
  };
}

describe("MomentsService.feed —— topic 过滤（C1）", () => {
  it("`#旅行` 归一化成与写入端一致的 `旅行`", async () => {
    const { prisma, service } = makeHarness();

    await service.feed(VIEWER, { topic: "#旅行", limit: 20 });

    expect(findManyArgs(prisma).where.tags).toEqual({ has: "旅行" });
  });

  it("大小写与前后空格同样归一化，且截断到 32 字符", async () => {
    const { prisma, service } = makeHarness();

    await service.feed(VIEWER, { topic: `  ##${"A".repeat(40)}  `, limit: 20 });

    expect(findManyArgs(prisma).where.tags).toEqual({ has: "a".repeat(32) });
  });

  it("没有 topic 时**不加** `tags` 条件", async () => {
    const { prisma, service } = makeHarness();

    await service.feed(VIEWER, { limit: 20 });

    expect("tags" in findManyArgs(prisma).where).toBe(false);
  });

  it("topic 为空串或只有 `#` 时也不加条件（不能变成 has: \"\"）", async () => {
    const { prisma, service } = makeHarness();

    await service.feed(VIEWER, { topic: "   ", limit: 20 });
    await service.feed(VIEWER, { topic: "###", limit: 20 });

    expect("tags" in findManyArgs(prisma, 0).where).toBe(false);
    expect("tags" in findManyArgs(prisma, 1).where).toBe(false);
  });

  it("话题过滤与既有的拉黑/平台过滤是**并存**的，不是互相覆盖", async () => {
    const { prisma, service } = makeHarness({
      blocks: [{ blockerId: VIEWER, blockedId: AUTHOR }],
    });

    await service.feed(VIEWER, { topic: "旅行", platform: "TALKFIRST", limit: 20 });

    const where = findManyArgs(prisma).where as {
      tags?: unknown;
      platform?: unknown;
      AND?: unknown[];
    };
    expect(where.tags).toEqual({ has: "旅行" });
    expect(where.platform).toBe("TALKFIRST");
    expect(where.AND).toContainEqual({ userId: { notIn: [AUTHOR] } });
  });
});

describe("MomentsService.topics —— 话题列表（C1）", () => {
  it("只统计**看得见的**动态：private 的作者不计入", async () => {
    const { service } = makeHarness({
      windowMoments: [
        { userId: VIEWER, tags: ["旅行"] },
        { userId: AUTHOR, tags: ["旅行", "美食"] },
      ],
      authorSettings: [{ userId: AUTHOR, visibleTo: "private" }],
    });

    const result = await service.topics(VIEWER, {});

    // 作者设成 private，所以那两条标签全部不计入，而浏览者自己的那一条仍然算 ——
    // 这就是「同一套可见性」的含义。
    expect(result.items).toEqual([{ tag: "旅行", count: 1 }]);
  });

  it("connections-only：未连接不计入，已连接计入", async () => {
    const windowMoments = [{ userId: AUTHOR, tags: ["旅行"] }];
    const authorSettings = [{ userId: AUTHOR, visibleTo: "connections" }];

    const stranger = makeHarness({ windowMoments, authorSettings });
    expect((await stranger.service.topics(VIEWER, {})).items).toEqual([]);

    const connected = makeHarness({
      windowMoments,
      authorSettings,
      connections: [{ userAId: VIEWER, userBId: AUTHOR }],
    });
    expect((await connected.service.topics(VIEWER, {})).items).toEqual([
      { tag: "旅行", count: 1 },
    ]);
  });

  it("拉黑与审核状态在 SQL 里判（钉查询形状），与 feed 同源", async () => {
    const { prisma, service } = makeHarness({
      blocks: [{ blockerId: VIEWER, blockedId: AUTHOR }],
    });

    await service.topics(VIEWER, {});

    const where = findManyArgs(prisma).where as { userId?: unknown; AND?: unknown[] };
    expect(where.userId).toEqual({ notIn: [AUTHOR] });
    expect(where.AND).toContainEqual({
      OR: [{ reviewStatus: { in: ["APPROVED"] } }, { userId: VIEWER }],
    });
  });

  it("按条数降序、同条数按 tag 升序（不依赖 Map 的插入顺序）", async () => {
    const { service } = makeHarness({
      windowMoments: [
        { userId: VIEWER, tags: ["b", "a"] },
        { userId: VIEWER, tags: ["b", "c"] },
        { userId: VIEWER, tags: ["c"] },
      ],
    });

    const result = await service.topics(VIEWER, {});

    expect(result.items).toEqual([
      { tag: "b", count: 2 },
      { tag: "c", count: 2 },
      { tag: "a", count: 1 },
    ]);
  });

  it("limit 截断结果，window 决定取回多少条动态（默认 300）", async () => {
    const { prisma, service } = makeHarness({
      windowMoments: [
        { userId: VIEWER, tags: ["a"] },
        { userId: VIEWER, tags: ["b"] },
        { userId: VIEWER, tags: ["c"] },
      ],
    });

    const result = await service.topics(VIEWER, { limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(findManyArgs(prisma).take).toBe(300);
    expect(result.window).toBe(300);
  });

  it("window 有上限，且只 select 标签与作者（不把内容取回来）", async () => {
    const { prisma, service } = makeHarness();

    await service.topics(VIEWER, { window: 99999 });

    expect(findManyArgs(prisma).take).toBe(1000);
    expect(findManyArgs(prisma).select).toEqual({ tags: true, userId: true });
  });

  it("窗口里没有任何动态时返回空表，而不是 undefined", async () => {
    const { service } = makeHarness();

    const result = await service.topics(VIEWER, {});

    expect(result.items).toEqual([]);
    expect(result.window).toBe(300);
  });
});
