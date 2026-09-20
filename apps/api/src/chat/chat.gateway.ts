import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { NotificationService } from "../notifications/notification.service";
import { PrismaService } from "../prisma/prisma.service";
import { SafetyService } from "../safety/safety.service";
import { ChatAuthService } from "./chat-auth.service";
import { assertNotBlocked } from "../common/block-guard";
import { PresenceService } from "./presence.service";

type JoinPayload = { conversationId: string };
type SendPayload = {
  conversationId: string;
  content?: string;
  clientMessageId?: string;
  type?: string;
  imageUrl?: string;
};
type TypingPayload = { conversationId: string; typing: boolean };

type AuthedSocket = Socket & { data: { user?: { id: string; email: string } } };

@WebSocketGateway({
  namespace: "/chat",
  cors: {
    origin: [process.env.APP_URL ?? "http://localhost:3000", process.env.ADMIN_URL ?? "http://localhost:3001"],
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly chatAuth: ChatAuthService,
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly safety: SafetyService,
    private readonly notifications: NotificationService,
  ) {}

  async handleConnection(client: AuthedSocket) {
    const token = this.chatAuth.extractToken(
      client.handshake.headers as Record<string, string | string[] | undefined>,
      client.handshake.auth,
    );
    const { user, failure } = await this.chatAuth.verifyAccessToken(token);
    if (!user) {
      const code = failure === "BANNED" ? "USER_BANNED" : failure === "DISABLED" ? "USER_DISABLED" : "UNAUTHORIZED";
      client.emit("error", { code, message: "Invalid or expired access token" });
      client.disconnect(true);
      return;
    }
    client.data.user = user;
    this.presence.markOnline(user.id, client.id);
    client.join(this.userRoom(user.id));
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    }).catch(() => undefined);
    client.emit("ready", { userId: user.id });
    this.server.to(this.userRoom(user.id)).emit("presence", {
      userId: user.id,
      online: true,
      lastSeen: new Date().toISOString(),
    });
  }

  handleDisconnect(client: AuthedSocket) {
    const user = client.data.user;
    if (!user) return;
    const wentOffline = this.presence.markOffline(user.id, client.id);
    if (wentOffline) {
      this.server.to(this.userRoom(user.id)).emit("presence", {
        userId: user.id,
        online: false,
        lastSeen: new Date().toISOString(),
      });
    }
  }

  @SubscribeMessage("conversation.join")
  async handleJoin(@ConnectedSocket() client: AuthedSocket, @MessageBody() payload: JoinPayload) {
    try {
      const user = this.requireUser(client);
      if (!user) return;
      if (!payload?.conversationId) {
        client.emit("error", { code: "INVALID_PAYLOAD", message: "conversationId is required" });
        return;
      }
      const membership = await this.prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId: payload.conversationId, userId: user.id } },
        include: { conversation: { include: { members: { select: { userId: true } } } } },
      });
      if (!membership) {
        client.emit("error", { code: "CONVERSATION_NOT_FOUND", message: "Conversation not found" });
        return;
      }
      await client.join(this.conversationRoom(payload.conversationId));
      const peers = membership.conversation.members
        .map((member) => member.userId)
        .filter((peerId) => peerId !== user.id);
      client.emit("conversation.joined", {
        conversationId: payload.conversationId,
        peers: peers.map((peerId) => ({
          userId: peerId,
          online: this.presence.isOnline(peerId),
          lastSeen: this.presence.lastSeen(peerId)?.toISOString() ?? null,
        })),
        typing: this.presence.typingUsers(payload.conversationId, user.id),
      });
    } catch (error) {
      console.error("[chat] conversation.join failed", error);
      client.emit("error", { code: "JOIN_FAILED", message: "Failed to join conversation" });
    }
  }

  @SubscribeMessage("conversation.leave")
  handleLeave(@ConnectedSocket() client: AuthedSocket, @MessageBody() payload: JoinPayload) {
    client.leave(this.conversationRoom(payload.conversationId));
  }

  @SubscribeMessage("message.send")
  async handleSend(@ConnectedSocket() client: AuthedSocket, @MessageBody() payload: SendPayload) {
    const user = this.requireUser(client);
    if (!user) return;
    if (this.tooFast(client.id)) {
      client.emit("error", { code: "TOO_FAST", message: "Slow down, you are sending too fast" });
      return;
    }
    if (payload.type === "IMAGE" || payload.imageUrl) {
      await this.handleImageSend(client, user, payload);
      return;
    }
    const content = payload.content?.trim();
    if (!content || content.length > 2000) {
      client.emit("error", { code: "INVALID_MESSAGE", message: "Message must be 1-2000 characters" });
      return;
    }

    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: payload.conversationId, userId: user.id } },
      include: { conversation: { include: { members: { select: { userId: true } } } } },
    });
    if (!membership) {
      client.emit("error", { code: "CONVERSATION_NOT_FOUND", message: "Conversation not found" });
      return;
    }

    const peerId = membership.conversation.members.find((member) => member.userId !== user.id)?.userId;
    // P0-2: unified block check on the WebSocket text path.
    try {
      await assertNotBlocked(this.prisma, user.id, peerId);
    } catch {
      client.emit("error", { code: "BLOCKED", message: "You cannot message each other" });
      return;
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { conversationId: payload.conversationId, senderId: user.id, type: "TEXT", content },
      });
      await tx.conversation.update({
        where: { id: payload.conversationId },
        data: { updatedAt: new Date() },
      });
      return created;
    });

    const scan = this.safety.scanText(content);
    if (scan.blocked) {
      await this.prisma.message.update({
        where: { id: message.id },
        data: { deletedAt: new Date() },
      }).catch(() => undefined);
      client.emit("error", { code: "MESSAGE_BLOCKED", message: "This message cannot be sent" });
      return;
    }
    if (scan.level === "HIGH") {
      await this.safety.recordAutoFlag({
        userId: user.id,
        reasons: scan.reasons,
        messageId: message.id,
        source: "socket message",
        level: scan.level,
      });
    }

    this.presence.clearTyping(payload.conversationId, user.id);
    const event = {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      content: message.content,
      type: message.type,
      createdAt: message.createdAt.toISOString(),
      clientMessageId: payload.clientMessageId ?? null,
      safety: {
        level: scan.level,
        reasons: scan.reasons,
        hasExternalLink: scan.hasExternalLink,
        hasContactLeak: scan.hasContactLeak,
        links: this.safety.extractLinks(content),
      },
    };
    this.server.to(this.conversationRoom(payload.conversationId)).emit("message.new", event);

    if (peerId) {
      await this.notifications.notify({
        userId: peerId,
        type: "NEW_MESSAGE",
        title: "New message",
        body: content.slice(0, 120),
        data: {
          actorId: user.id,
          targetType: "CONVERSATION",
          targetId: payload.conversationId,
          conversationId: payload.conversationId,
          messageId: message.id,
        },
      });
    }
  }

  @SubscribeMessage("typing")
  async handleTyping(@ConnectedSocket() client: AuthedSocket, @MessageBody() payload: TypingPayload) {
    const user = this.requireUser(client);
    if (!user) return;
    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: payload.conversationId, userId: user.id } },
    });
    if (!membership) return;
    if (payload.typing) {
      this.presence.setTyping(payload.conversationId, user.id);
    } else {
      this.presence.clearTyping(payload.conversationId, user.id);
    }
    client.to(this.conversationRoom(payload.conversationId)).emit("typing", {
      conversationId: payload.conversationId,
      userId: user.id,
      typing: payload.typing,
    });
  }

  @SubscribeMessage("presence.get")
  async handlePresenceGet(@ConnectedSocket() client: AuthedSocket, @MessageBody() payload: { userIds: string[] }) {
    const user = this.requireUser(client);
    if (!user) return;
    const userIds = Array.isArray(payload.userIds) ? payload.userIds.slice(0, 20) : [];
    client.emit(
      "presence.list",
      userIds.map((peerId) => ({
        userId: peerId,
        online: this.presence.isOnline(peerId),
        lastSeen: this.presence.lastSeen(peerId)?.toISOString() ?? null,
      })),
    );
  }

  private readonly sendTimestamps = new Map<string, number[]>();

  private tooFast(socketId: string) {
    const now = Date.now();
    const history = (this.sendTimestamps.get(socketId) ?? []).filter((time) => now - time < 5000);
    if (history.length >= 5) {
      this.sendTimestamps.set(socketId, history);
      return true;
    }
    history.push(now);
    this.sendTimestamps.set(socketId, history);
    return false;
  }

  private async handleImageSend(
    client: AuthedSocket,
    user: { id: string; email: string },
    payload: SendPayload,
  ) {
    const raw = (payload.imageUrl ?? payload.content ?? "").trim();
    const imageUrl = this.normalizeUploadUrl(raw);
    if (!imageUrl) {
      client.emit("error", { code: "INVALID_IMAGE", message: "Image must be an https URL" });
      return;
    }
    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: payload.conversationId, userId: user.id } },
      include: { conversation: { include: { members: { select: { userId: true } } } } },
    });
    if (!membership) {
      client.emit("error", { code: "CONVERSATION_NOT_FOUND", message: "Conversation not found" });
      return;
    }
    // P0-2: the image path used to skip the block check entirely, so a blocked
    // user could still push images over WebSocket. Guard it the same way.
    const peerId = membership.conversation.members.find((member) => member.userId !== user.id)?.userId;
    try {
      await assertNotBlocked(this.prisma, user.id, peerId);
    } catch {
      client.emit("error", { code: "BLOCKED", message: "You cannot message each other" });
      return;
    }
    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { conversationId: payload.conversationId, senderId: user.id, type: "IMAGE", content: imageUrl },
      });
      await tx.conversation.update({
        where: { id: payload.conversationId },
        data: { updatedAt: new Date() },
      });
      return created;
    });
    this.server.to(this.conversationRoom(payload.conversationId)).emit("message.new", {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      content: message.content,
      type: message.type,
      createdAt: message.createdAt.toISOString(),
      clientMessageId: payload.clientMessageId ?? null,
    });
  }

  private normalizeUploadUrl(raw: string) {
    if (/^https:\/\/\S{4,2000}$/.test(raw)) return raw;
    if (process.env.NODE_ENV !== "production" && /^http:\/\/localhost(:\d+)?\/\S{1,2000}$/.test(raw)) {
      return raw;
    }
    return null;
  }

  private requireUser(client: AuthedSocket) {
    const user = client.data.user;
    if (!user) {
      client.emit("error", { code: "UNAUTHORIZED", message: "Not authenticated" });
      client.disconnect(true);
      return null;
    }
    return user;
  }

  private userRoom(userId: string) {
    return `user:${userId}`;
  }

  private conversationRoom(conversationId: string) {
    return `conversation:${conversationId}`;
  }
}
