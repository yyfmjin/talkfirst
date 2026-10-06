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
   * reports one of their moments, `commentId` reports one of their comments.
   * A content report does **not** carry a user id — the author is read from the
   * content server-side, so a client cannot name a different account than the
   * content's owner. `messageId` is not a target: it is an evidence pointer
   * attached to a person report.
   */
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  momentId?: string;

  /** C2 — 评论举报的目标。作者同样由服务端从评论行读出来。 */
  @IsOptional()
  @IsUUID()
  commentId?: string;

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

    /**
     * C3 — 未读数从「最近 5 条里不是我发的」改成真正的「`lastReadAt` 之后、且不是我发的」。
     *
     * 旧算法是 `take: 5` 的副产品：它把「未读」理解成「最近几条里别人说的」，于是
     *   · 一个会话你从没打开过，最多也只显示 5；
     *   · 你读完之后**不会归零** —— 已读与未读在数据上没有任何区别。
     * 现在每个成员一行 `lastReadAt`，未读数才成为一个能被「打开会话」消掉的量。
     */
    const data = await Promise.all(
      memberships.map(async (membership) => {
        const peer = membership.conversation.members.find((member) => member.userId !== user.id);
        const lastMessage = membership.conversation.messages[0];
        const unreadCount = await this.unreadCountFor(user.id, membership);
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
    );

    return { success: true as const, data };
  }

  /**
   * C3 — 一个会话对某人而言的未读数。
   *
   * 三个排除：自己的消息（不需要提醒自己）、`SYSTEM`（建会话时的系统提示，不是人说的话）、
   * 已删除的。判据是时间戳：`createdAt > lastReadAt`。
   *
   * ## 为何是「逐会话一次 count」
   *
   * 每个会话的 `lastReadAt` 不同，所以一条 SQL 无法同时表达所有阈值：`groupBy` 只能按
   * 共同的下界分组，而共同下界（取最早的 `lastReadAt`）会**多算**读得晚的那些会话。
   * 会话数是「这个人的会话数」，量级在几十，而 `(conversationId, createdAt)` 上有索引，
   * 每次 count 都很便宜。
   *
   * **哪天出现「上千会话」的用户，这一行就是该改的地方** —— 换成为每个用户维护一个未读
   * 计数（写消息时 +1、读时清零），而不是继续逐个 count。
   */
  private async unreadCountFor(
    userId: string,
    membership: { conversationId: string; lastReadAt: Date | null },
  ): Promise<number> {
    return this.prisma.message.count({
      where: {
        conversationId: membership.conversationId,
        deletedAt: null,
        senderId: { not: userId },
        type: { not: "SYSTEM" },
        // `null` = 从未读过，所以不设下界（等于「全算未读」）。
        ...(membership.lastReadAt ? { createdAt: { gt: membership.lastReadAt } } : {}),
      },
    });
  }

  /**
   * C3 — 把会话标记为「读到此刻」。
   *
   * 用 `POST` 而不是把已读藏在「拉消息列表」里：那样一来「看了一眼列表」与「读了这个会话」
   * 就再也分不开了，而红点/计数恰恰依赖这个区别。
   *
   * 幂等：重复调用只是继续把 `lastReadAt` 往后推，结果一样是「读完了」。
   * 非成员一律 404，与消息列表同一口径 —— 不拿状态码泄漏会话是否存在。
   */
  @Post("conversations/:id/read")
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  async markConversationRead(
    @CurrentUser() user: AuthUser,
    @Param("id", UuidParamPipe) id: string,
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

    const lastReadAt = new Date();
    await this.prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: id, userId: user.id } },
      data: { lastReadAt },
    });

    // 读完会话 → 它的未读消息通知一并清掉。这是「未读期间只占一行」的另一半：
    // 只合并不清，用户会看到「12 条新消息」永远挂在那里。
    await this.notificationService.markConversationMessageNotificationsRead(user.id, id);

    return { success: true as const, data: { conversationId: id, lastReadAt, unreadCount: 0 } };
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
      /**
       * C3 — 发消息意味着你正看着这个会话，所以顺手把自己的已读位置推到现在。
       *
       * 不做也不会漏（自己发的消息本来就不计入未读），但做了之后你回复时，对方
       * 之前那几条不会以「仍未读」的形态留在会话列表上。
       * 放在同一个事务里：消息写进去了而已读没推进，是一个说不通的中间状态。
       */
      await tx.conversationMember.update({
        where: { conversationId_userId: { conversationId: id, userId: user.id } },
        data: { lastReadAt: new Date() },
      });
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
      await this.notificationService.notifyNewMessage({
        userId: peerId,
        actorId: user.id,
        conversationId: id,
        title: "New message",
        body: dto.content.trim().slice(0, 120),
      });
    }

    /**
     * C3 — 这里原本还返回一个 `peerUnread`：
     *
     *     await this.prisma.notification.count({ where: { userId: peerId, readAt: null } })
     *
     * 三处都不对：名字说「对方未读消息」，算的是**未读通知**（两张毫不相干的表）；
     * 全仓库**没有任何**客户端读它（只有这两行引用）；而且它把对方的未读计数透给了发送者。
     * 真正的未读消息数是会话列表里的 `unreadCount`（按各自的 `lastReadAt` 算），
     * 它才有资格叫这个名字。契约变更记在 `docs/P0-00-FIXES.md` FIX-11。
     */
    return { success: true as const, data: message };
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
      await this.notificationService.notifyNewMessage({
        userId: peerId,
        actorId: user.id,
        conversationId: id,
        title: "New image",
        body: "对方发来一张图片",
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
    /**
     * C2 — 目标现在有三个（人 / 动态 / 评论），规则仍是**恰好一个**。
     *
     * 报「人」与报「他发的内容」是两个不同的问题，所以同时给出两个目标的请求一律拒绝，
     * 而不是静默地优先其中一个 —— 后者会在审计记录里留下一条看不出到底在说什么的举报。
     * `messageId` **不算目标**：它只是附在人举报上的一条证据（见 P028 的注释）。
     */
    const targets = [dto.userId, dto.momentId, dto.commentId].filter(Boolean);
    if (targets.length !== 1) {
      throw new BadRequestException({
        success: false,
        error: {
          code: "INVALID_REPORT_TARGET",
          message: "Provide exactly one of userId, momentId or commentId",
        },
      });
    }

    let reportedUserId: string;
    if (dto.commentId) {
      reportedUserId = (await this.resolveCommentTarget(user.id, dto.commentId)).authorId;
    } else if (dto.momentId) {
      reportedUserId = (await this.resolveMomentTarget(user.id, dto.momentId)).authorId;
    } else {
      // 上面的计数已经保证到这里只剩 userId 一个可能。
      reportedUserId = await this.assertReportableUser(dto.userId as string);
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
    const messageId =
      dto.momentId || dto.commentId
        ? null
        : await this.assertReportableMessage(user.id, reportedUserId, dto.messageId);

    const report = await this.prisma.report.create({
      data: {
        reporterId: user.id,
        reportedUserId,
        momentId: dto.momentId ?? null,
        // A moment report and a message report are mutually exclusive in
        // practice, so a moment report never carries a message pointer.
        messageId,
        // C2 — 评论举报把自己的目标列上；三种目标在数据库里是三个可空列。
        commentId: dto.commentId ?? null,
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
   * C2 — 评论举报的目标解析。
   *
   * 评论既是**目标**（被举报的就是这条评论），又**自带证据**（管理端会读它的 `content`），
   * 所以它要同时满足 `momentId` 与 `messageId` 两边的规矩：
   *
   *  1. 评论必须存在。评论是**硬删除**的（`MomentComment` 没有 `deletedAt`），
   *     行没了就是没了，所以「查不到」已经覆盖了「已删除」这一种情况；
   *  2. 举报人必须**看得见那条动态** —— 用的是与详情/点赞/评论完全同一个
   *     `resolveMomentAccess`。没有这道闸，任何人拿一个评论 id 就能让管理端读到
   *     一条自己无权看的内容里的原话（这正是 audit P028 在消息上修过的同一个洞）；
   *  3. 被举报人必须是**评论的作者**，由服务端从行里读，客户端无法指定成别人。
   *
   * ## 为什么这里统一 404，而动态路径会回 403 `MOMENT_LOCKED`
   *
   * 动态路径回 403 是对的：那是用户正在尝试**打开某一个页面**，告诉他「你看不了」
   * 不泄露新东西。而这里传进来的是一串不透明 id，回 403 就等于确认「这条评论存在，
   * 只是你看不了」—— 同一个 `COMMENT_NOT_FOUND` 则什么都不确认。
   */
  private async resolveCommentTarget(
    viewerId: string,
    commentId: string,
  ): Promise<{ authorId: string }> {
    const comment = await this.prisma.momentComment.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        userId: true,
        user: { select: { status: true } },
        moment: { select: { userId: true } },
      },
    });
    const notFound = new NotFoundException({
      success: false,
      error: { code: "COMMENT_NOT_FOUND", message: "Comment not found" },
    });
    if (!comment || comment.user.status !== "ACTIVE") throw notFound;

    const access = await this.moments.resolveMomentAccess(viewerId, comment.moment.userId);
    if (access !== "allowed") throw notFound;

    return { authorId: comment.userId };
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
