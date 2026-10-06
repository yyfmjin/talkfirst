import { NotificationService, messageDedupeKey } from "./notification.service";

/**
 * 聊天消息的合并（2026-10-06）。
 *
 * 需求：同一个人连发三条消息，收件人只应看到**一条**通知，并且带上「几条」。
 * 线上实测那三条是 21:04:15 / 21:04:35 / 21:04:42，其中两条来自同一发送者。
 *
 * 这一组钉住合并规则的五个面：
 *   1. 没有未读行 → 新建，`count = 1` 并带上 `dedupeKey`；
 *   2. 有未读行 → 计数 +1、正文换成最新一条、时间前推，**不**新建行；
 *   3. 自己发的消息不提醒自己（与 `notify` 同一条规则）；
 *   4. 读完会话 → 清掉该会话的未读消息通知，且**只**动 `readAt: null` 的行（幂等）；
 *   5. 数据库出错时不抛给调用方 —— 通知永远不许弄坏「发消息」这件事。
 *
 * 第 2 条的查找条件里那句 `readAt: null` 是整套设计的关节：读完之后的
 * 新消息必须是一条新通知，否则用户看不出那是新消息。
 */
function makeAggregateService(existing: { id: string } | null = null) {
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  const prisma = {
    notification: {
      findFirst: jest.fn().mockResolvedValue(existing),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return data;
      }),
      update: jest.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
        updated.push(args);
        return args.data;
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return { service: new NotificationService(prisma as never), prisma, created, updated };
}

const message = (overrides: Partial<Parameters<NotificationService["notifyNewMessage"]>[0]> = {}) => ({
  userId: "u-1",
  actorId: "u-2",
  conversationId: "c-1",
  title: "New message",
  body: "在吗",
  ...overrides,
});

describe("messageDedupeKey", () => {
  it("带会话 id：同一个人在不同会话里的消息不该并成一条", () => {
    expect(messageDedupeKey("c-1")).toBe("NEW_MESSAGE:c-1");
    expect(messageDedupeKey("c-2")).not.toBe(messageDedupeKey("c-1"));
  });
});

describe("NotificationService.notifyNewMessage — 未读期间同一会话只占一行", () => {
  it("1. 没有未读行 -> 新建一行，带 dedupeKey 与 count=1", async () => {
    const { service, prisma, created } = makeAggregateService(null);

    await service.notifyNewMessage(message());

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      userId: "u-1",
      type: "NEW_MESSAGE",
      title: "New message",
      body: "在吗",
      count: 1,
      dedupeKey: "NEW_MESSAGE:c-1",
    });
    expect(prisma.notification.update).not.toHaveBeenCalled();
    // 查找条件就是「某人的、某会话的、还没读的那一行」。
    expect(prisma.notification.findFirst.mock.calls[0][0].where).toMatchObject({
      userId: "u-1",
      type: "NEW_MESSAGE",
      dedupeKey: "NEW_MESSAGE:c-1",
      readAt: null,
    });
  });

  it("2. 有未读行 -> 计数 +1、正文换最新、时间前推，不新建行", async () => {
    const { service, created, updated } = makeAggregateService({ id: "n-1" });

    await service.notifyNewMessage(message({ body: "第二条" }));

    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(updated[0].where).toEqual({ id: "n-1" });
    expect(updated[0].data).toMatchObject({ body: "第二条", count: { increment: 1 } });
    // 列表按时间倒序，合并过的行应当浮回最上面。
    expect(updated[0].data.createdAt).toBeInstanceOf(Date);
  });

  it("3. 自己发的消息不提醒自己，且连查都不查", async () => {
    const { service, prisma, created } = makeAggregateService(null);

    await service.notifyNewMessage(message({ actorId: "u-1" }));

    expect(created).toHaveLength(0);
    expect(prisma.notification.findFirst).not.toHaveBeenCalled();
  });

  it("4. 读完会话 -> 清掉该会话的未读消息通知（只动 readAt: null 的行）", async () => {
    const { service, prisma } = makeAggregateService(null);

    const cleared = await service.markConversationMessageNotificationsRead("u-1", "c-1");

    expect(cleared).toBe(1);
    const args = prisma.notification.updateMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      userId: "u-1",
      type: "NEW_MESSAGE",
      dedupeKey: "NEW_MESSAGE:c-1",
      readAt: null,
    });
    expect(args.data.readAt).toBeInstanceOf(Date);
  });

  it("5. 数据库出错时不抛给调用方（通知不许弄坏发消息）", async () => {
    const boom = {
      notification: {
        findFirst: jest.fn().mockRejectedValue(new Error("boom")),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockRejectedValue(new Error("boom")),
      },
    };
    const service = new NotificationService(boom as never);

    await expect(service.notifyNewMessage(message())).resolves.toBeUndefined();
    await expect(service.markConversationMessageNotificationsRead("u-1", "c-1")).resolves.toBe(0);
  });
});
