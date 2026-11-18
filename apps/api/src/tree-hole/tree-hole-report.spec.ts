import { BadRequestException } from "@nestjs/common";
import { SafetyService } from "../safety/safety.service";
import { TreeHoleService } from "./tree-hole.service";

/**
 * 匿名板的准入与举报（2026-11-13）。
 *
 * 这一页的规矩和实名信息流不一样，值得钉住：
 *
 * 1. **拒绝而不是隐藏**。命中外链/联系方式/高危内容时直接 400：匿名板没有
 *    「已发出但别人看不到」这个状态可讲，藏起来作者只会以为没发出去而反复重发。
 * 2. 同一个人对同一条内容只记一次举报。重复点不该把队列刷成一串同一个理由，
 *    更不能让一个人反复点看起来像「很多人不满」。
 * 3. 举报必须指向帖子或评论之一。两个都不给就是 400，不能落一条没有目标的记录。
 */
describe("TreeHoleService", () => {
  const USER = "11111111-1111-1111-1111-111111111111";
  const POST = "22222222-2222-2222-2222-222222222222";

  function build(existingReport: unknown = null) {
    const prisma = {
      treeHolePost: {
        findFirst: jest.fn().mockResolvedValue({ id: POST }),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      },
      treeHoleReport: {
        findFirst: jest.fn().mockResolvedValue(existingReport),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new TreeHoleService(prisma as never, new SafetyService(prisma as never));
    return { prisma, service };
  }

  it("含电话号码：400 TREE_HOLE_CONTENT_REJECTED，且不写库", async () => {
    const { prisma, service } = build();

    await expect(service.create(USER, "有人吗，加我微信 13800138000 聊")).rejects.toMatchObject({
      response: { error: { code: "TREE_HOLE_CONTENT_REJECTED" } },
    });
    expect(prisma.treeHolePost.create).not.toHaveBeenCalled();
  });

  it("普通内容：照常入库，并对齐别名", async () => {
    const { prisma, service } = build();

    const created = (await service.create(USER, "  今天食堂的番茄炒蛋居然有番茄  ")) as {
      content: string;
      alias: string;
    };

    expect(created.content).toBe("今天食堂的番茄炒蛋居然有番茄");
    expect(created.alias).toMatch(/^树友·[0-9A-F]{4}$/);
    expect(prisma.treeHolePost.create).toHaveBeenCalledTimes(1);
  });

  it("首次举报：落一条记录", async () => {
    const { prisma, service } = build(null);

    await expect(service.report(USER, { postId: POST, reason: "SPAM" })).resolves.toEqual({
      reported: true,
      duplicate: false,
    });
    expect(prisma.treeHoleReport.create).toHaveBeenCalledWith({
      data: { postId: POST, commentId: null, reporterId: USER, reason: "SPAM" },
    });
  });

  it("重复举报：告诉你收到了，但不再记一条", async () => {
    const { prisma, service } = build({ id: "existing" });

    await expect(service.report(USER, { postId: POST, reason: "SPAM" })).resolves.toEqual({
      reported: true,
      duplicate: true,
    });
    expect(prisma.treeHoleReport.create).not.toHaveBeenCalled();
  });

  it("既没有帖子也没有评论：400，不落无目标的记录", async () => {
    const { prisma, service } = build(null);

    await expect(service.report(USER, { reason: "SPAM" })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.treeHoleReport.create).not.toHaveBeenCalled();
  });
});
