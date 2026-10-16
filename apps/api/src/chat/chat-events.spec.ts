import type { Server } from "socket.io";
import {
  attachChatServer,
  conversationRoom,
  emitConversationActivity,
  emitMessageNew,
  userRoom,
} from "./chat-events";

/**
 * 消息类事件的广播口。
 *
 * 这一层存在的理由是一个真实缺陷：REST 发消息（**App 走的路径**）以前什么事件都不发，
 * 于是「用 App 发的消息对方收不到实时、用 web 发的能收到」。所以这里钉住的不是实现
 * 细节，而是**房间与负载**这两件客户端真正依赖的东西。
 */

function fakeServer() {
  const emitted: Array<{ room: string; event: string; payload: unknown }> = [];
  const server = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ room, event, payload });
      },
    }),
  } as unknown as Server;
  return { server, emitted };
}

const message = {
  id: "m-1",
  conversationId: "c-1",
  senderId: "u-1",
  content: "hello",
  type: "TEXT",
  createdAt: "2026-10-16T12:00:00.000Z",
};

describe("chat-events — 房间命名", () => {
  it("房间名与网关/客户端约定的形状一致", () => {
    expect(conversationRoom("c-1")).toBe("conversation:c-1");
    expect(userRoom("u-1")).toBe("user:u-1");
  });
});

describe("chat-events — message.new", () => {
  it("发到**会话房间**（正在看的人，含发送者自己的其他设备）", () => {
    const { server, emitted } = fakeServer();
    attachChatServer(server);

    emitMessageNew({ conversationId: "c-1", message });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].room).toBe("conversation:c-1");
    expect(emitted[0].event).toBe("message.new");
    expect(emitted[0].payload).toMatchObject({ id: "m-1", conversationId: "c-1", content: "hello" });
  });

  it("客户端回显 id 原样带上（可选，缺失时为 null）", () => {
    const { server, emitted } = fakeServer();
    attachChatServer(server);

    emitMessageNew({ conversationId: "c-1", message, clientMessageId: "local-9" });
    emitMessageNew({ conversationId: "c-1", message });

    expect(emitted[0].payload).toMatchObject({ clientMessageId: "local-9" });
    expect(emitted[1].payload).toMatchObject({ clientMessageId: null });
  });
});

describe("chat-events — conversation.activity", () => {
  it("发到**收件人自己的房间**，只带列表要用的字段", () => {
    const { server, emitted } = fakeServer();
    attachChatServer(server);

    emitConversationActivity({
      recipientId: "u-2",
      conversationId: "c-1",
      messageId: "m-1",
      senderId: "u-1",
      type: "TEXT",
      preview: "hello",
      createdAt: new Date("2026-10-16T12:00:00.000Z"),
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0].room).toBe("user:u-2");
    expect(emitted[0].event).toBe("conversation.activity");
    expect(emitted[0].payload).toEqual({
      conversationId: "c-1",
      messageId: "m-1",
      senderId: "u-1",
      type: "TEXT",
      preview: "hello",
      createdAt: "2026-10-16T12:00:00.000Z",
    });
  });

  it("图片消息的 preview 为 null（预览文案由客户端按 type 决定），长预览被截断", () => {
    const { server, emitted } = fakeServer();
    attachChatServer(server);

    emitConversationActivity({
      recipientId: "u-2",
      conversationId: "c-1",
      messageId: "m-2",
      senderId: "u-1",
      type: "IMAGE",
      preview: null,
      createdAt: new Date("2026-10-16T12:00:00.000Z"),
    });
    emitConversationActivity({
      recipientId: "u-2",
      conversationId: "c-1",
      messageId: "m-3",
      senderId: "u-1",
      type: "TEXT",
      preview: "x".repeat(500),
      createdAt: new Date("2026-10-16T12:00:00.000Z"),
    });

    expect((emitted[0].payload as { preview: unknown }).preview).toBeNull();
    expect(((emitted[1].payload as { preview: string }).preview ?? "").length).toBe(120);
  });
});

describe("chat-events — 没有 socket 层时", () => {
  it("静默跳过而不是抛错：消息已经写进库了，广播是尽力而为", () => {
    attachChatServer(null as unknown as Server);
    expect(() => emitMessageNew({ conversationId: "c-1", message })).not.toThrow();
    expect(() =>
      emitConversationActivity({
        recipientId: "u-2",
        conversationId: "c-1",
        messageId: "m-1",
        senderId: "u-1",
        type: "TEXT",
        preview: "hi",
        createdAt: new Date(),
      }),
    ).not.toThrow();
  });
});
