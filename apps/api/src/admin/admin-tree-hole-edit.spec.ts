import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AdminService } from "./admin.service";

/**
 * 后台对树洞内容的改写与撤销（2026-11-18）。
 *
 * 这一组断言盯的是「审核不能变成无声改写」：
 *
 * 1. 改内容时，**旧的那一版必须进修订表**；只更新正文而不留痕，等于篡改用户发言。
 * 2. 内容没变就不写修订（否则每点一次保存就多一条假历史）。
 * 3. 删除是软删，要记下是谁删的；恢复要把这几个字段清干净。
 */
describe("AdminService · 树洞编辑与撤销", () => {
  const POST = "11111111-1111-1111-1111-111111111111";
  const COMMENT = "22222222-2222-2222-2222-222222222222";
  const ADMIN = "33333333-3333-3333-3333-333333333333";

  function build(overrides: Record<string, unknown> = {}) {
    const prisma = {
      treeHolePost: {
        findUnique: jest.fn(async () => ({ id: POST, content: "原来的内容" })),
        update: jest.fn(async () => ({})),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      treeHoleComment: {
        findUnique: jest.fn(async () => ({ id: COMMENT, content: "原来的评论" })),
        findFirst: jest.fn(async () => ({ id: COMMENT, postId: POST })),
        update: jest.fn(async () => ({})),
      },
      treeHoleRevision: {
        create: jest.fn(async () => ({})),
        findMany: jest.fn(async () => [
          { id: "r1", content: "更早的版本", editorId: ADMIN, createdAt: new Date() },
        ]),
      },
      // 生产代码用的是数组形式的事务，mock 里直接并发执行即可。
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
      ...overrides,
    };
    return { prisma, service: new AdminService(prisma as never) };
  }

  it("改帖子：旧内容进修订表，正文和 editedAt/editedBy 一起更新", async () => {
    const { prisma, service } = build();

    await expect(service.updateTreeHolePost(POST, "  改过的内容  ", ADMIN)).resolves.toEqual({
      id: POST,
      edited: true,
    });

    expect(prisma.treeHoleRevision.create).toHaveBeenCalledWith({
      data: { postId: POST, content: "原来的内容", editorId: ADMIN },
    });
    expect(prisma.treeHolePost.update).toHaveBeenCalledWith({
      where: { id: POST },
      data: expect.objectContaining({ content: "改过的内容", editedBy: ADMIN }),
    });
  });

  it("内容没变：不写修订（重复保存不该刷出一串假历史）", async () => {
    const { prisma, service } = build();

    await expect(service.updateTreeHolePost(POST, "原来的内容", ADMIN)).resolves.toEqual({
      id: POST,
      edited: false,
    });
    expect(prisma.treeHoleRevision.create).not.toHaveBeenCalled();
  });

  it("空内容 / 超长：400，且什么都不写", async () => {
    const { prisma, service } = build();

    await expect(service.updateTreeHolePost(POST, "   ", ADMIN)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.updateTreeHolePost(POST, "x".repeat(501), ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.treeHoleRevision.create).not.toHaveBeenCalled();
  });

  it("改评论：同样留痕，上限按评论的 300 字", async () => {
    const { prisma, service } = build();

    await expect(service.updateTreeHoleComment(COMMENT, "改过的评论", ADMIN)).resolves.toEqual({
      id: COMMENT,
      edited: true,
    });
    expect(prisma.treeHoleRevision.create).toHaveBeenCalledWith({
      data: { commentId: COMMENT, content: "原来的评论", editorId: ADMIN },
    });
    await expect(
      service.updateTreeHoleComment(COMMENT, "x".repeat(301), ADMIN),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("删帖记下是谁删的（软删，行不消失）", async () => {
    const { prisma, service } = build({
      treeHoleComment: { findMany: jest.fn(async () => []), findFirst: jest.fn() },
      treeHoleReport: { updateMany: jest.fn(async () => ({ count: 0 })) },
      treeHolePost: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    });

    await service.deleteTreeHolePost(POST, ADMIN);

    expect(prisma.treeHolePost.updateMany).toHaveBeenCalledWith({
      where: { id: POST, deletedAt: null },
      data: { deletedAt: expect.any(Date), deletedBy: ADMIN },
    });
  });

  it("恢复：清掉 deletedAt / deletedBy；本来就没删的给 404", async () => {
    const { service } = build();
    await expect(service.restoreTreeHolePost(POST)).resolves.toEqual({ id: POST, restored: true });

    const notDeleted = build({
      treeHolePost: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    });
    await expect(notDeleted.service.restoreTreeHolePost(POST)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("修改记录：按目标查，最新在前", async () => {
    const { prisma, service } = build();

    const result = await service.listTreeHoleRevisions({ postId: POST });

    expect(prisma.treeHoleRevision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { postId: POST },
        orderBy: { createdAt: "desc" },
      }),
    );
    expect(result.items).toHaveLength(1);
    // 两个 id 都不给时不该查库。
    await service.listTreeHoleRevisions({});
    expect(prisma.treeHoleRevision.findMany).toHaveBeenCalledTimes(1);
  });
});
