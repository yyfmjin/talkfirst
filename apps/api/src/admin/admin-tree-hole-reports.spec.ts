import { AdminService } from "./admin.service";

/**
 * 树洞举报的队列语义（2026-11-18）。
 *
 * 这一轮的三个决定都值得钉住，因为每一个都有「看起来更简单」的错做法：
 *
 * 1. **只数待处置的**。处置过的举报留在表里当审核历史，但不能再占队列 ——
 *    否则「处置」按钮点完什么都没变。
 * 2. **筛选在分页之前**。`reported=1` 必须先把有举报的帖子挑出来再分页；
 *    反过来做（先分页再过滤）会出现「这一页只剩两条」这种坏掉的翻页。
 * 3. **处置 ≠ 删除**。误报和情绪举报很常见，处理它们不该逼着管理员删内容。
 */
describe("AdminService · 树洞举报队列", () => {
  const ADMIN = "99999999-9999-9999-9999-999999999999";
  const POST_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const POST_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const COMMENT_A = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  function build() {
    const prisma = {
      treeHoleReport: {
        groupBy: jest.fn(async ({ by }: { by: string[] }) =>
          by[0] === "postId"
            ? [{ postId: POST_A, _count: { _all: 2 } }]
            : [{ commentId: COMMENT_A, _count: { _all: 1 } }],
        ),
        findMany: jest.fn(async () => [
          { postId: POST_A, reason: "SPAM" },
          { postId: POST_A, reason: "HARASSMENT" },
          { postId: POST_A, reason: "SPAM" },
        ]),
        count: jest.fn(async () => 2),
        // 带一个形参，否则 jest 推成空元组，`mock.calls[0][0]` 取不到东西。
        updateMany: jest.fn(async (_args: unknown) => ({ count: 3 })),
      },
      treeHolePost: {
        findMany: jest.fn(async () => [
          {
            id: POST_A,
            alias: "树友·AAAA",
            content: "被举报的那条",
            commentCount: 1,
            createdAt: new Date(),
            user: { id: "u1", email: "a@example.com", nickname: null, status: "ACTIVE" },
          },
        ]),
        count: jest.fn(async () => 1),
      },
      treeHoleComment: {
        findMany: jest.fn(async () => [{ id: COMMENT_A }]),
      },
    };
    // 构造函数只有 prisma 是必填（其余两个是为了手搓 service 的 spec 才做成可选）。
    const service = new AdminService(prisma as never);
    return { prisma, service };
  }

  it("列表带上举报数与理由，并给出待处置总数", async () => {
    const { service } = build();

    const data = (await service.listTreeHolePosts()) as {
      items: Array<{ reportCount: number; reportReasons: string[] }>;
      reportedTotal: number;
    };

    expect(data.items[0].reportCount).toBe(2);
    // 去重：同一个人举报两次 SPAM 不该显示两个 SPAM。
    expect(data.items[0].reportReasons).toEqual(["SPAM", "HARASSMENT"]);
    expect(data.reportedTotal).toBe(1);
  });

  it("只看被举报：先把范围收窄到有举报的帖子，再取这一页", async () => {
    const { prisma, service } = build();

    await service.listTreeHolePosts({ reportedOnly: true });

    expect(prisma.treeHolePost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null, id: { in: [POST_A] } }),
      }),
    );
  });

  it("处置一条帖子：把它和它下面评论的举报一起结掉，并记下是谁点的", async () => {
    const { prisma, service } = build();

    await expect(service.resolveTreeHoleReports({ postId: POST_A }, ADMIN)).resolves.toEqual({
      resolved: 3,
    });

    const call = prisma.treeHoleReport.updateMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(call.where).toEqual({
      resolvedAt: null,
      OR: [{ postId: POST_A }, { commentId: { in: [COMMENT_A] } }],
    });
    expect(call.data.resolvedBy).toBe(ADMIN);
    expect(call.data.resolvedAt).toBeInstanceOf(Date);
  });

  it("既没有帖子也没有评论：不动任何数据", async () => {
    const { prisma, service } = build();

    await expect(service.resolveTreeHoleReports({}, ADMIN)).resolves.toEqual({ resolved: 0 });
    expect(prisma.treeHoleReport.updateMany).not.toHaveBeenCalled();
  });
});
