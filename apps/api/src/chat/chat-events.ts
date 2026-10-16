import type { Server } from "socket.io";

/**
 * 聊天事件的广播口 —— **消息类事件的唯一 socket 写入点**。
 *
 * ## 为什么必须只有一处
 *
 * 消息有两条写入路径：socket 的 `message.send` 与 REST 的
 * `POST /conversations/:id/messages`（**App 端走的是后者**）。广播如果只写在网关里，
 * 就会出现「用 socket 发的消息对方即时收到，用 REST 发的消息对方收不到」——
 * 这个不一致在真实后端上被端到端脚本抓住过一次（2026-10-16，见
 * `scripts/verify-chat-realtime.mjs`）。
 *
 * ## 为什么是模块级函数而不是 Nest provider
 *
 * 它包住的 socket.io `server` **在进程里本来就只有一份**（一个网关、一个 HTTP
 * server）—— 「注入」在这里不带来任何隔离，只会让每个用到它的测试都要多写一个
 * provider 替身。房间名与负载形状反而是真正需要收口的东西，那些都在这里。
 *
 * 单元测试里没有 socket 层时**静默跳过**：广播是尽力而为，消息已经写进库了。
 */

/** 房间名是**协议的一部分**：客户端不做房间管理，但网关与这里必须完全一致。 */
export function conversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

export function userRoom(userId: string): string {
  return `user:${userId}`;
}

let server: Server | null = null;

/** 由网关在 `afterInit` 时调用一次。 */
export function attachChatServer(next: Server): void {
  server = next;
}

function emit(room: string, event: string, payload: unknown): void {
  if (!server) return;
  server.to(room).emit(event, payload);
}

export type MessageEventPayload = {
  id: string;
  conversationId: string;
  /** AI 朋友的消息没有发送者（`Message.senderId` 可空），所以这里也必须是可空的。 */
  senderId: string | null;
  content: string;
  type: string;
  createdAt: string;
  clientMessageId?: string | null;
  /** 仅 socket 发送路径带（REST 路径不返回安全扫描的细节）。 */
  safety?: unknown;
};

/** 新消息：发给**会话房间**（正在看这个会话的人，也包括发送者自己的其他设备）。 */
export function emitMessageNew(input: {
  conversationId: string;
  message: MessageEventPayload;
  clientMessageId?: string | null;
}): void {
  emit(conversationRoom(input.conversationId), "message.new", {
    ...input.message,
    clientMessageId: input.clientMessageId ?? input.message.clientMessageId ?? null,
  });
}

/**
 * 会话列表的实时更新：发给**收件人自己的房间**。
 *
 * 列表页不会把所有会话都 join 一遍，所以列表的实时只能靠这条。
 * `preview` 对图片为空 —— 客户端按 `type` 显示自己的「图片」文案，
 * 不把 `https://…` 当预览摆到列表里。
 */
export function emitConversationActivity(input: {
  recipientId: string;
  conversationId: string;
  messageId: string;
  senderId: string | null;
  type: string;
  preview: string | null;
  createdAt: Date;
}): void {
  emit(userRoom(input.recipientId), "conversation.activity", {
    conversationId: input.conversationId,
    messageId: input.messageId,
    senderId: input.senderId,
    type: input.type,
    preview: input.preview === null ? null : input.preview.slice(0, 120),
    createdAt: input.createdAt.toISOString(),
  });
}
