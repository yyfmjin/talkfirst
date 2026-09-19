import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { SocialPlatform } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

const EXCHANGE_MESSAGE_LIMIT = 5;
const EXCHANGE_PLATFORMS_MAX = 3;

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  INSTAGRAM: "Instagram",
  TELEGRAM: "Telegram",
  WHATSAPP: "WhatsApp",
  DISCORD: "Discord",
  X: "X",
  TIKTOK: "TikTok",
  WECHAT: "WeChat",
  QQ: "QQ",
  STEAM: "Steam",
  YOUTUBE: "YouTube",
  FACEBOOK: "Facebook",
  TALKFIRST: "TalkFirst",
};

@Injectable()
export class ExchangeService {
  constructor(private readonly prisma: PrismaService) {}

  platformLabels() {
    return PLATFORM_LABELS;
  }

  async eligibility(userId: string, conversationId: string) {
    const context = await this.conversationContext(userId, conversationId);
    const messageCount = await this.prisma.message.count({
      where: {
        conversationId,
        type: "TEXT",
        deletedAt: null,
        senderId: { in: [context.me, context.peerId] },
      },
    });
    const pending = await this.pendingForConversation(conversationId);
    const exchanged = await this.acceptedForConversation(conversationId);
    return {
      conversationId,
      connectionId: context.connectionId,
      peer: context.peer,
      messageCount,
      requiredMessages: EXCHANGE_MESSAGE_LIMIT,
      eligible: messageCount >= EXCHANGE_MESSAGE_LIMIT && exchanged.length === 0,
      pending: pending.map((item) => this.toPayload(item)),
      exchanged: exchanged.map((item) => this.toPayload(item)),
      myAccounts: context.myAccounts,
    };
  }

  async request(
    userId: string,
    conversationId: string,
    platforms: SocialPlatform[],
    message?: string,
  ) {
    const context = await this.conversationContext(userId, conversationId);
    const normalized = [...new Set(platforms)];
    if (normalized.length === 0 || normalized.length > EXCHANGE_PLATFORMS_MAX) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "INVALID_PLATFORMS",
          message: `Select 1-${EXCHANGE_PLATFORMS_MAX} platforms`,
        },
      });
    }
    for (const platform of normalized) {
      if (!(platform in PLATFORM_LABELS)) {
        throw new BadRequestException({
          success: false,
          error: { code: "INVALID_PLATFORM", message: `Unknown platform: ${platform}` },
        });
      }
    }

    const messageCount = await this.prisma.message.count({
      where: { conversationId, type: "TEXT", deletedAt: null },
    });
    if (messageCount < EXCHANGE_MESSAGE_LIMIT) {
      throw new ForbiddenException({
        success: false,
        error: {
          code: "NOT_ELIGIBLE_YET",
          message: `Chat a little more first (${messageCount}/${EXCHANGE_MESSAGE_LIMIT} messages)`,
        },
      });
    }

    const accepted = await this.acceptedForConversation(conversationId);
    if (accepted.length > 0) {
      throw new ForbiddenException({
        success: false,
        error: { code: "ALREADY_EXCHANGED", message: "Contact exchange is already completed" },
      });
    }

    const pending = await this.pendingForConversation(conversationId);
    if (pending.length > 0) {
      throw new ForbiddenException({
        success: false,
        error: { code: "EXCHANGE_PENDING", message: "An exchange request is already pending" },
      });
    }

    const requestedOwned = await this.prisma.socialAccount.findMany({
      where: { userId, platform: { in: normalized } },
    });
    if (requestedOwned.length !== normalized.length) {
      throw new ForbiddenException({
        success: false,
        error: {
          code: "ACCOUNT_REQUIRED",
          message: "Add your account for each requested platform first",
        },
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const exchange = await tx.exchangeRequest.create({
        data: {
          connectionId: context.connectionId,
          conversationId,
          requesterId: userId,
          receiverId: context.peerId,
          platforms: normalized,
          message: message?.trim().slice(0, 200) || undefined,
        },
        include: {
          requester: { select: { id: true, nickname: true, avatarUrl: true, countryCode: true } },
          receiver: { select: { id: true, nickname: true, avatarUrl: true, countryCode: true } },
        },
      });
      await tx.message.create({
        data: {
          conversationId,
          senderId: userId,
          type: "SYSTEM",
          content: `🔗 ${exchange.requester.nickname ?? "Someone"} requested contact exchange (${normalized.map((p) => PLATFORM_LABELS[p]).join("、")})`,
        },
      });
      await tx.notification.create({
        data: {
          userId: context.peerId,
          type: "EXCHANGE_REQUEST",
          title: "🔗 Contact exchange request",
          body: `${exchange.requester.nickname ?? "Someone"} wants to exchange ${normalized.map((p) => PLATFORM_LABELS[p]).join("、")}`,
          data: JSON.stringify({ exchangeId: exchange.id, conversationId }),
        },
      });
      return exchange;
    });

    return this.toPayload(created);
  }

  async respond(userId: string, exchangeId: string, action: "accept" | "reject") {
    const exchange = await this.prisma.exchangeRequest.findUnique({
      where: { id: exchangeId },
      include: {
        requester: { select: { id: true, nickname: true } },
      },
    });
    if (!exchange || exchange.receiverId !== userId) {
      throw new NotFoundException({
        success: false,
        error: { code: "EXCHANGE_NOT_FOUND", message: "Exchange request not found" },
      });
    }
    if (exchange.status !== "PENDING") {
      throw new ForbiddenException({
        success: false,
        error: { code: "EXCHANGE_HANDLED", message: "This exchange request was already handled" },
      });
    }

    if (action === "reject") {
      const updated = await this.prisma.exchangeRequest.update({
        where: { id: exchangeId },
        data: { status: "REJECTED" },
        include: {
          requester: { select: { id: true, nickname: true, avatarUrl: true, countryCode: true } },
          receiver: { select: { id: true, nickname: true, avatarUrl: true, countryCode: true } },
        },
      });
      await this.prisma.message.create({
        data: {
          conversationId: exchange.conversationId,
          senderId: userId,
          type: "SYSTEM",
          content: "Contact exchange was declined. Keep chatting first.",
        },
      });
      return { exchange: this.toPayload(updated), shared: null };
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const receiverAccounts = await tx.socialAccount.findMany({
        where: { userId, platform: { in: exchange.platforms } },
      });
      if (receiverAccounts.length !== exchange.platforms.length) {
        throw new ForbiddenException({
          success: false,
          error: {
            code: "ACCOUNT_REQUIRED",
            message: "Add your account for each requested platform before accepting",
          },
        });
      }
      const requesterAccounts = await tx.socialAccount.findMany({
        where: { userId: exchange.requesterId, platform: { in: exchange.platforms } },
      });
      if (requesterAccounts.length !== exchange.platforms.length) {
        throw new ForbiddenException({
          success: false,
          error: {
            code: "ACCOUNT_REQUIRED",
            message: "The requester no longer has an account for every requested platform",
          },
        });
      }

      // Per-pair authorization: create grants for THIS exchange's two parties
      // only. Never rely on the account-global `visibility` column to decide who
      // may read a handle — that is what allowed a third party in another
      // conversation to see an account that was never shared with them.
      const grants = [
        ...requesterAccounts.map((account) => ({
          ownerId: exchange.requesterId,
          viewerId: exchange.receiverId,
          platform: account.platform,
          socialAccountId: account.id,
          exchangeId: exchange.id,
        })),
        ...receiverAccounts.map((account) => ({
          ownerId: exchange.receiverId,
          viewerId: exchange.requesterId,
          platform: account.platform,
          socialAccountId: account.id,
          exchangeId: exchange.id,
        })),
      ];
      await tx.sharedSocialAccount.createMany({ data: grants, skipDuplicates: true });

      const updated = await tx.exchangeRequest.update({
        where: { id: exchangeId },
        data: { status: "ACCEPTED" },
        include: {
          requester: { select: { id: true, nickname: true, avatarUrl: true, countryCode: true } },
          receiver: { select: { id: true, nickname: true, avatarUrl: true, countryCode: true } },
        },
      });
      await tx.message.create({
        data: {
          conversationId: exchange.conversationId,
          senderId: userId,
          type: "SYSTEM",
          content: `🎉 Contact exchange accepted. You can now see each other's ${exchange.platforms.map((p) => PLATFORM_LABELS[p]).join("、")}.`,
        },
      });
      await tx.notification.create({
        data: {
          userId: exchange.requesterId,
          type: "EXCHANGE_ACCEPTED",
          title: "🎉 Contact exchange accepted",
          body: "Check Connections to see each other's accounts.",
          data: JSON.stringify({ exchangeId, conversationId: exchange.conversationId }),
        },
      });
      const shared = await this.sharedAccountsForPair(
        tx,
        exchange.requesterId,
        exchange.receiverId,
        exchange.platforms,
      );
      return { updated, shared };
    });

    return { exchange: this.toPayload(result.updated), shared: result.shared };
  }

  async cancel(userId: string, exchangeId: string) {
    const exchange = await this.prisma.exchangeRequest.findUnique({ where: { id: exchangeId } });
    if (!exchange || exchange.requesterId !== userId) {
      throw new NotFoundException({
        success: false,
        error: { code: "EXCHANGE_NOT_FOUND", message: "Exchange request not found" },
      });
    }
    if (exchange.status !== "PENDING") {
      throw new ForbiddenException({
        success: false,
        error: { code: "EXCHANGE_HANDLED", message: "This exchange request was already handled" },
      });
    }
    const updated = await this.prisma.exchangeRequest.update({
      where: { id: exchangeId },
      data: { status: "CANCELLED" },
    });
    return this.toPayload(updated);
  }

  async sharedContacts(userId: string, conversationId: string) {
    const context = await this.conversationContext(userId, conversationId);
    const accepted = await this.acceptedForConversation(conversationId);
    if (accepted.length === 0) return { exchanged: false, contacts: [] };

    // Read only this pair's grants, scoped to the current conversation peer.
    // Querying by platform alone (the previous behaviour) leaked any account on
    // that platform, including ones shared with a completely different user.
    const accounts = await this.sharedAccountsForPair(
      this.prisma,
      context.me,
      context.peerId,
      null,
    );
    return {
      exchanged: true,
      contacts: accounts
        .filter((account) => account.userId !== context.me)
        .map((account) => ({
          userId: account.userId,
          nickname: account.user.nickname,
          platform: account.platform,
          label: PLATFORM_LABELS[account.platform],
          handle: account.handle,
        })),
    };
  }

  /**
   * Returns the SocialAccount rows that `ownerId` has explicitly granted to
   * `viewerId` (and vice versa) — the only sanctioned way to read a handle.
   * Pass `platforms` to narrow to a specific exchange's platforms, or null for
   * every platform the pair has ever exchanged.
   */
  private async sharedAccountsForPair(
    client: Pick<PrismaService, "sharedSocialAccount">,
    userAId: string,
    userBId: string,
    platforms: SocialPlatform[] | null,
  ) {
    const grants = await client.sharedSocialAccount.findMany({
      where: {
        OR: [
          { ownerId: userAId, viewerId: userBId },
          { ownerId: userBId, viewerId: userAId },
        ],
        ...(platforms ? { platform: { in: platforms } } : {}),
      },
      select: { socialAccountId: true },
    });
    const ids = [...new Set(grants.map((grant) => grant.socialAccountId))];
    if (ids.length === 0) return [];
    return this.prisma.socialAccount.findMany({
      where: { id: { in: ids } },
      include: { user: { select: { id: true, nickname: true } } },
      orderBy: [{ userId: "asc" }, { platform: "asc" }],
    });
  }

  private async conversationContext(userId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, nickname: true, avatarUrl: true, countryCode: true },
            },
          },
        },
        connection: { select: { id: true, status: true } },
      },
    });
    if (!conversation || !conversation.members.some((member) => member.userId === userId)) {
      throw new NotFoundException({
        success: false,
        error: { code: "CONVERSATION_NOT_FOUND", message: "Conversation not found" },
      });
    }
    if (!conversation.connection || conversation.connection.status !== "ACTIVE") {
      throw new ForbiddenException({
        success: false,
        error: { code: "NO_ACTIVE_CONNECTION", message: "No active connection for this conversation" },
      });
    }
    const peer = conversation.members.find((member) => member.userId !== userId);
    if (!peer) {
      throw new NotFoundException({
        success: false,
        error: { code: "PEER_NOT_FOUND", message: "Conversation peer not found" },
      });
    }
    const blocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedId: peer.userId },
          { blockerId: peer.userId, blockedId: userId },
        ],
      },
    });
    if (blocked) {
      throw new ForbiddenException({
        success: false,
        error: { code: "BLOCKED", message: "You cannot exchange contacts" },
      });
    }
    const myAccounts = await this.prisma.socialAccount.findMany({
      where: { userId },
      orderBy: { platform: "asc" },
    });
    return {
      me: userId,
      peerId: peer.userId,
      peer: peer.user,
      connectionId: conversation.connection.id,
      myAccounts: myAccounts.map((account) => ({
        id: account.id,
        platform: account.platform,
        label: PLATFORM_LABELS[account.platform],
        handle: account.handle,
      })),
    };
  }

  private pendingForConversation(conversationId: string) {
    return this.prisma.exchangeRequest.findMany({
      where: { conversationId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      include: {
        requester: { select: { id: true, nickname: true, avatarUrl: true, countryCode: true } },
        receiver: { select: { id: true, nickname: true, avatarUrl: true, countryCode: true } },
      },
    });
  }

  private acceptedForConversation(conversationId: string) {
    return this.prisma.exchangeRequest.findMany({
      where: { conversationId, status: "ACCEPTED" },
      orderBy: { createdAt: "desc" },
      include: {
        requester: { select: { id: true, nickname: true, avatarUrl: true, countryCode: true } },
        receiver: { select: { id: true, nickname: true, avatarUrl: true, countryCode: true } },
      },
    });
  }

  private toPayload(exchange: {
    id: string;
    connectionId: string;
    conversationId: string;
    requesterId: string;
    receiverId: string;
    platforms: SocialPlatform[];
    message: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    requester?: { id: string; nickname: string | null; avatarUrl: string | null; countryCode: string | null };
    receiver?: { id: string; nickname: string | null; avatarUrl: string | null; countryCode: string | null };
  }) {
    return {
      id: exchange.id,
      connectionId: exchange.connectionId,
      conversationId: exchange.conversationId,
      requesterId: exchange.requesterId,
      receiverId: exchange.receiverId,
      platforms: exchange.platforms.map((platform) => ({ id: platform, label: PLATFORM_LABELS[platform] })),
      message: exchange.message,
      status: exchange.status,
      createdAt: exchange.createdAt,
      updatedAt: exchange.updatedAt,
      requester: exchange.requester,
      receiver: exchange.receiver,
    };
  }
}
