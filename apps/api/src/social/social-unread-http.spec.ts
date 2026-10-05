import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import passport from "passport";
import { Strategy as PassportStrategyBase } from "passport-strategy";
import { ApiExceptionFilter } from "../common/api-exception.filter";
import { MomentsService } from "../moments/moments.service";
import { NotificationService } from "../notifications/notification.service";
import { PrismaService } from "../prisma/prisma.service";
import { SafetyService } from "../safety/safety.service";
import { SocialSafetyController } from "./social-safety.controller";

/**
 * C3 — 未读数与已读，按**客户端看到的样子**测（真路由 + 真控制器 + 真 DTO）。
 *
 * ## 这套用例要挡住的是什么
 *
 * 未读数以前是 `take: 5` 的副产品：会话列表只取最近 5 条消息，再把「不是我发的」数出来
 * 当未读。它有两个后果，而且都不会报错，只会一直错：
 *
 *   1. 一个从没打开过的会话，最多也只显示 5；
 *   2. **读完之后不会归零** —— 已读与未读在数据上根本没区别。
 *
 * 现在判据是每个成员自己的 `lastReadAt`。所以这里钉三件事：
 * 未读数来自 `message.count`（不是那个 5 条窗口）、`lastReadAt` 真的参与判据、
 * 以及「打开会话」这个动作真的能把未读清掉。
 *
 * 第 1 条用 `count → 7` 而窗口里只有 1 条消息来证明 —— 如果实现退回窗口算法，这条会红。
 */

const ME = "3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const PEER = "11111111-2222-4333-8444-555555555555";
const CONV = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

/** 上一次读到的时间点，后面几条断言都围着它。 */
const LAST_READ = new Date("2026-10-01T00:00:00.000Z");

class AlwaysSignedInStrategy extends PassportStrategyBase {
  name = "jwt";

  authenticate() {
    this.success({ id: ME, email: "me@example.test" });
  }
}

passport.use("jwt", new AlwaysSignedInStrategy());

describe("SocialSafetyController — 未读数与已读（C3）", () => {
  let app: INestApplication;
  let base = "";
  let prisma: {
    conversationMember: { findMany: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    message: { count: jest.Mock; create: jest.Mock };
    conversation: { findUnique: jest.Mock; update: jest.Mock };
    user: { findUnique: jest.Mock };
    connection: { findUnique: jest.Mock };
    block: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  /** 事务里用的桩：发消息路径断言它就够了。 */
  let tx: {
    message: { create: jest.Mock };
    conversation: { update: jest.Mock };
    conversationMember: { update: jest.Mock };
  };

  /** 一条成员行 + 它挂着的会话，形状与 `GET /conversations` 的 include 一致。 */
  function membership(lastReadAt: Date | null = LAST_READ) {
    return {
      conversationId: CONV,
      lastReadAt,
      conversation: {
        id: CONV,
        updatedAt: new Date("2026-10-02T00:00:00.000Z"),
        connection: { id: "conn-1", status: "ACTIVE" },
        members: [
          { userId: ME, user: { id: ME, nickname: "Me", avatarUrl: null, countryCode: "CN" } },
          { userId: PEER, user: { id: PEER, nickname: "Peer", avatarUrl: null, countryCode: "JP" } },
        ],
        // 窗口里只有 1 条 —— 未读数必须由 count 决定，而不是数这几条。
        messages: [
          {
            id: "msg-1",
            content: "hello",
            type: "TEXT",
            senderId: PEER,
            createdAt: new Date("2026-10-02T00:00:00.000Z"),
          },
        ],
      },
    };
  }

  beforeAll(async () => {
    prisma = {
      conversationMember: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      message: { count: jest.fn(), create: jest.fn() },
      conversation: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      user: { findUnique: jest.fn() },
      connection: { findUnique: jest.fn() },
      block: { findFirst: jest.fn().mockResolvedValue(null) },
      /**
       * 发消息用的是**回调式** `$transaction`（消息服务用的是数组式，两者不同）。
       * 桩件把同一个 `tx` 交给回调，断言就落在 `tx.conversationMember.update` 上。
       */
      $transaction: jest.fn(),
    };
    tx = {
      message: { create: jest.fn() },
      conversation: { update: jest.fn() },
      conversationMember: { update: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (fn: (client: unknown) => unknown) => fn(tx));

    const moduleRef = await Test.createTestingModule({
      controllers: [SocialSafetyController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: SafetyService, useValue: { scanText: () => ({ blocked: false }) } },
        { provide: NotificationService, useValue: { notify: jest.fn() } },
        { provide: MomentsService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(new ApiExceptionFilter());
    await app.listen(0);
    const url = await app.getUrl();
    base = `http://127.0.0.1:${url.slice(url.lastIndexOf(":") + 1)}/api/v1`;
  });

  beforeEach(() => {
    prisma.conversationMember.findMany.mockReset().mockResolvedValue([membership()]);
    prisma.conversationMember.findUnique.mockReset();
    prisma.conversationMember.update.mockClear();
    // 7 是刻意选的：窗口里只有 1 条消息，所以「未读 7」只可能来自 count。
    prisma.message.count.mockReset().mockResolvedValue(7);
    prisma.user.findUnique
      .mockReset()
      .mockResolvedValue({ id: ME, status: "ACTIVE", emailVerified: true });
    prisma.connection.findUnique.mockReset().mockResolvedValue({ status: "ACTIVE" });
    prisma.block.findFirst.mockReset().mockResolvedValue(null);
  });

  afterAll(async () => {
    await app.close();
  });

  async function get(path: string) {
    const response = await fetch(`${base}${path}`);
    return { response, body: (await response.json()) as Record<string, unknown> };
  }

  async function post(path: string, payload?: unknown) {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    return { response, body: (await response.json()) as Record<string, unknown> };
  }

  it("未读数来自 message.count，不是那个「最近 5 条」的窗口", async () => {
    const { body } = await get("/conversations");

    const data = body.data as Array<{ unreadCount: number }>;
    expect(data[0].unreadCount).toBe(7);

    // 形状一并钉住：三个排除项都必须出现在查询里。
    expect(prisma.message.count).toHaveBeenCalledWith({
      where: {
        conversationId: CONV,
        deletedAt: null,
        senderId: { not: ME },
        type: { not: "SYSTEM" },
        createdAt: { gt: LAST_READ },
      },
    });
  });

  it("从未读过（lastReadAt = null）→ 不加时间下界", async () => {
    prisma.conversationMember.findMany.mockResolvedValue([membership(null)]);

    await get("/conversations");

    const where = (prisma.message.count.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.createdAt).toBeUndefined();
    // 其余三条排除仍然要在 —— 「没读过」不等于「什么都算」。
    expect(where.senderId).toEqual({ not: ME });
    expect(where.type).toEqual({ not: "SYSTEM" });
    expect(where.deletedAt).toBeNull();
  });

  it("打开会话：POST /conversations/:id/read 把 lastReadAt 推到此刻，并回报未读归零", async () => {
    prisma.conversationMember.findUnique.mockResolvedValue(membership());

    const { response, body } = await post(`/conversations/${CONV}/read`);

    expect(response.status).toBe(201);
    const data = body.data as { unreadCount: number; conversationId: string; lastReadAt: string };
    expect(data.conversationId).toBe(CONV);
    expect(data.unreadCount).toBe(0);
    expect(Number.isNaN(new Date(data.lastReadAt).getTime())).toBe(false);

    expect(prisma.conversationMember.update).toHaveBeenCalledTimes(1);
    const call = prisma.conversationMember.update.mock.calls[0][0] as {
      where: unknown;
      data: { lastReadAt: Date };
    };
    expect(call.where).toEqual({ conversationId_userId: { conversationId: CONV, userId: ME } });
    expect(call.data.lastReadAt).toBeInstanceOf(Date);
  });

  it("已读是幂等的：连点两次都成功，且第二次仍然只推自己的那一行", async () => {
    prisma.conversationMember.findUnique.mockResolvedValue(membership());

    const first = await post(`/conversations/${CONV}/read`);
    const second = await post(`/conversations/${CONV}/read`);

    expect(first.response.status).toBe(201);
    expect(second.response.status).toBe(201);
    expect(prisma.conversationMember.update).toHaveBeenCalledTimes(2);
  });

  it("非成员标记已读 → 404，且一行都不写", async () => {
    prisma.conversationMember.findUnique.mockResolvedValue(null);

    const { response, body } = await post(`/conversations/${CONV}/read`);

    expect(response.status).toBe(404);
    expect((body.error as { code: string }).code).toBe("CONVERSATION_NOT_FOUND");
    expect(prisma.conversationMember.update).not.toHaveBeenCalled();
  });

  it("发消息会把自己的已读位置推到此刻（同一个事务里）", async () => {
    prisma.conversationMember.findUnique.mockResolvedValue(membership());
    prisma.conversation.findUnique.mockResolvedValue({
      members: [{ userId: ME }, { userId: PEER }],
    });
    tx.message.create.mockResolvedValue({
      id: "msg-2",
      conversationId: CONV,
      senderId: ME,
      content: "hi",
      type: "TEXT",
      createdAt: new Date("2026-10-03T00:00:00.000Z"),
    });

    const { response, body } = await post(`/conversations/${CONV}/messages`, { content: "hi" });

    expect(response.status).toBe(201);
    // C3 顺带清掉的死字段：名字说「对方未读消息」，算的是未读通知，且没有任何消费方。
    expect(body.data as Record<string, unknown>).not.toHaveProperty("peerUnread");
    expect(tx.conversationMember.update).toHaveBeenCalledTimes(1);
    const call = tx.conversationMember.update.mock.calls[0][0] as {
      where: unknown;
      data: { lastReadAt: Date };
    };
    expect(call.where).toEqual({ conversationId_userId: { conversationId: CONV, userId: ME } });
    expect(call.data.lastReadAt).toBeInstanceOf(Date);
  });
});
