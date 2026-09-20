import { MomentsService } from "./moments.service";
import { NotificationService } from "../notifications/notification.service";

const AUTHOR = "author";
const VIEWER = "viewer";

type Created = {
  id: string;
  content: string;
  createdAt: Date;
  parentCommentId: string | null;
  user: { id: string; nickname: string | null; avatarUrl: string | null };
};

function makeRow(content = "hello", parentCommentId: string | null = null): Created {
  return {
    id: "c-new",
    content,
    createdAt: new Date("2026-09-19T00:00:00.000Z"),
    parentCommentId,
    user: { id: VIEWER, nickname: "Viewer", avatarUrl: null },
  };
}

/**
 * PC-2.2 — the comment thread only as far as the service decides it.
 *
 * `momentComment` is the surface that matters: everything before it is the
 * authorization gate, and a call to `findMany` / `create` proves the gate was
 * passed (or not). Both directions are asserted so a future refactor cannot
 * quietly move the check after the query.
 *
 * PC-2.3.2 adds `parentCommentId` to the same shape. `parent` is the row the
 * reply check reads inside the transaction, so each test can pin the four
 * outcomes the service must tell apart: valid, missing, other moment, already
 * a reply.
 */
function makePrisma(
  options: {
    moment?: unknown;
    authorSetting?: unknown;
    blocked?: unknown;
    connected?: unknown;
    comments?: unknown[];
    total?: number;
    parent?: {
      id: string;
      momentId: string;
      parentCommentId: string | null;
      /** PC-3.1c — the reply notification's recipient. */
      userId?: string;
    } | null;
    /** PC-2.4 — the row `deleteComment` reads back before removing anything. */
    comment?: { id: string; momentId: string; userId: string; parentCommentId: string | null } | null;
  } = {},
) {
  const tx = {
    // Echo the content and the parent back, so the returned row proves which
    // thread level was actually written.
    momentComment: {
      findUnique: jest.fn().mockResolvedValue(options.comment ?? options.parent ?? null),
      delete: jest.fn().mockResolvedValue({ id: "c1" }),
      create: jest.fn(async (args: { data: { content: string; parentCommentId?: string | null } }) =>
        makeRow(args.data.content, args.data.parentCommentId ?? null),
      ),
    },
    moment: {
      update: jest.fn().mockResolvedValue({ id: "m1", commentCount: 2 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    moment: {
      // `moment: null` is a case under test, so an absent key and an explicit
      // null must not collapse into the same default.
      findUnique: jest.fn().mockResolvedValue("moment" in options ? options.moment : { id: "m1", userId: AUTHOR }),
    },
    momentSetting: { findUnique: jest.fn().mockResolvedValue(options.authorSetting ?? null) },
    block: { findFirst: jest.fn().mockResolvedValue(options.blocked ?? null) },
    connection: { findFirst: jest.fn().mockResolvedValue(options.connected ?? null) },
    momentComment: {
      findMany: jest.fn().mockResolvedValue(options.comments ?? []),
      // PC-2.4 — the page's `total` comes from a second query over the same
      // filter; the default echoes what `findMany` returned.
      count: jest.fn().mockResolvedValue(options.total ?? (options.comments ?? []).length),
    },
    notification: { create: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (callback: (client: unknown) => Promise<unknown>) => callback(tx)),
  };
  return { prisma, tx };
}

function makeService(
  prisma: unknown,
  scan: { blocked?: boolean; level?: string } = { blocked: false, level: "LOW" },
) {
  const safety = { scanText: jest.fn().mockReturnValue(scan) };
  return {
    service: new MomentsService(prisma as never, safety as never, new NotificationService(prisma as never)),
    safety,
  };
}

describe("MomentsService.listComments", () => {
  it("不存在的动态 -> null，且从不查询评论", async () => {
    const { prisma } = makePrisma({ moment: null });
    const { service } = makeService(prisma);
    await expect(service.listComments(VIEWER, "missing")).resolves.toBeNull();
    expect(prisma.momentComment.findMany).not.toHaveBeenCalled();
  });

  it("鉴权在查询之前：被 Block 的观众拿不到评论", async () => {
    const { prisma } = makePrisma({ blocked: { id: "b1" } });
    const { service } = makeService(prisma);
    await expect(service.listComments(VIEWER, "m1")).rejects.toMatchObject({
      code: "MOMENT_LOCKED",
      status: 403,
    });
    expect(prisma.momentComment.findMany).not.toHaveBeenCalled();
    expect(prisma.momentComment.count).not.toHaveBeenCalled();
  });

  it("显式投影：只返回 id / content / createdAt / 作者公开身份", async () => {
    const { prisma } = makePrisma({
      comments: [{ id: "c1", content: "hi", createdAt: new Date(), user: { id: "u1", nickname: "A", avatarUrl: null } }],
    });
    const { service } = makeService(prisma);
    await service.listComments(VIEWER, "m1");

    const query = prisma.momentComment.findMany.mock.calls[0][0] as {
      select: Record<string, unknown>;
    };
    expect(Object.keys(query.select).sort()).toEqual(["content", "createdAt", "id", "replies", "user"]);
    expect(JSON.stringify(query.select)).not.toContain("momentId");
    expect(JSON.stringify(query.select)).not.toContain("userId");
    const projection = JSON.stringify(query.select);
    for (const forbidden of ["email", "passwordHash", "isAdmin", "handle", "status"]) {
      expect(projection).not.toContain(forbidden);
    }
  });

  it("没有评论 -> total 0 / totalPages 0 的空分页结果", async () => {
    const { prisma } = makePrisma({ comments: [] });
    const { service } = makeService(prisma);
    await expect(service.listComments(VIEWER, "m1")).resolves.toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 0,
    });
  });

  it("page / pageSize 收敛：page >= 1，pageSize 保持在 1..50", async () => {
    const { prisma } = makePrisma();
    const { service } = makeService(prisma);
    const take = (index: number) => (prisma.momentComment.findMany.mock.calls[index][0] as { take: number }).take;
    const skip = (index: number) => (prisma.momentComment.findMany.mock.calls[index][0] as { skip: number }).skip;

    await service.listComments(VIEWER, "m1", 1, 9999);
    expect(take(0)).toBe(50);
    await service.listComments(VIEWER, "m1", 1, 0);
    expect(take(1)).toBe(20);
    await service.listComments(VIEWER, "m1", 3, 10);
    expect(take(2)).toBe(10);
    expect(skip(2)).toBe(20);
  });

  it("只取顶级评论，回复以 replies 嵌套返回，且共用同一份公开投影", async () => {
    const { prisma } = makePrisma();
    const { service } = makeService(prisma);
    await service.listComments(VIEWER, "m1");

    const query = prisma.momentComment.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      select: { replies?: unknown };
    };
    // 分页与过滤共用同一个 where：count 与 findMany 必须看到同一批一级评论。
    expect((prisma.momentComment.count.mock.calls[0][0] as { where: unknown }).where).toEqual({
      momentId: "m1",
      parentCommentId: null,
    });
    // 平铺会让回复看起来像一级评论，因此顶级过滤必须落在查询上而不是前端。
    expect(query.where).toEqual({ momentId: "m1", parentCommentId: null });
    const replies = query.select.replies as { select: Record<string, unknown> } | undefined;
    expect(replies).toBeDefined();
    expect(Object.keys(replies?.select ?? {}).sort()).toEqual(["content", "createdAt", "id", "user"]);
    const projection = JSON.stringify(replies);
    for (const forbidden of ["email", "passwordHash", "isAdmin", "handle", "momentId", "userId"]) {
      expect(projection).not.toContain(forbidden);
    }
  });
});

describe("MomentsService.addComment", () => {
  it("写入评论并返回作者身份，commentCount 在同一事务里递增", async () => {
    const { prisma, tx } = makePrisma();
    const { service } = makeService(prisma);
    const result = await service.addComment(VIEWER, "m1", "  说得很有意思！  ");

    expect(result).toEqual(makeRow("说得很有意思！"));
    expect(tx.momentComment.create).toHaveBeenCalledTimes(1);
    const args = tx.momentComment.create.mock.calls[0][0] as {
      data: { momentId: string; userId: string; content: string; parentCommentId: string | null };
      select: Record<string, unknown>;
    };
    expect(args.data).toEqual({
      momentId: "m1",
      userId: VIEWER,
      content: "说得很有意思！",
      parentCommentId: null,
    });
    // The author must travel with the created row, or the UI cannot render it.
    expect((args.select.user as { select: Record<string, boolean> }).select).toEqual({
      id: true,
      nickname: true,
      avatarUrl: true,
    });
    expect(tx.moment.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { commentCount: { increment: 1 } },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("缺省 parentCommentId 即一级评论：不读父评论", async () => {
    const { prisma, tx } = makePrisma();
    const { service } = makeService(prisma);
    await service.addComment(VIEWER, "m1", "hi", null);

    expect(tx.momentComment.findUnique).not.toHaveBeenCalled();
    const args = tx.momentComment.create.mock.calls[0][0] as { data: { parentCommentId: string | null } };
    expect(args.data.parentCommentId).toBeNull();
  });

  it("create 投影不携带任何内部字段", async () => {
    const { prisma, tx } = makePrisma();
    const { service } = makeService(prisma);
    await service.addComment(VIEWER, "m1", "hello");
    const projection = JSON.stringify(tx.momentComment.create.mock.calls[0][0]);
    for (const forbidden of ["email", "passwordHash", "isAdmin", "handle", "token"]) {
      expect(projection).not.toContain(forbidden);
    }
  });

  it("空内容与纯空白 -> EMPTY_COMMENT，且不写库", async () => {
    const { prisma, tx } = makePrisma();
    const { service } = makeService(prisma);
    await expect(service.addComment(VIEWER, "m1", "   ")).rejects.toMatchObject({ code: "EMPTY_COMMENT" });
    expect(tx.momentComment.create).not.toHaveBeenCalled();
  });

  it("超长内容截断到 500（列宽上限）", async () => {
    const { prisma, tx } = makePrisma();
    const { service } = makeService(prisma);
    await service.addComment(VIEWER, "m1", "x".repeat(900));
    const args = tx.momentComment.create.mock.calls[0][0] as { data: { content: string } };
    expect(args.data.content.length).toBe(500);
  });

  it("SafetyService 判定 HIGH -> COMMENT_BLOCKED，且不写库", async () => {
    const { prisma, tx } = makePrisma();
    const { service, safety } = makeService(prisma, { blocked: false, level: "HIGH" });
    await expect(service.addComment(VIEWER, "m1", "make money fast")).rejects.toMatchObject({
      code: "COMMENT_BLOCKED",
    });
    expect(safety.scanText).toHaveBeenCalledWith("make money fast");
    expect(tx.momentComment.create).not.toHaveBeenCalled();
    expect(tx.moment.update).not.toHaveBeenCalled();
  });

  it("SafetyService 判定 blocked -> COMMENT_BLOCKED，且不写库", async () => {
    const { prisma, tx } = makePrisma();
    const { service } = makeService(prisma, { blocked: true, level: "LOW" });
    await expect(service.addComment(VIEWER, "m1", "blocked words")).rejects.toMatchObject({
      code: "COMMENT_BLOCKED",
    });
    expect(tx.momentComment.create).not.toHaveBeenCalled();
  });

  it("MEDIUM 信号不拦写（只记录，MVP 不阻断）", async () => {
    const { prisma, tx } = makePrisma();
    const { service } = makeService(prisma, { blocked: false, level: "MEDIUM" });
    await expect(service.addComment(VIEWER, "m1", "见 https://example.com")).resolves.toBeTruthy();
    expect(tx.momentComment.create).toHaveBeenCalledTimes(1);
  });

  it("不存在的动态 -> null", async () => {
    const { prisma } = makePrisma({ moment: null });
    const { service } = makeService(prisma);
    await expect(service.addComment(VIEWER, "missing", "hi")).resolves.toBeNull();
    expect(prisma.momentSetting.findUnique).not.toHaveBeenCalled();
  });

  it("private + 陌生人 -> MOMENT_LOCKED，且不写库", async () => {
    const { prisma, tx } = makePrisma({ authorSetting: { visibleTo: "private" } });
    const { service } = makeService(prisma);
    await expect(service.addComment(VIEWER, "m1", "hi")).rejects.toMatchObject({
      code: "MOMENT_LOCKED",
      status: 403,
    });
    expect(tx.momentComment.create).not.toHaveBeenCalled();
  });

  it("Block 压过 everyone -> MOMENT_LOCKED，且不写库", async () => {
    const { prisma, tx } = makePrisma({ blocked: { id: "b1" } });
    const { service } = makeService(prisma);
    await expect(service.addComment(VIEWER, "m1", "hi")).rejects.toMatchObject({ code: "MOMENT_LOCKED" });
    expect(tx.momentComment.create).not.toHaveBeenCalled();
  });

  it("ACTIVE 连接可以评论 connections-only 的动态", async () => {
    const { prisma } = makePrisma({ authorSetting: { visibleTo: "connections" }, connected: { id: "conn" } });
    const { service } = makeService(prisma);
    await expect(service.addComment(VIEWER, "m1", "hi")).resolves.toBeTruthy();
  });

  it("给别人评论发通知，给自己的动态评论不发", async () => {
    const other = makePrisma();
    await makeService(other.prisma).service.addComment(VIEWER, "m1", "hi");
    expect(other.prisma.notification.create).toHaveBeenCalledTimes(1);
    // A top-level comment is still a MOMENT_COMMENT aimed at the moment; the
    // reply path (MOMENT_REPLY, aimed at a comment) is a separate branch.
    const row = other.prisma.notification.create.mock.calls[0][0].data;
    expect(row.userId).toBe(AUTHOR);
    expect(row.type).toBe("MOMENT_COMMENT");
    expect(JSON.parse(row.data)).toMatchObject({ targetType: "MOMENT", targetId: "m1" });

    const own = makePrisma({ moment: { id: "m1", userId: VIEWER } });
    await makeService(own.prisma).service.addComment(VIEWER, "m1", "hi");
    expect(own.prisma.notification.create).not.toHaveBeenCalled();
  });
});

/**
 * PC-2.3.2 — replies.
 *
 * The self-FK only proves the parent *exists*. Three further rules are enforced
 * in the service, and each one gets its own case here so a regression in any of
 * them cannot hide behind the other two: the parent must belong to this moment,
 * it must itself be top-level, and it must be reachable (Moment access + Block).
 */
describe("MomentsService.addComment — 回复", () => {
  const PARENT = "3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
  /** The parent comment's author — never `AUTHOR`, so the two are told apart. */
  const PARENT_AUTHOR = "parent-author";
  const topLevelParent = {
    id: PARENT,
    momentId: "m1",
    parentCommentId: null,
    userId: PARENT_AUTHOR,
  };

  it("回复一级评论：写入 parentCommentId，返回作者，commentCount 不变", async () => {
    const { prisma, tx } = makePrisma({ parent: topLevelParent });
    const { service } = makeService(prisma);
    const result = await service.addComment(VIEWER, "m1", "  我也是，准备下个月去。  ", PARENT);

    expect(result).toEqual(makeRow("我也是，准备下个月去。", PARENT));
    expect(result?.user).toEqual({ id: VIEWER, nickname: "Viewer", avatarUrl: null });
    const args = tx.momentComment.create.mock.calls[0][0] as {
      data: { momentId: string; userId: string; content: string; parentCommentId: string | null };
    };
    expect(args.data).toEqual({
      momentId: "m1",
      userId: VIEWER,
      content: "我也是，准备下个月去。",
      parentCommentId: PARENT,
    });
    // 计数语义锁定为「一级评论数量」：回复不递增。
    expect(tx.moment.update).not.toHaveBeenCalled();
  });

  it("父评论校验发生在新行写入之前，且与写入同处一个事务", async () => {
    const { prisma, tx } = makePrisma({ parent: topLevelParent });
    await makeService(prisma).service.addComment(VIEWER, "m1", "hi", PARENT);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.momentComment.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
      tx.momentComment.create.mock.invocationCallOrder[0],
    );
  });

  it("父评论不存在 -> COMMENT_PARENT_INVALID，且不写库", async () => {
    const { prisma, tx } = makePrisma({ parent: null });
    await expect(makeService(prisma).service.addComment(VIEWER, "m1", "hi", PARENT)).rejects.toMatchObject({
      code: "COMMENT_PARENT_INVALID",
    });
    expect(tx.momentComment.create).not.toHaveBeenCalled();
    expect(tx.moment.update).not.toHaveBeenCalled();
  });

  it("父评论属于其它动态 -> COMMENT_PARENT_INVALID（跨 Moment 阻断）", async () => {
    const { prisma, tx } = makePrisma({ parent: { id: PARENT, momentId: "m2", parentCommentId: null } });
    await expect(makeService(prisma).service.addComment(VIEWER, "m1", "hi", PARENT)).rejects.toMatchObject({
      code: "COMMENT_PARENT_INVALID",
    });
    expect(tx.momentComment.create).not.toHaveBeenCalled();
  });

  it("父评论本身已是回复 -> COMMENT_PARENT_INVALID（只允许一层）", async () => {
    const { prisma, tx } = makePrisma({ parent: { id: PARENT, momentId: "m1", parentCommentId: "c-root" } });
    await expect(makeService(prisma).service.addComment(VIEWER, "m1", "hi", PARENT)).rejects.toMatchObject({
      code: "COMMENT_PARENT_INVALID",
    });
    expect(tx.momentComment.create).not.toHaveBeenCalled();
  });

  it("无权访问的动态：连父评论都不读，更不写库", async () => {
    const { prisma, tx } = makePrisma({ authorSetting: { visibleTo: "private" }, parent: topLevelParent });
    await expect(makeService(prisma).service.addComment(VIEWER, "m1", "hi", PARENT)).rejects.toMatchObject({
      code: "MOMENT_LOCKED",
      status: 403,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.momentComment.findUnique).not.toHaveBeenCalled();
    expect(tx.momentComment.create).not.toHaveBeenCalled();
  });

  it("Block 的用户不能借 parentCommentId 创建回复", async () => {
    const { prisma, tx } = makePrisma({ blocked: { id: "b1" }, parent: topLevelParent });
    await expect(makeService(prisma).service.addComment(VIEWER, "m1", "hi", PARENT)).rejects.toMatchObject({
      code: "MOMENT_LOCKED",
      status: 403,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.momentComment.create).not.toHaveBeenCalled();
  });

  it("空回复 -> EMPTY_COMMENT，且不读父评论、不写库", async () => {
    const { prisma, tx } = makePrisma({ parent: topLevelParent });
    await expect(makeService(prisma).service.addComment(VIEWER, "m1", "   ", PARENT)).rejects.toMatchObject({
      code: "EMPTY_COMMENT",
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.momentComment.findUnique).not.toHaveBeenCalled();
  });

  it("Safety HIGH 的回复被拒绝，不落库也不动计数", async () => {
    const { prisma, tx } = makePrisma({ parent: topLevelParent });
    const { service, safety } = makeService(prisma, { blocked: false, level: "HIGH" });
    await expect(service.addComment(VIEWER, "m1", "make money fast", PARENT)).rejects.toMatchObject({
      code: "COMMENT_BLOCKED",
    });
    expect(safety.scanText).toHaveBeenCalledWith("make money fast");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.momentComment.create).not.toHaveBeenCalled();
    expect(tx.moment.update).not.toHaveBeenCalled();
  });

  it("Safety blocked 的回复被拒绝，不落库", async () => {
    const { prisma, tx } = makePrisma({ parent: topLevelParent });
    const { service } = makeService(prisma, { blocked: true, level: "LOW" });
    await expect(service.addComment(VIEWER, "m1", "blocked words", PARENT)).rejects.toMatchObject({
      code: "COMMENT_BLOCKED",
    });
    expect(tx.momentComment.create).not.toHaveBeenCalled();
  });

  it("回复通知父评论作者，而不是动态作者", async () => {
    const { prisma } = makePrisma({ parent: topLevelParent });
    await makeService(prisma).service.addComment(VIEWER, "m1", "hi", PARENT);

    // Exactly one message, and it is addressed to the person who wrote the
    // comment being answered — `AUTHOR` owns the moment but not this thread.
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    const row = prisma.notification.create.mock.calls[0][0].data;
    expect(row.userId).toBe(PARENT_AUTHOR);
    expect(row.type).toBe("MOMENT_REPLY");
  });

  it("回复的 data 指向父评论，并带上 momentId / commentId", async () => {
    const { prisma } = makePrisma({ parent: topLevelParent });
    await makeService(prisma).service.addComment(VIEWER, "m1", "hi", PARENT);

    const row = prisma.notification.create.mock.calls[0][0].data;
    expect(JSON.parse(row.data)).toEqual({
      actorId: VIEWER,
      targetType: "COMMENT",
      targetId: PARENT,
      momentId: "m1",
      commentId: "c-new",
      parentCommentId: PARENT,
    });
    expect(row.body).toBe("hi");
  });

  it("回复自己的评论不发通知（self suppression 归 NotificationService）", async () => {
    const { prisma } = makePrisma({
      parent: { ...topLevelParent, userId: VIEWER },
    });
    await makeService(prisma).service.addComment(VIEWER, "m1", "hi", PARENT);

    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it("在自己的动态下回复别人的评论：通知对方，且不发 MOMENT_COMMENT", async () => {
    const { prisma } = makePrisma({
      moment: { id: "m1", userId: VIEWER },
      parent: topLevelParent,
    });
    await makeService(prisma).service.addComment(VIEWER, "m1", "hi", PARENT);

    // The author of the moment is the replier, so there is nobody else to tell
    // about the moment — but the comment's author is still owed a reply notice.
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    const row = prisma.notification.create.mock.calls[0][0].data;
    expect(row.userId).toBe(PARENT_AUTHOR);
    expect(row.type).toBe("MOMENT_REPLY");
  });

  it("通知写库失败时，回复仍然成功并且已经写入", async () => {
    const { prisma, tx } = makePrisma({ parent: topLevelParent });
    prisma.notification.create.mockRejectedValueOnce(new Error("notification table unavailable"));

    // The reply is the real work; a notification is best-effort. `notify`
    // swallows the failure, so the write that already committed stands.
    await expect(
      makeService(prisma).service.addComment(VIEWER, "m1", "hi", PARENT),
    ).resolves.toEqual(makeRow("hi", PARENT));
    expect(tx.momentComment.create).toHaveBeenCalledTimes(1);
  });
});

/**
 * PC-2.4 — pagination.
 *
 * A page is a slice of top-level comments, and replies ride along with their
 * parent so a thread can never be split across a boundary. `skip` is asserted
 * directly because "page 2 looked different" is equally satisfied by a query
 * that forgot to offset at all.
 */
describe("MomentsService.listComments — 分页", () => {
  const row = {
    id: "c1",
    content: "hi",
    createdAt: new Date("2026-09-19T00:00:00.000Z"),
    user: { id: "u1", nickname: "A", avatarUrl: null },
  };
  const findArgs = (prisma: ReturnType<typeof makePrisma>["prisma"], index: number) =>
    prisma.momentComment.findMany.mock.calls[index][0] as { skip: number; take: number; where: unknown };

  it("第 1 页不带 skip，第 2 页从 pageSize 起跳", async () => {
    const { prisma } = makePrisma({ comments: [row], total: 25 });
    const { service } = makeService(prisma);
    await service.listComments(VIEWER, "m1", 1, 10);
    await service.listComments(VIEWER, "m1", 2, 10);

    expect(findArgs(prisma, 0)).toMatchObject({ skip: 0, take: 10 });
    expect(findArgs(prisma, 1)).toMatchObject({ skip: 10, take: 10 });
  });

  it("count 与 findMany 过滤同一批一级评论", async () => {
    const { prisma } = makePrisma({ comments: [row], total: 25 });
    const { service } = makeService(prisma);
    await service.listComments(VIEWER, "m1", 2, 10);

    expect((prisma.momentComment.count.mock.calls[0][0] as { where: unknown }).where).toEqual({
      momentId: "m1",
      parentCommentId: null,
    });
    expect(findArgs(prisma, 0).where).toEqual({ momentId: "m1", parentCommentId: null });
  });

  it("total / totalPages 交给前端推导「还有下一页」", async () => {
    const { prisma } = makePrisma({ comments: [row], total: 25 });
    const { service } = makeService(prisma);
    const first = await service.listComments(VIEWER, "m1", 1, 10);
    const last = await service.listComments(VIEWER, "m1", 3, 10);

    expect(first).toMatchObject({ total: 25, page: 1, pageSize: 10, totalPages: 3 });
    expect(first?.items).toEqual([row]);
    // 第 3 页是最后一页：page < totalPages 为假，前端因此不再显示按钮。
    expect(last).toMatchObject({ total: 25, page: 3, totalPages: 3 });
  });

  it("最后一页之后没有更多：空页仍然回答正确的元数据", async () => {
    const { prisma } = makePrisma({ comments: [], total: 21 });
    const { service } = makeService(prisma);
    await expect(service.listComments(VIEWER, "m1", 2, 20)).resolves.toEqual({
      items: [],
      total: 21,
      page: 2,
      pageSize: 20,
      totalPages: 2,
    });
  });

  it("排序保持 createdAt 升序，翻页不会重排", async () => {
    const { prisma } = makePrisma();
    const { service } = makeService(prisma);
    await service.listComments(VIEWER, "m1", 2, 10);
    expect((prisma.momentComment.findMany.mock.calls[0][0] as { orderBy: unknown }).orderBy).toEqual({
      createdAt: "asc",
    });
  });

  it("replies 不占 pageSize：一次查询取回整页，不做 N+1", async () => {
    const { prisma } = makePrisma({ total: 40 });
    const { service } = makeService(prisma);
    await service.listComments(VIEWER, "m1", 1, 20);
    const args = findArgs(prisma, 0) as unknown as { select: { replies?: unknown } };
    expect(args.select.replies).toBeDefined();
    expect(prisma.momentComment.findMany).toHaveBeenCalledTimes(1);
  });

  it("被 Block 的观众连 count 都不会触发", async () => {
    const { prisma } = makePrisma({ blocked: { id: "b1" } });
    const { service } = makeService(prisma);
    await expect(service.listComments(VIEWER, "m1", 1, 20)).rejects.toMatchObject({ code: "MOMENT_LOCKED" });
    expect(prisma.momentComment.count).not.toHaveBeenCalled();
  });
});

/**
 * PC-2.4 — deletion.
 *
 * The comment id is caller-supplied, so the service reads the row back and
 * compares it against the JWT user *and* the moment named in the path before
 * removing anything. Replies are left to the self-relation's ON DELETE CASCADE
 * rather than being deleted by hand, and the counter follows a top-level delete
 * only.
 */
describe("MomentsService.deleteComment", () => {
  const TOP = { id: "c1", momentId: "m1", userId: VIEWER, parentCommentId: null };
  const REPLY = { id: "c2", momentId: "m1", userId: VIEWER, parentCommentId: "c1" };

  it("删除自己的一级评论：先删行，再在同一事务里把 commentCount 减一", async () => {
    const { prisma, tx } = makePrisma({ comment: TOP });
    const result = await makeService(prisma).service.deleteComment(VIEWER, "m1", "c1");

    expect(result).toEqual({ deleted: true, parentCommentId: null });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.momentComment.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
    expect(tx.moment.updateMany).toHaveBeenCalledWith({
      where: { id: "m1", commentCount: { gt: 0 } },
      data: { commentCount: { decrement: 1 } },
    });
    expect(tx.momentComment.delete.mock.invocationCallOrder[0]).toBeLessThan(
      tx.moment.updateMany.mock.invocationCallOrder[0],
    );
  });

  it("replies 交给数据库级联：服务只删父行一次", async () => {
    const { prisma, tx } = makePrisma({ comment: TOP });
    await makeService(prisma).service.deleteComment(VIEWER, "m1", "c1");
    // ON DELETE CASCADE 由 Schema 保证，多删一次反而会掩盖级联是否真的存在。
    expect(tx.momentComment.delete).toHaveBeenCalledTimes(1);
  });

  it("删除自己的回复：不改 commentCount", async () => {
    const { prisma, tx } = makePrisma({ comment: REPLY });
    const result = await makeService(prisma).service.deleteComment(VIEWER, "m1", "c2");

    expect(result).toEqual({ deleted: true, parentCommentId: "c1" });
    expect(tx.momentComment.delete).toHaveBeenCalledWith({ where: { id: "c2" } });
    expect(tx.moment.updateMany).not.toHaveBeenCalled();
  });

  it("不能删除别人的评论 -> COMMENT_FORBIDDEN，且不删行", async () => {
    const { prisma, tx } = makePrisma({ comment: { ...TOP, userId: "someone-else" } });
    await expect(makeService(prisma).service.deleteComment(VIEWER, "m1", "c1")).rejects.toMatchObject({
      code: "COMMENT_FORBIDDEN",
    });
    expect(tx.momentComment.delete).not.toHaveBeenCalled();
    expect(tx.moment.updateMany).not.toHaveBeenCalled();
  });

  it("评论属于其它动态 -> COMMENT_NOT_FOUND（跨 Moment 阻断）", async () => {
    const { prisma, tx } = makePrisma({ comment: { ...TOP, momentId: "m2" } });
    await expect(makeService(prisma).service.deleteComment(VIEWER, "m1", "c1")).rejects.toMatchObject({
      code: "COMMENT_NOT_FOUND",
    });
    expect(tx.momentComment.delete).not.toHaveBeenCalled();
  });

  it("评论不存在 -> COMMENT_NOT_FOUND，且不写库", async () => {
    const { prisma, tx } = makePrisma({ comment: null });
    await expect(makeService(prisma).service.deleteComment(VIEWER, "m1", "missing")).rejects.toMatchObject({
      code: "COMMENT_NOT_FOUND",
    });
    expect(tx.momentComment.delete).not.toHaveBeenCalled();
    expect(tx.moment.updateMany).not.toHaveBeenCalled();
  });

  it("不存在的动态 -> null，且不读评论、不开事务", async () => {
    const { prisma, tx } = makePrisma({ moment: null, comment: TOP });
    await expect(makeService(prisma).service.deleteComment(VIEWER, "missing", "c1")).resolves.toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.momentComment.findUnique).not.toHaveBeenCalled();
  });

  it("无权访问的动态 -> MOMENT_LOCKED，且不读评论、不删行", async () => {
    const { prisma, tx } = makePrisma({ authorSetting: { visibleTo: "private" }, comment: TOP });
    await expect(makeService(prisma).service.deleteComment(VIEWER, "m1", "c1")).rejects.toMatchObject({
      code: "MOMENT_LOCKED",
      status: 403,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.momentComment.delete).not.toHaveBeenCalled();
  });

  it("Block 的用户不能删除动态下的评论", async () => {
    const { prisma, tx } = makePrisma({ blocked: { id: "b1" }, comment: TOP });
    await expect(makeService(prisma).service.deleteComment(VIEWER, "m1", "c1")).rejects.toMatchObject({
      code: "MOMENT_LOCKED",
      status: 403,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.momentComment.delete).not.toHaveBeenCalled();
  });

  it("失败路径不产生任何计数变化", async () => {
    const { prisma, tx } = makePrisma({ comment: { ...TOP, userId: "someone-else" } });
    await expect(makeService(prisma).service.deleteComment(VIEWER, "m1", "c1")).rejects.toMatchObject({
      code: "COMMENT_FORBIDDEN",
    });
    expect(tx.moment.updateMany).not.toHaveBeenCalled();
    expect(tx.moment.update).not.toHaveBeenCalled();
  });

  it("计数守卫是原子的：一条带 gt 0 条件的更新，没有读-改-写", async () => {
    const { prisma, tx } = makePrisma({ comment: TOP });
    await makeService(prisma).service.deleteComment(VIEWER, "m1", "c1");

    expect(tx.moment.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.moment.update).not.toHaveBeenCalled();
    const args = tx.moment.updateMany.mock.calls[0][0] as { where: { commentCount?: { gt?: number } } };
    expect(args.where.commentCount?.gt).toBe(0);
  });

  it("读回的行只取判定归属所需的列，不泄露内部字段", async () => {
    const { prisma, tx } = makePrisma({ comment: TOP });
    await makeService(prisma).service.deleteComment(VIEWER, "m1", "c1");

    const args = tx.momentComment.findUnique.mock.calls[0][0] as { select: Record<string, unknown> };
    expect(Object.keys(args.select).sort()).toEqual(["id", "momentId", "parentCommentId", "userId"]);
    const projection = JSON.stringify(args.select);
    for (const forbidden of ["email", "passwordHash", "isAdmin", "handle", "content", "nickname", "avatarUrl"]) {
      expect(projection).not.toContain(forbidden);
    }
  });
});
