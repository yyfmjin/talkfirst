import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { HttpException } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { NotificationService } from "../notifications/notification.service";
import { PrismaService } from "../prisma/prisma.service";
import { SafetyService } from "../safety/safety.service";
import { ChatAuthService, type SocketAuthFailure } from "./chat-auth.service";
import { assertNotBlocked } from "../common/block-guard";
import { assertConnectionActive, requireActiveAccount } from "../common/connection-guard";
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

type AuthedSocket = Socket & {
  data: {
    user?: { id: string; email: string };
    /** Resolves when `handleConnection` has finished authenticating. */
    authPending?: Promise<boolean>;
  };
};

/**
 * SEC-005 — maps a socket authentication failure to the client-facing `error`
 * payload. Pure and exported so the mapping is unit-testable without a live
 * socket, and so the e-mail gate reports the same code as the HTTP side
 * (`EMAIL_VERIFIED_REQUIRED`) instead of the generic `UNAUTHORIZED`.
 */
export function socketAuthError(failure: SocketAuthFailure | null): { code: string; message: string } {
  switch (failure) {
    case "BANNED":
      return { code: "USER_BANNED", message: "Invalid or expired access token" };
    case "DISABLED":
      return { code: "USER_DISABLED", message: "Invalid or expired access token" };
    case "EMAIL_VERIFIED_REQUIRED":
      return { code: "EMAIL_VERIFIED_REQUIRED", message: "Verify your email address to continue" };
    default:
      return { code: "UNAUTHORIZED", message: "Invalid or expired access token" };
  }
}

/**
 * Pulls the domain `error.code` out of an `HttpException` thrown by the shared
 * guards (`BLOCKED`, `CONNECTION_REMOVED`, `USER_BANNED`, …), so the socket
 * reports the *same* code the REST transport would instead of a generic
 * "something failed". Returns `null` for anything that is not a shaped
 * HttpException.
 */
function errorCodeOf(error: unknown): string | null {
  if (!(error instanceof HttpException)) return null;
  const payload = error.getResponse();
  if (typeof payload !== "object" || payload === null) return null;
  const code = (payload as { error?: { code?: unknown } }).error?.code;
  return typeof code === "string" ? code : null;
}

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
    // Authenticating is asynchronous (a DB lookup), but socket.io tells the
    // client it is connected before this method resolves — and the client emits
    // `conversation.join` from its own `connect` handler. Without this gate the
    // join could be handled while `data.user` was still unset, so the socket
    // was rejected with UNAUTHORIZED and force-disconnected even though its
    // token was perfectly valid. That rejection was the trigger for the
    // client's unbounded reconnect loop.
    const pending = this.authenticate(client);
    client.data.authPending = pending;
    await pending;
  }

  /** Returns false when the socket was rejected and already torn down. */
  private async authenticate(client: AuthedSocket): Promise<boolean> {
    const token = this.chatAuth.extractToken(
      client.handshake.headers as Record<string, string | string[] | undefined>,
      client.handshake.auth,
    );
    const { user, failure } = await this.chatAuth.verifyAccessToken(token);
    if (!user) {
      client.emit("error", socketAuthError(failure));
      client.disconnect(true);
      return false;
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
    return true;
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
      const user = await this.requireUser(client);
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
    const user = await this.requireUser(client);
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
    if (!(await this.assertSendAllowed(client, user, payload.conversationId, peerId, "TEXT"))) return;

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
    const user = await this.requireUser(client);
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
    const user = await this.requireUser(client);
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

  /**
   * FIX (audit P002 / P003) — the one gate both WebSocket send paths pass.
   *
   * `chat-auth.service.ts` reads the account status exactly once, at handshake
   * time. A user banned, suspended or disabled *after* connecting kept a fully
   * working socket: the HTTP transport was safe because `JwtStrategy.validate()`
   * re-reads the row per request, but the socket had no equivalent. The same
   * omission applied to the connection: removing a connection left the
   * conversation and its members in place, so the pair could keep messaging over
   * the socket forever after the relationship visibly ended.
   *
   * Returns `false` after emitting the canonical error, so call sites read as
   * `if (!(await this.assertSendAllowed(...))) return;`.
   *
   * A non-ACTIVE account additionally has its socket disconnected: continuing to
   * hold the connection open would let it keep *receiving* messages it is no
   * longer allowed to see.
   */
  private async assertSendAllowed(
    client: AuthedSocket,
    user: { id: string },
    conversationId: string,
    peerId: string | undefined,
    kind: "TEXT" | "IMAGE",
  ): Promise<boolean> {
    try {
      await requireActiveAccount(this.prisma, user.id);
    } catch (error) {
      const code = errorCodeOf(error) ?? "USER_DISABLED";
      client.emit("error", { code, message: "Your account may not send messages right now" });
      client.disconnect(true);
      return false;
    }

    try {
      if (peerId) {
        await assertConnectionActive(this.prisma, conversationId, user.id, peerId);
      }
      await assertNotBlocked(this.prisma, user.id, peerId);
    } catch (error) {
      const code = errorCodeOf(error) ?? "BLOCKED";
      const message =
        code === "CONNECTION_REMOVED"
          ? "This connection was removed, so this conversation is closed"
          : "You cannot message each other";
      // A dropped connection/block also removes the socket from the room, so a
      // stale client cannot keep receiving what it may no longer see.
      if (code === "CONNECTION_REMOVED" || code === "BLOCKED") {
        await client.leave(this.conversationRoom(conversationId));
      }
      client.emit("error", { code, message });
      return false;
    }

    void kind;
    return true;
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
    // P002/P003: and it must not bypass the account or connection rule either.
    const peerId = membership.conversation.members.find((member) => member.userId !== user.id)?.userId;
    if (!(await this.assertSendAllowed(client, user, payload.conversationId, peerId, "IMAGE"))) return;
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

  private async requireUser(client: AuthedSocket) {
    // Wait for `handleConnection` to settle first: an event that races the
    // handshake must not be mistaken for an unauthenticated socket.
    if (client.data.authPending) await client.data.authPending;
    const user = client.data.user;
    if (!user) {
      // `authenticate` already reported UNAUTHORIZED and disconnected; only a
      // socket that never went through `handleConnection` is reported here.
      if (!client.data.authPending) {
        client.emit("error", { code: "UNAUTHORIZED", message: "Not authenticated" });
        client.disconnect(true);
      }
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
