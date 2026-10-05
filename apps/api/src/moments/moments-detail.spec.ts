import { MomentsService } from "./moments.service";

const AUTHOR = "author";
const VIEWER = "viewer";

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
    likeCount: 3,
    commentCount: 1,
    source: "USER",
    syncedAt: null,
    createdAt: new Date("2026-09-19T00:00:00.000Z"),
    user: { id: AUTHOR, nickname: "Author", avatarUrl: null, countryCode: "CN", status: "ACTIVE" },
    likes: [],
    // C4：投影现在还会读 `bookmarks`（当前浏览者有没有收藏过），所以固定 fixture 也得有这一项。
    // 不补它会在投影处 TypeError —— 那不是断言失败，而是「形状变了两边没同步」。
    bookmarks: [],
    ...overrides,
  };
}

function makePrisma(overrides: {
  moment?: unknown;
  authorSetting?: unknown;
  viewerSetting?: unknown;
  blocked?: unknown;
  connected?: unknown;
} = {}) {
  const settings: Record<string, unknown> = {
    [AUTHOR]: overrides.authorSetting ?? null,
    [VIEWER]: overrides.viewerSetting ?? null,
  };
  return {
    moment: { findUnique: jest.fn().mockResolvedValue(overrides.moment ?? null) },
    momentSetting: {
      findUnique: jest.fn(async (args: { where: { userId: string } }) => settings[args.where.userId] ?? null),
    },
    block: { findFirst: jest.fn().mockResolvedValue(overrides.blocked ?? null) },
    connection: { findFirst: jest.fn().mockResolvedValue(overrides.connected ?? null) },
  };
}

function makeService(prisma: ReturnType<typeof makePrisma>) {
  return new MomentsService(prisma as never, { scanText: () => ({ blocked: false }) } as never, {
    notify: jest.fn(),
  } as never);
}

describe("MomentsService.getMoment", () => {
  it("不存在的动态 -> null", async () => {
    const prisma = makePrisma({ moment: null });
    await expect(makeService(prisma).getMoment(VIEWER, "missing")).resolves.toBeNull();
  });

  it("作者非 ACTIVE -> null（不泄漏内容）", async () => {
    const prisma = makePrisma({
      moment: makeMoment({ user: { id: AUTHOR, nickname: "A", avatarUrl: null, countryCode: "CN", status: "BANNED" } }),
    });
    await expect(makeService(prisma).getMoment(VIEWER, "m1")).resolves.toBeNull();
    expect(prisma.momentSetting.findUnique).not.toHaveBeenCalled();
  });

  it("private + 陌生人 -> MOMENT_LOCKED / 403，且未做 viewer 投影", async () => {
    const prisma = makePrisma({ moment: makeMoment(), authorSetting: { visibleTo: "private" } });
    await expect(makeService(prisma).getMoment(VIEWER, "m1")).rejects.toMatchObject({
      code: "MOMENT_LOCKED",
      status: 403,
    });
    expect(prisma.momentSetting.findUnique).toHaveBeenCalledTimes(1);
  });

  it("connections-only + 陌生人与非 ACTIVE 连接 -> 403", async () => {
    const prisma = makePrisma({
      moment: makeMoment(),
      authorSetting: { visibleTo: "connections" },
      connected: null,
    });
    await expect(makeService(prisma).getMoment(VIEWER, "m1")).rejects.toMatchObject({
      code: "MOMENT_LOCKED",
      status: 403,
    });
  });

  it("connections-only + ACTIVE 连接 -> 成功返回", async () => {
    const prisma = makePrisma({
      moment: makeMoment({ content: "peer content" }),
      authorSetting: { visibleTo: "connections", filterSensitive: false },
      viewerSetting: { filterSensitive: false, showVideos: true },
      connected: { id: "c1" },
    });
    const result = await makeService(prisma).getMoment(VIEWER, "m1");
    expect(result).not.toBeNull();
    expect(result?.content).toBe("peer content");
  });

  it("Block 压过 everyone -> 403", async () => {
    const prisma = makePrisma({
      moment: makeMoment(),
      authorSetting: { visibleTo: "everyone" },
      blocked: { id: "b1" },
    });
    await expect(makeService(prisma).getMoment(VIEWER, "m1")).rejects.toMatchObject({
      code: "MOMENT_LOCKED",
      status: 403,
    });
    expect(prisma.connection.findFirst).not.toHaveBeenCalled();
  });

  it("作者本人 + private -> 成功，且完全不做 block / connection 判定", async () => {
    const prisma = makePrisma({
      moment: makeMoment({ content: "my private note" }),
      authorSetting: { visibleTo: "private", filterSensitive: false },
    });
    const result = await makeService(prisma).getMoment(AUTHOR, "m1");
    expect(result?.content).toBe("my private note");
    expect(prisma.block.findFirst).not.toHaveBeenCalled();
    expect(prisma.connection.findFirst).not.toHaveBeenCalled();
  });

  it("投影字段完整，liked 取决于 viewer 自己的点赞", async () => {
    const prisma = makePrisma({
      moment: makeMoment({
        content: "reach me at me@example.com or 13800001111",
        images: ["a.jpg", "b.jpg"],
        videoUrl: "v.mp4",
        durationSec: 42,
        tags: ["生活"],
        likeCount: 7,
        commentCount: 2,
        source: "DEMO",
        syncedAt: new Date("2026-09-18T00:00:00.000Z"),
        likes: [{ userId: VIEWER }],
      }),
      authorSetting: { visibleTo: "everyone", filterSensitive: false },
      viewerSetting: { filterSensitive: false, showPhotos: true, showVideos: true, showReels: true },
    });
    const result = await makeService(prisma).getMoment(VIEWER, "m1");
    expect(result).toMatchObject({
      id: "m1",
      userId: AUTHOR,
      author: { id: AUTHOR, nickname: "Author", avatarUrl: null, countryCode: "CN" },
      platform: "TALKFIRST",
      content: "reach me at me@example.com or 13800001111",
      images: ["a.jpg", "b.jpg"],
      videoUrl: "v.mp4",
      durationSec: 42,
      tags: ["生活"],
      likeCount: 0,
      commentCount: 2,
      liked: true,
      // C4 新增字段：期望集里显式写出来，这样下次它再变会被看到。
      bookmarked: false,
      source: "DEMO",
      isDemo: true,
    });
  });

  it("敏感内容按 viewer 自己的 MomentSetting 打码", async () => {
    const prisma = makePrisma({
      moment: makeMoment({ content: "mail me@example.com now" }),
      authorSetting: { visibleTo: "everyone" },
      viewerSetting: { filterSensitive: true },
    });
    const result = await makeService(prisma).getMoment(VIEWER, "m1");
    expect(result?.content).not.toContain("me@example.com");
  });

  it("查询显式 select，且响应不携带任何敏感字段", async () => {
    const prisma = makePrisma({
      moment: makeMoment(),
      authorSetting: { visibleTo: "everyone" },
      viewerSetting: { filterSensitive: false },
    });
    const result = await makeService(prisma).getMoment(VIEWER, "m1");

    const query = prisma.moment.findUnique.mock.calls[0][0] as {
      include: { user: { select: Record<string, boolean> } };
    };
    const userSelect = Object.keys(query.include.user.select);
    expect(userSelect.sort()).toEqual(["avatarUrl", "countryCode", "id", "nickname", "status"]);
    for (const forbidden of ["email", "passwordHash", "isAdmin", "role", "bio", "city", "region", "gender"]) {
      expect(userSelect).not.toContain(forbidden);
    }

    const serialized = JSON.stringify(result);
    for (const forbidden of ["email", "passwordHash", "isAdmin", "handle", "oauth", "token", "status", "city"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
