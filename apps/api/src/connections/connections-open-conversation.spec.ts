import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ConnectionsService } from "./connections.service";

/**
 * 「从好友列表进聊天」的服务端约定（2026-11-13）。
 *
 * 这里的四件事都是**真会发生**的边界，不是假想：
 *
 * 1. 会话被「删掉聊天框」隐藏过 —— 成员行还带着 `hiddenAt`。不恢复的话，
 *    用户点进去看到的是对话，但列表里那条仍然不存在，等于点了没反应。
 * 2. `Connection.conversationId` 为 null（会话此前被删干净）—— 必须补建，
 *    不能 500，也不能返回一个空字符串让客户端去拼 URL。
 * 3. 不是好友 —— 403。不能因为「他恰好知道 peerId」就给一个会话 id。
 * 4. 跟自己 —— 400。这条挡在好友判断之前，因为它不依赖任何关系数据。
 */
describe("ConnectionsService.openConversation", () => {
  const USER = "11111111-1111-1111-1111-111111111111";
  const PEER = "22222222-2222-2222-2222-222222222222";
  const CONV = "33333333-3333-3333-3333-333333333333";
  const NEW_CONV = "44444444-4444-4444-4444-444444444444";

  function build(connection: unknown) {
    const tx = {
      conversation: { create: jest.fn().mockResolvedValue({ id: NEW_CONV }) },
      conversationMember: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      connection: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      connection: {
        findFirst: jest.fn().mockResolvedValue(connection),
        update: jest.fn().mockResolvedValue({}),
      },
      conversationMember: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    const service = new ConnectionsService(
      prisma as never,
      {} as never,
      {} as never,
    );
    return { prisma, tx, service };
  }

  it("跟自己聊：400 SELF_CONVERSATION，且不查好友关系", async () => {
    const { prisma, service } = build({ id: "c1", conversationId: CONV });

    await expect(service.openConversation(USER, USER)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.connection.findFirst).not.toHaveBeenCalled();
  });

  it("不是好友：403 NOT_CONNECTED", async () => {
    const { service } = build(null);

    await expect(service.openConversation(USER, PEER)).rejects.toMatchObject({
      response: { error: { code: "NOT_CONNECTED" } },
    });
    await expect(service.openConversation(USER, PEER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("已有会话：返回它，并把被隐藏的成员行恢复出来", async () => {
    const { prisma, service } = build({ id: "c1", conversationId: CONV });

    await expect(service.openConversation(USER, PEER)).resolves.toEqual({ conversationId: CONV });

    // 顺序无关，但这两件事都必须发生：找到关系 → 清掉自己这侧的 hiddenAt。
    expect(prisma.connection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "ACTIVE",
          OR: [
            { userAId: USER, userBId: PEER },
            { userAId: PEER, userBId: USER },
          ],
        }),
      }),
    );
    expect(prisma.conversationMember.updateMany).toHaveBeenCalledWith({
      where: { conversationId: CONV, userId: USER },
      data: { hiddenAt: null },
    });
  });

  it("会话被删空过：补建一条、挂上两个成员、把连接指过去", async () => {
    const { prisma, tx, service } = build({ id: "c1", conversationId: null });

    await expect(service.openConversation(USER, PEER)).resolves.toEqual({ conversationId: NEW_CONV });

    expect(tx.conversation.create).toHaveBeenCalledTimes(1);
    expect(tx.conversationMember.createMany).toHaveBeenCalledWith({
      data: [
        { conversationId: NEW_CONV, userId: USER },
        { conversationId: NEW_CONV, userId: PEER },
      ],
    });
    expect(tx.connection.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { conversationId: NEW_CONV },
    });
    // 已经有会话可恢复时不该再建新的。
    expect(prisma.conversationMember.updateMany).not.toHaveBeenCalled();
  });
});
