import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { NotificationService } from "../notifications/notification.service";
import { PrismaService } from "../prisma/prisma.service";
import { SafetyService } from "../safety/safety.service";

export const SAY_HELLO_TEMPLATES = [
  { id: "language", label: "🗣️ I'd like to practice languages.", category: "Language" },
  { id: "gaming", label: "🎮 We both like gaming.", category: "Gaming" },
  { id: "country", label: "🌍 I want to learn about your country.", category: "Culture" },
  { id: "music", label: "🎵 We both like music.", category: "Music" },
  { id: "travel", label: "✈️ Let's share travel stories.", category: "Travel" },
  { id: "custom", label: "✍️ Write my own message.", category: "Custom" },
] as const;

export type SayHelloTemplate = (typeof SAY_HELLO_TEMPLATES)[number];

@Injectable()
export class ConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyService,
    /** PC-3.1b — the one writer of notifications; see `NotificationService`. */
    private readonly notifications: NotificationService,
  ) {}

  listTemplates() {
    return SAY_HELLO_TEMPLATES;
  }

  async sendRequest(senderId: string, receiverId: string, message?: string, templateId?: string) {
    if (senderId === receiverId) {
      throw new ForbiddenException({
        success: false,
        error: { code: "CANNOT_REQUEST_SELF", message: "You cannot send a request to yourself" },
      });
    }

    const receiver = await this.prisma.user.findUnique({
      where: { id: receiverId },
      select: { id: true, status: true },
    });
    if (!receiver || receiver.status !== "ACTIVE") {
      throw new NotFoundException({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }

    const blocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: senderId, blockedId: receiverId },
          { blockerId: receiverId, blockedId: senderId },
        ],
      },
    });
    if (blocked) {
      throw new ForbiddenException({
        success: false,
        error: { code: "BLOCKED", message: "You cannot send a request to this user" },
      });
    }

    const dayStart = this.startOfToday();
    const sentToday = await this.prisma.connectionRequest.count({
      where: { senderId, createdAt: { gte: dayStart } },
    });
    const dailyLimit = await this.safety.sayHelloLimit(senderId);
    if (sentToday >= dailyLimit) {
      throw new ForbiddenException({
        success: false,
        error: {
          code: "DAILY_LIMIT_REACHED",
          message: `Daily limit reached (${dailyLimit}/day). TalkFirst is about depth, not swiping.`,
        },
      });
    }

    const trimmedMessage = message?.trim().slice(0, 200);
    const scan = this.safety.scanText(trimmedMessage ?? "");
    if (scan.blocked) {
      throw new ForbiddenException({
        success: false,
        error: { code: "MESSAGE_BLOCKED", message: "This message cannot be sent" },
      });
    }

    // Atomic: re-check daily limit + duplicates inside the transaction so
    // concurrent bursts cannot overshoot the 20/50 per-day cap.
    const request = await this.prisma.$transaction(async (tx) => {
      const dayStart = this.startOfToday();
      const [sentToday, existingActive, existingPending] = await Promise.all([
        tx.connectionRequest.count({ where: { senderId, createdAt: { gte: dayStart } } }),
        tx.connection.findFirst({
          where: {
            status: "ACTIVE",
            OR: [
              { userAId: senderId, userBId: receiverId },
              { userAId: receiverId, userBId: senderId },
            ],
          },
        }),
        tx.connectionRequest.findFirst({
          where: {
            status: "PENDING",
            OR: [
              { senderId, receiverId },
              { senderId: receiverId, receiverId: senderId },
            ],
          },
        }),
      ]);
      if (sentToday >= dailyLimit) {
        throw new ForbiddenException({
          success: false,
          error: {
            code: "DAILY_LIMIT_REACHED",
            message: `Daily limit reached (${dailyLimit}/day). TalkFirst is about depth, not swiping.`,
          },
        });
      }
      if (existingActive) {
        throw new ForbiddenException({
          success: false,
          error: { code: "ALREADY_CONNECTED", message: "You are already connected" },
        });
      }
      if (existingPending) {
        throw new ForbiddenException({
          success: false,
          error: { code: "REQUEST_PENDING", message: "A pending request already exists" },
        });
      }
      return tx.connectionRequest.create({
        data: {
          senderId,
          receiverId,
          message: trimmedMessage || undefined,
        },
        include: {
          sender: { select: { id: true, nickname: true, avatarUrl: true, countryCode: true } },
        },
      });
    });

    if (scan.level === "HIGH") {
      await this.safety.recordAutoFlag({
        userId: senderId,
        reasons: scan.reasons,
        source: "Say Hello",
        level: scan.level,
      });
    }

    await this.notifications.notify({
      userId: receiverId,
      type: "SAY_HELLO",
      title: `${request.sender.nickname ?? "Someone"} said hello`,
      body: trimmedMessage ?? SAY_HELLO_TEMPLATES.find((t) => t.id === templateId)?.label ?? undefined,
      data: {
        actorId: senderId,
        targetType: "CONNECTION",
        targetId: request.id,
        requestId: request.id,
      },
    });

    return this.toRequestPayload(request);
  }

  async listIncoming(userId: string) {
    const requests = await this.prisma.connectionRequest.findMany({
      where: { receiverId: userId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: {
        sender: {
          select: {
            id: true,
            nickname: true,
            avatarUrl: true,
            countryCode: true,
            birthDate: true,
            bio: true,
            interests: { include: { interest: true } },
          },
        },
      },
    });
    return requests.map((request) => this.toRequestPayload(request));
  }

  async listSent(userId: string) {
    const requests = await this.prisma.connectionRequest.findMany({
      where: { senderId: userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        receiver: { select: { id: true, nickname: true, avatarUrl: true, countryCode: true } },
      },
    });
    return requests.map((request) => this.toRequestPayload(request));
  }

  async respond(userId: string, requestId: string, action: "accept" | "reject") {
    const request = await this.prisma.connectionRequest.findUnique({ where: { id: requestId } });
    if (!request || request.receiverId !== userId) {
      throw new NotFoundException({
        success: false,
        error: { code: "REQUEST_NOT_FOUND", message: "Request not found" },
      });
    }
    if (request.status !== "PENDING") {
      throw new ForbiddenException({
        success: false,
        error: { code: "REQUEST_HANDLED", message: "This request was already handled" },
      });
    }

    if (action === "reject") {
      const updated = await this.prisma.connectionRequest.update({
        where: { id: requestId },
        data: { status: "REJECTED" },
        include: {
          sender: { select: { id: true, nickname: true, avatarUrl: true, countryCode: true } },
        },
      });
      return { request: this.toRequestPayload(updated), connection: null };
    }

    const [userAId, userBId] = [request.senderId, request.receiverId].sort();
    const result = await this.prisma.$transaction(async (tx) => {
      /**
       * RACE FIX (audit P004).
       *
       * The `PENDING` check above runs *outside* the transaction, so two
       * concurrent "accept" requests for the same row both passed it. Each one
       * then created a conversation, two membership rows and a SYSTEM message
       * before hitting the `Connection(userAId, userBId)` unique index — the
       * loser took the `update` branch and re-pointed `conversationId`, leaving
       * an orphan conversation and a duplicate system message behind.
       *
       * The claim is now a conditional update *inside* the transaction: exactly
       * one caller can flip the row, and the conversation is only created by the
       * caller that flipped it (`count === 1`).
       */
      const claimed = await tx.connectionRequest.updateMany({
        where: { id: requestId, status: "PENDING" },
        data: { status: "ACCEPTED" },
      });
      if (claimed.count !== 1) {
        throw new ForbiddenException({
          success: false,
          error: { code: "REQUEST_HANDLED", message: "This request was already handled" },
        });
      }

      const conversation = await tx.conversation.create({ data: {} });
      await tx.conversationMember.createMany({
        data: [
          { conversationId: conversation.id, userId: request.senderId },
          { conversationId: conversation.id, userId: request.receiverId },
        ],
      });
      await tx.message.create({
        data: {
          conversationId: conversation.id,
          senderId: request.senderId,
          type: "SYSTEM",
          content: request.message?.trim()
            ? `${request.message.trim()}`
            : "Say hello! Your TalkFirst conversation just started.",
        },
      });
      const connection = await tx.connection.upsert({
        where: { userAId_userBId: { userAId, userBId } },
        update: { status: "ACTIVE", conversationId: conversation.id },
        create: { userAId, userBId, status: "ACTIVE", conversationId: conversation.id },
      });
      // The row was already flipped by the claim above; this read only re-loads
      // it in its new state for the response payload.
      const updatedRequest = await tx.connectionRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: {
          sender: { select: { id: true, nickname: true, avatarUrl: true, countryCode: true } },
        },
      });
      return { updatedRequest, connection, conversation };
    });

    // PC-3.1b — the notification is written *after* the commit, never inside the
    // transaction it describes: a connection that was successfully made must not
    // be rolled back because a notification could not be stored, and `notify`
    // never throws.
    await this.notifications.notify({
      userId: request.senderId,
      type: "REQUEST_ACCEPTED",
      title: "🎉 It's a connection!",
      body: "You both want to talk. Start chatting.",
      data: {
        actorId: userId,
        targetType: "CONVERSATION",
        targetId: result.conversation.id,
        requestId,
        connectionId: result.connection.id,
        conversationId: result.conversation.id,
      },
    });

    return {
      request: this.toRequestPayload(result.updatedRequest),
      connection: {
        id: result.connection.id,
        conversationId: result.conversation.id,
        status: result.connection.status,
        createdAt: result.connection.createdAt,
      },
    };
  }

  async cancelRequest(userId: string, requestId: string) {
    const request = await this.prisma.connectionRequest.findUnique({ where: { id: requestId } });
    if (!request || request.senderId !== userId) {
      throw new NotFoundException({
        success: false,
        error: { code: "REQUEST_NOT_FOUND", message: "Request not found" },
      });
    }
    if (request.status !== "PENDING") {
      throw new ForbiddenException({
        success: false,
        error: { code: "REQUEST_HANDLED", message: "This request was already handled" },
      });
    }
    await this.prisma.connectionRequest.update({
      where: { id: requestId },
      data: { status: "CANCELLED" },
    });
    return { cancelled: true };
  }

  async listConnections(userId: string) {    const connections = await this.prisma.connection.findMany({
      where: {
        status: "ACTIVE",
        OR: [{ userAId: userId }, { userBId: userId }],
      },
      orderBy: { createdAt: "desc" },
      include: {
        conversation: {
          include: {
            exchanges: {
              orderBy: { createdAt: "desc" },
              take: 5,
            },
          },
        },
        userA: {
          select: {
            id: true,
            nickname: true,
            avatarUrl: true,
            countryCode: true,
            bio: true,
            lastActiveAt: true,
            interests: { include: { interest: true } },
          },
        },
        userB: {
          select: {
            id: true,
            nickname: true,
            avatarUrl: true,
            countryCode: true,
            bio: true,
            lastActiveAt: true,
            interests: { include: { interest: true } },
          },
        },
      },
    });

    return connections.map((connection) => {
      const peer = connection.userAId === userId ? connection.userB : connection.userA;
      const latestExchange = connection.conversation?.exchanges?.[0];
      return {
        id: connection.id,
        conversationId: connection.conversationId,
        createdAt: connection.createdAt,
        exchange: latestExchange
          ? {
              id: latestExchange.id,
              status: latestExchange.status,
              platforms: latestExchange.platforms,
              requesterId: latestExchange.requesterId,
              receiverId: latestExchange.receiverId,
              updatedAt: latestExchange.updatedAt,
            }
          : null,
        peer: {
          id: peer.id,
          nickname: peer.nickname,
          avatarUrl: peer.avatarUrl,
          countryCode: peer.countryCode,
          bio: peer.bio,
          lastActiveAt: peer.lastActiveAt,
          interests: peer.interests.map((row) => ({
            slug: row.interest.slug,
            name: row.interest.name,
            nameZh: row.interest.nameZh,
          })),
        },
      };
    });
  }

  async removeConnection(userId: string, connectionId: string) {
    const connection = await this.prisma.connection.findUnique({ where: { id: connectionId } });
    if (!connection || (connection.userAId !== userId && connection.userBId !== userId)) {
      throw new NotFoundException({
        success: false,
        error: { code: "CONNECTION_NOT_FOUND", message: "Connection not found" },
      });
    }
    await this.prisma.connection.update({
      where: { id: connectionId },
      data: { status: "REMOVED" },
    });
    return { removed: true };
  }

  private toRequestPayload(request: {
    id: string;
    senderId: string;
    receiverId: string;
    message: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    sender?: { id: string; nickname: string | null; avatarUrl: string | null; countryCode: string | null };
    receiver?: { id: string; nickname: string | null; avatarUrl: string | null; countryCode: string | null };
  }) {
    return {
      id: request.id,
      senderId: request.senderId,
      receiverId: request.receiverId,
      message: request.message,
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      sender: request.sender,
      receiver: request.receiver,
    };
  }

  private startOfToday() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }
}
