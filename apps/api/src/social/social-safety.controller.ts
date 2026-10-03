import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { NotificationService } from "../notifications/notification.service";
import { PrismaService } from "../prisma/prisma.service";
import { SafetyService } from "../safety/safety.service";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { assertNotBlocked } from "../common/block-guard";
import { assertConnectionActive, requireActiveAccount } from "../common/connection-guard";
import { keysetFilterAfter, keysetNextCursor, keysetOrderBy, parseKeysetCursor } from "../common/keyset-cursor";
import { UuidParamPipe } from "../common/uuid-param.pipe";
import { ValidationPipe } from "../common/validation.pipe";
import { Throttle } from "@nestjs/throttler";
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import { MomentsService } from "../moments/moments.service";

class SendMessageDto {
  @IsString()
  @MaxLength(2000)
  content!: string;
}

class SendImageDto {
  @IsString()
  @MaxLength(2000)
  imageUrl!: string;
}

class ReportDto {
  /**
   * Exactly one target per request: `userId` reports a person, `momentId`
   * reports one of their moments. A moment report does **not** carry a user id
   * — the author is read from the moment server-side, so a client cannot name a
   * different account than the content's owner.
   */
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  momentId?: string;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsUUID()
  messageId?: string;
}

class BlockDto {
  /**
   * FIX (audit P031): this used to be a bare `@IsString()`, so a non-UUID or a
   * non-existent id reached `block.upsert()` and tripped the `Block.blockedId`
   * foreign key, which surfaced as a 500 `INTERNAL_ERROR` instead of a 404.
   */
  @IsUUID()
  userId!: string;

  @IsOptional()
  @IsBoolean()
  hideHistory?: boolean;
}

@Controller()
@UseGuards(JwtAuthGuard)
export class SocialSafetyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyService,
    private readonly moments: MomentsService,
    /**
     * PC-3.1b — the one writer of notifications, called by the message routes
     * below.
     *
     * The read routes that used to live on this controller moved to
     * `NotificationsController` in PC-3.1d, so the field no longer has to dodge
     * a `notifications()` method declared on this class.
     */
    private readonly notificationService: NotificationService,
  ) {}

  @Get("conversations")
  async conversations(@CurrentUser() user: AuthUser) {
    const memberships = await this.prisma.conversationMember.findMany({
      where: { userId: user.id },
      include: {
        conversation: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    nickname: true,
                    avatarUrl: true,
                    countryCode: true,
                    lastActiveAt: true,
                  },
                },
              },
            },
            messages: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 5 },
            connection: { select: { id: true, status: true } },
          },
        },
      },
      orderBy: { conversation: { updatedAt: "desc" } },
    });

    return {
      success: true as const,
      data: memberships.map((membership) => {
        const peer = membership.conversation.members.find((member) => member.userId !== user.id);
        const lastMessage = membership.conversation.messages[0];
        const unreadCount = membership.conversation.messages.filter(
          (message) => message.senderId !== user.id && message.type !== "SYSTEM",
        ).length;
        return {
          id: membership.conversation.id,
          connectionId: membership.conversation.connection?.id ?? null,
          peer: peer?.user ?? null,
          unreadCount,
          lastMessage: lastMessage
            ? {
                id: lastMessage.id,
                content: lastMessage.content,
                type: lastMessage.type,
                senderId: lastMessage.senderId,
                createdAt: lastMessage.createdAt,
              }
            : null,
          updatedAt: membership.conversation.updatedAt,
        };
      }),
    };
  }

  @Get("conversations/:id/messages")
  async messages(
    @CurrentUser() user: AuthUser,
    @Param("id", UuidParamPipe) id: string,
    @Query("limit") limitRaw?: string,
    @Query("cursor") cursor?: string,
  ) {
    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: user.id } },
    });
    if (!membership) {
      throw new NotFoundException({
        success: false,
        error: { code: "CONVERSATION_NOT_FOUND", message: "Conversation not found" },
      });
    }
    const limit = Math.min(Math.max(Number(limitRaw ?? 30) || 30, 1), 100);
    /**
     * FIX (audit P021 / P030) — chat history paginates on the shared
     * `(createdAt, id)` keyset cursor.
     *
     * Three defects here:
     *
     *  1. `createdAt` alone, so two messages sent in the same millisecond could
     *     not be ordered against the cursor and one of the pair was skipped.
     *     `POST /conversations/:id/messages` plus a fast client, or a WebSocket
     *     burst, makes that reachable rather than theoretical.
     *  2. `nextCursor` was emitted whenever the page was *full*
     *     (`messages.length === limit`), with no look-ahead. A conversation whose
     *     length was an exact multiple of `limit` therefore advertised one extra,
     *     empty page.
     *  3. A malformed cursor reached Prisma as `new Date("garbage")` → an
     *     `Invalid Date` → a `500 INTERNAL_ERROR` for a plainly bad request.
     *
     * The page is returned oldest-first (the caller is a chat view), so the
     * cursor row is the LAST element of the returned array — that is the oldest
     * row of the page, which is where a descending walk resumes.
     */
    const cursorPosition = parseKeysetCursor(cursor);
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId: id,
        deletedAt: null,
        ...keysetFilterAfter(cursorPosition),
      },
      orderBy: keysetOrderBy,
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const items = [...page].reverse();
    return {
      success: true as const,
      data: {
        items,
        nextCursor: keysetNextCursor(rows.length, limit, items),
      },
    };
  }

  @Post("conversations/:id/messages")
  async sendMessage(
    @CurrentUser() user: AuthUser,
    @Param("id", UuidParamPipe) id: string,
    @Body(new ValidationPipe()) dto: SendMessageDto,
  ) {
    // P002/P003/P0-2: membership + live account status + ACTIVE connection +
    // no block in either direction. All three rules live in one place so the
    // text path cannot drift from the image path.
    const { peerId } = await this.assertCanSendInConversation(user.id, id);

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { conversationId: id, senderId: user.id, type: "TEXT", content: dto.content.trim() },
      });
      await tx.conversation.update({ where: { id }, data: { updatedAt: new Date() } });
      return created;
    });

    const scan = this.safety.scanText(message.content);
    if (scan.blocked) {
      await this.prisma.message.update({
        where: { id: message.id },
        data: { deletedAt: new Date() },
      });
      throw new ForbiddenException({
        success: false,
        error: { code: "MESSAGE_BLOCKED", message: "This message cannot be sent" },
      });
    }
    if (scan.level === "HIGH") {
      await this.safety.recordAutoFlag({
        userId: user.id,
        reasons: scan.reasons,
        messageId: message.id,
        source: "chat message",
        level: scan.level,
      });
    }

    if (peerId) {
      await this.notificationService.notify({
        userId: peerId,
        type: "NEW_MESSAGE",
        title: "New message",
        body: dto.content.trim().slice(0, 120),
        data: {
          actorId: user.id,
          targetType: "CONVERSATION",
          targetId: id,
          conversationId: id,
          messageId: message.id,
        },
      });
    }

    const peerUnread = peerId
      ? await this.prisma.notification.count({ where: { userId: peerId, readAt: null } })
      : 0;
    return { success: true as const, data: { ...message, peerUnread } };
  }

  @Post("conversations/:id/messages/image")
  async sendImageMessage(
    @CurrentUser() user: AuthUser,
    @Param("id", UuidParamPipe) id: string,
    @Body(new ValidationPipe()) dto: SendImageDto,
  ) {
    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: user.id } },
    });
    if (!membership) {
      throw new NotFoundException({
        success: false,
        error: { code: "CONVERSATION_NOT_FOUND", message: "Conversation not found" },
      });
    }
    if (!this.isAllowedImageUrl(dto.imageUrl)) {
      throw new ForbiddenException({
        success: false,
        error: { code: "INVALID_IMAGE", message: "Image must be an https URL" },
      });
    }
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: { members: true },
    });
    const peerId = conversation?.members.find((member) => member.userId !== user.id)?.userId;
    // P0-2: same guard as the text path — an image must not bypass a block.
    await assertNotBlocked(this.prisma, user.id, peerId);
    // P002/P003: an image must not bypass the account or connection rule either.
    await requireActiveAccount(this.prisma, user.id);
    if (peerId) {
      await assertConnectionActive(this.prisma, id, user.id, peerId);
    }
    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { conversationId: id, senderId: user.id, type: "IMAGE", content: dto.imageUrl },
      });
      await tx.conversation.update({ where: { id }, data: { updatedAt: new Date() } });
      return created;
    });
    if (peerId) {
      await this.notificationService.notify({
        userId: peerId,
        type: "NEW_MESSAGE",
        title: "New image",
        body: "对方发来一张图片",
        data: {
          actorId: user.id,
          targetType: "CONVERSATION",
          targetId: id,
          conversationId: id,
          messageId: message.id,
        },
      });
    }
    return { success: true as const, data: message };
  }

  @Delete("messages/:id")
  async deleteMessage(@CurrentUser() user: AuthUser, @Param("id", UuidParamPipe) id: string) {
    const message = await this.prisma.message.findUnique({
      where: { id },
      include: { conversation: { include: { members: { select: { userId: true } } } } },
    });
    if (
      !message ||
      message.deletedAt ||
      message.senderId !== user.id ||
      !message.conversation.members.some((member) => member.userId === user.id)
    ) {
      throw new NotFoundException({
        success: false,
        error: { code: "MESSAGE_NOT_FOUND", message: "Message not found" },
      });
    }
    if (message.type === "SYSTEM") {
      throw new ForbiddenException({
        success: false,
        error: { code: "CANNOT_DELETE_SYSTEM", message: "System messages cannot be deleted" },
      });
    }
    const ageMs = Date.now() - message.createdAt.getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      throw new ForbiddenException({
        success: false,
        error: { code: "DELETE_EXPIRED", message: "Messages can only be deleted within 24 hours" },
      });
    }
    await this.prisma.message.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true as const, data: { deleted: true } };
  }

  private isAllowedImageUrl(raw: string) {
    if (/^https:\/\/\S{4,2000}$/.test(raw)) return true;
    if (process.env.NODE_ENV !== "production" && /^http:\/\/localhost(:\d+)?\/\S{1,2000}$/.test(raw)) {
      return true;
    }
    return false;
  }

  @Post("messages/safety-scan")
  async safetyScan(@CurrentUser() user: AuthUser, @Body(new ValidationPipe()) dto: SendMessageDto) {
    void user;
    const scan = this.safety.scanText(dto.content ?? "");
    return {
      success: true as const,
      data: {
        ...scan,
        links: this.safety.extractLinks(dto.content ?? ""),
        warning: scan.hasExternalLink
          ? "⚠️ 小心外部链接。TalkFirst 不会向你索要钱款或验证码。"
          : scan.hasContactLeak
            ? "请通过「交换联系方式」交换账号，不要直接在聊天里发送。"
            : null,
      },
    };
  }

  @Post("reports")
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async report(@CurrentUser() user: AuthUser, @Body(new ValidationPipe()) dto: ReportDto) {
    const allowed = [
      "Harassment",
      "Spam",
      "Scam",
      "Sexual content",
      "Hate speech",
      "Fake profile",
      "Other",
    ];
    if (!allowed.includes(dto.reason)) {
      throw new ForbiddenException({
        success: false,
        error: { code: "INVALID_REASON", message: "Invalid report reason" },
      });
    }
    // Reporting a person and reporting their content are different questions,
    // so a request naming both is rejected rather than silently preferring one.
    if (dto.userId && dto.momentId) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "INVALID_REPORT_TARGET",
          message: "Provide either userId or momentId, not both",
        },
      });
    }

    let reportedUserId: string;
    if (dto.momentId) {
      reportedUserId = (await this.resolveMomentTarget(user.id, dto.momentId)).authorId;
    } else if (dto.userId) {
      reportedUserId = await this.assertReportableUser(dto.userId);
    } else {
      throw new BadRequestException({
        success: false,
        error: {
          code: "INVALID_REPORT_TARGET",
          message: "Provide either userId or momentId",
        },
      });
    }

    if (reportedUserId === user.id) {
      throw new ForbiddenException({
        success: false,
        error: { code: "CANNOT_REPORT_SELF", message: "You cannot report yourself" },
      });
    }

    /**
     * FIX (audit P028) — a message pointer must be one the reporter can
     * actually see, and it must belong to the reported user.
     *
     * `messageId` was stored verbatim after nothing more than an `@IsUUID()`
     * check. An admin opening the report sees that message's `content` and its
     * sender's e-mail (`AdminService.reportDetail`), so anyone could attach an
     * arbitrary third party's message id as "evidence" and have a moderator read
     * a conversation they were never part of. Nothing leaked to the *reporter*
     * directly, which is why this is an integrity defect rather than an
     * exfiltration one — but it corrupts exactly the queue a moderator trusts.
     *
     * The rule now: the message must exist, the reporter must be a participant of
     * its conversation, and its sender must be the user being reported. A
     * mismatch is a 404 on the message, which also avoids confirming that an id
     * the caller cannot see exists.
     */
    const messageId = dto.momentId ? null : await this.assertReportableMessage(user.id, reportedUserId, dto.messageId);

    const report = await this.prisma.report.create({
      data: {
        reporterId: user.id,
        reportedUserId,
        momentId: dto.momentId ?? null,
        // A moment report and a message report are mutually exclusive in
        // practice, so a moment report never carries a message pointer.
        messageId,
        reason: dto.reason,
        description: dto.description,
      },
    });
    // Minimal projection: the reporter already knows what they reported, and a
    // raw report row carries columns (both party ids, the stored pointers) that
    // are not part of the client contract.
    return {
      success: true as const,
      data: { id: report.id, status: report.status, createdAt: report.createdAt },
    };
  }

  /**
   * Validates a `messageId` pointer (audit P028) — see the call site for why.
   * Returns `null` when no pointer was supplied.
   */
  private async assertReportableMessage(
    reporterId: string,
    reportedUserId: string,
    messageId: string | undefined,
  ): Promise<string | null> {
    if (!messageId) return null;
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        senderId: true,
        conversation: { select: { members: { select: { userId: true } } } },
      },
    });
    const memberIds = message?.conversation.members.map((member) => member.userId) ?? [];
    const reporterIsMember = memberIds.includes(reporterId);
    if (!message || !reporterIsMember || message.senderId !== reportedUserId) {
      throw new NotFoundException({
        success: false,
        error: { code: "MESSAGE_NOT_FOUND", message: "Message not found" },
      });
    }
    return message.id;
  }

  /** The reported user's id, or a 404 when no such account exists. */
  private async assertReportableUser(userId: string): Promise<string> {
    const reported = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!reported) {
      throw new NotFoundException({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }
    return reported.id;
  }

  /**
   * The moment's author, once the viewer is allowed to see that moment.
   *
   * The gate is `MomentsService.resolveMomentAccess` — the same rule the detail,
   * like and comment endpoints use — so a report can never reach a moment the
   * viewer could not otherwise open. It covers private moments and both
   * directions of a block. An unknown moment (or one whose author is no longer
   * ACTIVE) is a 404 `MOMENT_NOT_FOUND`; an inaccessible one is a 403
   * `MOMENT_LOCKED`, matching the detail endpoint instead of inventing a second
   * answer to the same question.
   */
  private async resolveMomentTarget(
    viewerId: string,
    momentId: string,
  ): Promise<{ authorId: string }> {
    const moment = await this.prisma.moment.findUnique({
      where: { id: momentId },
      select: { userId: true, user: { select: { status: true } } },
    });
    if (!moment || moment.user.status !== "ACTIVE") {
      throw new NotFoundException({
        success: false,
        error: { code: "MOMENT_NOT_FOUND", message: "Moment not found" },
      });
    }
    const access = await this.moments.resolveMomentAccess(viewerId, moment.userId);
    if (access !== "allowed") {
      throw new ForbiddenException({
        success: false,
        error: { code: "MOMENT_LOCKED", message: "Moment is not accessible" },
      });
    }
    return { authorId: moment.userId };
  }

  @Post("blocks")
  async block(@CurrentUser() user: AuthUser, @Body(new ValidationPipe()) dto: BlockDto) {
    if (dto.userId === user.id) {
      throw new ForbiddenException({
        success: false,
        error: { code: "CANNOT_BLOCK_SELF", message: "You cannot block yourself" },
      });
    }
    await this.prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId: user.id, blockedId: dto.userId } },
      update: {},
      create: { blockerId: user.id, blockedId: dto.userId },
    });
    // Cancel pending requests in both directions when blocking.
    await this.prisma.connectionRequest.updateMany({
      where: {
        status: "PENDING",
        OR: [
          { senderId: user.id, receiverId: dto.userId },
          { senderId: dto.userId, receiverId: user.id },
        ],
      },
      data: { status: "CANCELLED" },
    });
    // Cancel pending contact-exchange requests involving the blocked user.
    await this.prisma.exchangeRequest.updateMany({
      where: {
        status: "PENDING",
        OR: [{ requesterId: dto.userId }, { receiverId: dto.userId }],
        conversation: { members: { some: { userId: user.id } } },
      },
      data: { status: "CANCELLED" },
    });
    let hiddenMessages = 0;
    const hideHistory = dto.hideHistory === true || (dto as unknown as { hideHistory?: string }).hideHistory === "true";
    if (hideHistory) {
      const shared = await this.prisma.conversationMember.findMany({
        where: { userId: user.id },
        select: { conversationId: true },
      });
      const sharedIds = shared.map((row) => row.conversationId);
      if (sharedIds.length > 0) {
        const peerMemberships = await this.prisma.conversationMember.findMany({
          where: { conversationId: { in: sharedIds }, userId: dto.userId },
          select: { conversationId: true },
        });
        const targetIds = peerMemberships.map((row) => row.conversationId);
        if (targetIds.length > 0) {
          const hidden = await this.prisma.message.updateMany({
            where: { conversationId: { in: targetIds }, deletedAt: null },
            data: { deletedAt: new Date() },
          });
          hiddenMessages = hidden.count;
        }
      }
    }
    return { success: true as const, data: { blocked: true, hiddenMessages } };
  }

  @Get("blocks")
  async blocks(@CurrentUser() user: AuthUser) {
    const items = await this.prisma.block.findMany({
      where: { blockerId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        blocked: {
          select: { id: true, nickname: true, avatarUrl: true, countryCode: true },
        },
      },
    });
    return { success: true as const, data: items };
  }

  @Delete("blocks/:userId")
  async unblock(@CurrentUser() user: AuthUser, @Param("userId", UuidParamPipe) blockedId: string) {
    await this.prisma.block.deleteMany({
      where: { blockerId: user.id, blockedId },
    });
    return { success: true as const, data: { unblocked: true } };
  }

  @Get("reports/mine")
  async myReports(@CurrentUser() user: AuthUser) {
    const items = await this.prisma.report.findMany({
      where: { reporterId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        reportedUser: {
          select: { id: true, nickname: true, avatarUrl: true, countryCode: true },
        },
      },
    });
    return { success: true as const, data: items };
  }

  /**
   * FIX (audit P002/P003) — the one gate every message send passes through.
   *
   * Three independent rules, in the order that matters:
   *   1. the caller must be a member of this conversation;
   *   2. the caller's account must still be ACTIVE — HTTP already re-read the
   *      row in `JwtStrategy`, but doing it here keeps the rule with the data
   *      instead of depending on a token minted minutes ago;
   *   3. the connection behind the conversation must still be ACTIVE, and no
   *      block may exist in either direction.
   *
   * Rule 3 is what was missing: removing a connection left the conversation (and
   * its membership rows) intact, so the pair could keep messaging forever after
   * the relationship had visibly ended.
   *
   * Throws the canonical `CONVERSATION_NOT_FOUND` (404), `USER_DISABLED`-family
   * (403), `CONNECTION_REMOVED` (403) or `BLOCKED` (403) errors.
   */
  private async assertCanSendInConversation(userId: string, conversationId: string) {
    const membership = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!membership) {
      throw new NotFoundException({
        success: false,
        error: { code: "CONVERSATION_NOT_FOUND", message: "Conversation not found" },
      });
    }

    await requireActiveAccount(this.prisma, userId);

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { members: { select: { userId: true } } },
    });
    const peerId = conversation?.members.find((member) => member.userId !== userId)?.userId;
    if (!peerId) {
      throw new NotFoundException({
        success: false,
        error: { code: "CONVERSATION_NOT_FOUND", message: "Conversation not found" },
      });
    }

    await assertConnectionActive(this.prisma, conversationId, userId, peerId);
    // P0-2: unified block check — any-direction block rejects with BLOCKED.
    await assertNotBlocked(this.prisma, userId, peerId);

    return { peerId };
  }
}
