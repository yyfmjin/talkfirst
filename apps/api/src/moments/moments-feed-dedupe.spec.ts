import { MomentsService } from "./moments.service";

/**
 * 动态流「一人一条」（2026-11-08）。
 *
 * 用户反馈时间线被同一个人刷屏：连发十条，整屏只剩他。现在每个作者只保留最新
 * 一条，其余的到他的动态页看。三条不变量值得钉住：
 *
 *  1. 同一作者只出现一次，且是他**最新**的那条；
 *  2. 「我的」标签页不折叠（那是自己的列表）；
 *  3. 游标指向**最后一条被消费的行**，而不是扫描窗口的末尾 —— 否则窗口里
 *     没返回的新作者会被整段跳过。
 */
type Row = ReturnType<typeof moment>;

function moment(id: string, userId: string, createdAt: string) {
  return {
    id,
    userId,
    user: { id: userId, nickname: userId, avatarUrl: null, countryCode: null },
    platform: "APP",
    platformName: null,
    content: id,
    images: [],
    videoUrl: null,
    audioUrl: null,
    durationSec: null,
    tags: [],
    source: "USER",
    likeCount: 0,
    commentCount: 0,
    createdAt: new Date(createdAt),
    syncedAt: null,
    likes: [],
    bookmarks: [],
  };
}

function makeService(rows: Row[]) {
  const prisma = {
    block: { findMany: jest.fn(async () => []) },
    connection: { findMany: jest.fn(async () => []) },
    moment: { findMany: jest.fn(async () => rows) },
    momentSetting: {
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(async () => null),
    },
  };
  const service = new MomentsService(prisma as never, {} as never, {} as never);
  return { service, prisma };
}

describe("MomentsService.feed — 一人一条", () => {
  it("同一作者只保留最新一条", async () => {
    const { service } = makeService([
      moment("a2", "A", "2026-11-08T10:00:00.000Z"),
      moment("b1", "B", "2026-11-08T09:00:00.000Z"),
      moment("a1", "A", "2026-11-08T08:00:00.000Z"),
    ]);

    const result = await service.feed("viewer", { limit: 10, tab: "recommend" });

    expect(result.items.map((item) => item.id)).toEqual(["a2", "b1"]);
  });

  it("「我的」标签页不折叠：那是自己的列表", async () => {
    const { service } = makeService([
      moment("m2", "me", "2026-11-08T10:00:00.000Z"),
      moment("m1", "me", "2026-11-08T09:00:00.000Z"),
    ]);

    const result = await service.feed("me", { limit: 10, tab: "mine" });

    expect(result.items.map((item) => item.id)).toEqual(["m2", "m1"]);
  });

  it("游标指向最后一条被消费的行，不是窗口末尾", async () => {
    const rows = [
      moment("a1", "A", "2026-11-08T10:00:00.000Z"),
      moment("a2", "A", "2026-11-08T09:59:00.000Z"),
      moment("b1", "B", "2026-11-08T09:00:00.000Z"),
      moment("c1", "C", "2026-11-08T08:00:00.000Z"),
      moment("d1", "D", "2026-11-08T07:00:00.000Z"),
    ];
    const { service } = makeService(rows);

    /* limit=2：收满 A、B 就停，但窗口里还有 C、D 没返回。 */
    const result = await service.feed("viewer", { limit: 2, tab: "recommend" });

    expect(result.items.map((item) => item.id)).toEqual(["a1", "b1"]);
    expect(result.nextCursor).toBe("2026-11-08T09:00:00.000Z|b1");
  });

  it("窗口扫完且没有更多时不给游标", async () => {
    const { service } = makeService([moment("a1", "A", "2026-11-08T10:00:00.000Z")]);

    const result = await service.feed("viewer", { limit: 10, tab: "recommend" });

    expect(result.items.map((item) => item.id)).toEqual(["a1"]);
    expect(result.nextCursor).toBeNull();
  });
});
