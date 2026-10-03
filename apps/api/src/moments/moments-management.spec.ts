import { MomentsService } from "./moments.service";

/**
 * 动态与评论的「管理」写入路径 —— 修改 / 删除。
 *
 * `PATCH /moments/:id`, `DELETE /moments/:id` and `PATCH /moments/:id/comments/:commentId`
 * existed before this phase but had no service-level coverage at all: the only
 * thing that ever exercised them was the browser suite, which needs a database.
 * These tests pin the rules that decide whether a row is touched, because each
 * one is a rule a client cannot be trusted to enforce:
 *
 *   - ownership is read from the stored row, never from the request;
 *   - an update that would leave the post with nothing is refused;
 *   - an empty `videoUrl` is how a clip is REMOVED, and an absent key means
 *     "leave it alone" — the two must not collapse into each other;
 *   - a comment belongs to the moment named in the path.
 */

const OWNER = "owner";
const STRANGER = "stranger";

function makeMoment(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    userId: OWNER,
    platform: "TALKFIRST",
    platformName: "TalkFirst",
    content: "original body",
    images: ["https://cdn.example.com/a.png"],
    videoUrl: "https://cdn.example.com/v.mp4",
    durationSec: null,
    tags: ["life"],
    likeCount: 0,
    commentCount: 0,
    source: "USER",
    syncedAt: new Date("2026-10-01T00:00:00.000Z"),
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** `moment.update` echoes the patch back with the stored row's other columns. */
function makePrisma(moment: unknown, scanBlocked = false) {
  const update = jest.fn(async (args: { data: Record<string, unknown> }) => ({
    ...(moment as Record<string, unknown>),
    ...args.data,
    updatedAt: new Date("2026-10-02T00:00:00.000Z"),
  }));
  const remove = jest.fn(async () => moment);
  const commentFindUnique = jest.fn();
  const commentUpdate = jest.fn();
  const commentDelete = jest.fn();
  const momentUpdateMany = jest.fn(async () => ({ count: 1 }));

  const prisma = {
    moment: { findUnique: jest.fn().mockResolvedValue(moment), update, delete: remove },
    momentComment: { findUnique: commentFindUnique, update: commentUpdate, delete: commentDelete },
    momentSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    block: { findFirst: jest.fn().mockResolvedValue(null) },
    connection: { findFirst: jest.fn().mockResolvedValue(null) },
    // `deleteComment` runs inside a transaction whose client is the argument.
    $transaction: jest.fn(async (run: (tx: unknown) => Promise<unknown>) =>
      run({
        momentComment: { findUnique: commentFindUnique, delete: commentDelete },
        moment: { updateMany: momentUpdateMany },
      }),
    ),
  };

  return {
    prisma,
    update,
    remove,
    commentFindUnique,
    commentUpdate,
    commentDelete,
    momentUpdateMany,
    scanBlocked,
  };
}

function makeService(prisma: ReturnType<typeof makePrisma>["prisma"], scanBlocked = false) {
  return new MomentsService(prisma as never, { scanText: () => ({ blocked: scanBlocked }) } as never, {
    notify: jest.fn(),
  } as never);
}

describe("MomentsService.updateMoment", () => {
  it("不存在的动态 -> null，不写入", async () => {
    const { prisma, update } = makePrisma(null);
    await expect(makeService(prisma).updateMoment(OWNER, "missing", { content: "x" })).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("非作者 -> MOMENT_FORBIDDEN，且不写入", async () => {
    const { prisma, update } = makePrisma(makeMoment());
    await expect(makeService(prisma).updateMoment(STRANGER, "m1", { content: "hijacked" })).rejects.toMatchObject({
      code: "MOMENT_FORBIDDEN",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("只改正文：媒体与标签按原值保留", async () => {
    const { prisma, update } = makePrisma(makeMoment());
    const result = await makeService(prisma).updateMoment(OWNER, "m1", { content: "  new body  " });

    expect(update).toHaveBeenCalledTimes(1);
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.content).toBe("new body");
    expect(data.images).toEqual(["https://cdn.example.com/a.png"]);
    expect(data.videoUrl).toBe("https://cdn.example.com/v.mp4");
    expect(data.tags).toEqual(["life"]);
    expect(result?.content).toBe("new body");
  });

  it("videoUrl 为空字符串 -> 显式清空视频（而不是「保持原样」）", async () => {
    const { prisma, update } = makePrisma(makeMoment());
    const result = await makeService(prisma).updateMoment(OWNER, "m1", { videoUrl: "" });

    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.videoUrl).toBeNull();
    expect(result?.videoUrl).toBeNull();
  });

  it("images 为空数组 -> 清空照片；非法 URL 一并被过滤", async () => {
    const { prisma, update } = makePrisma(makeMoment());
    await makeService(prisma).updateMoment(OWNER, "m1", {
      images: ["javascript:alert(1)", "https://cdn.example.com/b.png", "not-a-url"],
    });

    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data.images).toEqual(["https://cdn.example.com/b.png"]);

    const { prisma: emptyPrisma, update: emptyUpdate } = makePrisma(makeMoment());
    await makeService(emptyPrisma).updateMoment(OWNER, "m1", { images: [] });
    expect((emptyUpdate.mock.calls[0][0] as { data: Record<string, unknown> }).data.images).toEqual([]);
  });

  it("清掉全部媒体且正文为空 -> EMPTY_CONTENT，且不写入", async () => {
    const { prisma, update } = makePrisma(makeMoment());
    await expect(
      makeService(prisma).updateMoment(OWNER, "m1", { content: "   ", images: [], videoUrl: "" }),
    ).rejects.toMatchObject({ code: "EMPTY_CONTENT" });
    expect(update).not.toHaveBeenCalled();
  });

  it("话题被规范化：去 #、trim、小写、去空、最多 10 个", async () => {
    const { prisma, update } = makePrisma(makeMoment());
    await makeService(prisma).updateMoment(OWNER, "m1", {
      tags: ["#Travel", "  MUSIC  ", "#", ...Array.from({ length: 12 }, (_, index) => `t${index}`)],
    });

    expect((update.mock.calls[0][0] as { data: Record<string, unknown> }).data.tags).toEqual([
      "travel",
      "music",
      "t0",
      "t1",
      "t2",
      "t3",
      "t4",
      "t5",
      "t6",
      "t7",
    ]);
  });

  it("命中风控词 -> CONTENT_BLOCKED，且不写入", async () => {
    const { prisma, update } = makePrisma(makeMoment());
    await expect(
      makeService(prisma, true).updateMoment(OWNER, "m1", { content: "blocked" }),
    ).rejects.toMatchObject({ code: "CONTENT_BLOCKED" });
    expect(update).not.toHaveBeenCalled();
  });

  it("只改标签时不做风控扫描（正文没有变）", async () => {
    const { prisma, update } = makePrisma(makeMoment());
    await makeService(prisma, true).updateMoment(OWNER, "m1", { tags: ["ok"] });
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe("MomentsService.remove", () => {
  it("不存在的动态 -> null", async () => {
    const { prisma, remove } = makePrisma(null);
    await expect(makeService(prisma).remove(OWNER, "missing")).resolves.toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it("非作者 -> MOMENT_FORBIDDEN，且不删除", async () => {
    const { prisma, remove } = makePrisma(makeMoment());
    await expect(makeService(prisma).remove(STRANGER, "m1")).rejects.toMatchObject({ code: "MOMENT_FORBIDDEN" });
    expect(remove).not.toHaveBeenCalled();
  });

  it("作者本人 -> 删除并返回 deleted", async () => {
    const { prisma, remove } = makePrisma(makeMoment());
    await expect(makeService(prisma).remove(OWNER, "m1")).resolves.toEqual({ deleted: true });
    expect(remove).toHaveBeenCalledWith({ where: { id: "m1" } });
  });
});

describe("MomentsService.updateComment", () => {
  const COMMENT = { id: "c1", momentId: "m1", userId: OWNER, content: "before", parentCommentId: null };

  function makeCommentPrisma(overrides: { moment?: unknown; comment?: unknown } = {}) {
    const harness = makePrisma(overrides.moment === undefined ? makeMoment() : overrides.moment);
    harness.commentFindUnique.mockResolvedValue(overrides.comment === undefined ? COMMENT : overrides.comment);
    harness.commentUpdate.mockImplementation(async (args: { data: { content: string } }) => ({
      ...COMMENT,
      content: args.data.content,
      user: { id: OWNER, nickname: "Owner", avatarUrl: null },
    }));
    return harness;
  }

  it("评论不属于这条动态 -> COMMENT_NOT_FOUND", async () => {
    const harness = makeCommentPrisma({ comment: { ...COMMENT, momentId: "other" } });
    await expect(makeService(harness.prisma).updateComment(OWNER, "m1", "c1", "new")).rejects.toMatchObject({
      code: "COMMENT_NOT_FOUND",
    });
    expect(harness.commentUpdate).not.toHaveBeenCalled();
  });

  it("评论不存在 -> COMMENT_NOT_FOUND", async () => {
    const harness = makeCommentPrisma({ comment: null });
    await expect(makeService(harness.prisma).updateComment(OWNER, "m1", "c1", "new")).rejects.toMatchObject({
      code: "COMMENT_NOT_FOUND",
    });
  });

  it("别人的评论 -> COMMENT_FORBIDDEN，且不写入", async () => {
    const harness = makeCommentPrisma({ comment: { ...COMMENT, userId: STRANGER } });
    await expect(makeService(harness.prisma).updateComment(OWNER, "m1", "c1", "new")).rejects.toMatchObject({
      code: "COMMENT_FORBIDDEN",
    });
    expect(harness.commentUpdate).not.toHaveBeenCalled();
  });

  it("空评论 -> EMPTY_COMMENT，且不写入", async () => {
    const harness = makeCommentPrisma();
    await expect(makeService(harness.prisma).updateComment(OWNER, "m1", "c1", "   ")).rejects.toMatchObject({
      code: "EMPTY_COMMENT",
    });
    expect(harness.commentUpdate).not.toHaveBeenCalled();
  });

  it("命中风控词 -> CONTENT_BLOCKED，且不写入", async () => {
    const harness = makeCommentPrisma();
    await expect(makeService(harness.prisma, true).updateComment(OWNER, "m1", "c1", "blocked")).rejects.toMatchObject({
      code: "CONTENT_BLOCKED",
    });
    expect(harness.commentUpdate).not.toHaveBeenCalled();
  });

  it("作者本人 -> 只改 content，返回服务端存储的文本", async () => {
    const harness = makeCommentPrisma();
    const result = await makeService(harness.prisma).updateComment(OWNER, "m1", "c1", "  after  ");

    expect(harness.commentUpdate).toHaveBeenCalledTimes(1);
    const args = harness.commentUpdate.mock.calls[0][0] as { where: { id: string }; data: Record<string, unknown> };
    expect(args.where).toEqual({ id: "c1" });
    expect(args.data).toEqual({ content: "after" });
    expect(result).toMatchObject({ id: "c1", content: "after", parentCommentId: null });
    expect(result?.user).toEqual({ id: OWNER, nickname: "Owner", avatarUrl: null });
  });

  it("回复也可以改：保留 parentCommentId", async () => {
    const harness = makeCommentPrisma({ comment: { ...COMMENT, id: "r1", parentCommentId: "c1" } });
    harness.commentUpdate.mockImplementation(async (args: { data: { content: string } }) => ({
      ...COMMENT,
      id: "r1",
      parentCommentId: "c1",
      content: args.data.content,
      user: { id: OWNER, nickname: "Owner", avatarUrl: null },
    }));

    const result = await makeService(harness.prisma).updateComment(OWNER, "m1", "r1", "edited reply");
    expect(result).toMatchObject({ id: "r1", content: "edited reply", parentCommentId: "c1" });
  });

  it("被锁定的动态 -> MOMENT_LOCKED，且从不读取评论", async () => {
    const harness = makeCommentPrisma({ moment: makeMoment({ userId: STRANGER }) });
    harness.prisma.momentSetting.findUnique.mockResolvedValue({ visibleTo: "private" });

    await expect(makeService(harness.prisma).updateComment(OWNER, "m1", "c1", "new")).rejects.toMatchObject({
      code: "MOMENT_LOCKED",
    });
    expect(harness.commentFindUnique).not.toHaveBeenCalled();
  });
});
