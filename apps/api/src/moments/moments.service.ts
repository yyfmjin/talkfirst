import { Injectable } from "@nestjs/common";
import { NotificationService } from "../notifications/notification.service";
import { PrismaService } from "../prisma/prisma.service";
import { SafetyService } from "../safety/safety.service";

export const MOMENT_PLATFORMS = [
  { id: "TALKFIRST", label: "TalkFirst", icon: "TF", color: "#6572D8", connectedLabel: "站内动态" },
  { id: "INSTAGRAM", label: "Instagram", icon: "IG", color: "#E1306C", connectedLabel: "已连接用户主页" },
  { id: "X", label: "X", icon: "X", color: "#111111", connectedLabel: "已连接时间线" },
  { id: "TIKTOK", label: "TikTok", icon: "TT", color: "#010101", connectedLabel: "已连接短视频" },
  { id: "YOUTUBE", label: "YouTube", icon: "YT", color: "#FF0000", connectedLabel: "已连接频道" },
  { id: "FACEBOOK", label: "Facebook", icon: "FB", color: "#1877F2", connectedLabel: "已连接主页" },
] as const;

export type MomentPlatformId = (typeof MOMENT_PLATFORMS)[number]["id"];

const PLATFORM_SET = new Set<string>(MOMENT_PLATFORMS.map((item) => item.id));

export type MomentAccess = "allowed" | "locked";

@Injectable()
export class MomentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly safety: SafetyService,
    /** PC-3.1b — the one writer of notifications; see `NotificationService`. */
    private readonly notifications: NotificationService,
  ) {}

  platforms() {
    return [...MOMENT_PLATFORMS];
  }

  // Single source of truth for "may this viewer see this author's moments?".
  // private  -> author only
  // connections -> author + ACTIVE connection, and neither side blocked
  // everyone -> anyone, unless blocked
  async resolveMomentAccess(viewerId: string, authorId: string): Promise<MomentAccess> {
    if (viewerId === authorId) return "allowed";
    const setting = await this.prisma.momentSetting.findUnique({ where: { userId: authorId } });
    const visibleTo = setting?.visibleTo ?? "everyone";
    if (visibleTo === "private") return "locked";
    const blocked = await this.prisma.block.findFirst({
      where: {
        OR: [
          { blockerId: viewerId, blockedId: authorId },
          { blockerId: authorId, blockedId: viewerId },
        ],
      },
    });
    if (blocked) return "locked";
    if (visibleTo === "connections") {
      const connected = await this.prisma.connection.findFirst({
        where: {
          status: "ACTIVE",
          OR: [
            { userAId: viewerId, userBId: authorId },
            { userAId: authorId, userBId: viewerId },
          ],
        },
      });
      return connected ? "allowed" : "locked";
    }
    return visibleTo === "everyone" ? "allowed" : "locked";
  }

  private lockedError(): Error & { code?: string; status?: number } {
    const error = new Error("MOMENT_LOCKED") as Error & { code?: string; status?: number };
    error.code = "MOMENT_LOCKED";
    error.status = 403;
    return error;
  }

  private async assertCanInteract(viewerId: string, authorId: string) {
    const access = await this.resolveMomentAccess(viewerId, authorId);
    if (access !== "allowed") throw this.lockedError();
  }

  assertPlatform(platform: string) {
    if (!PLATFORM_SET.has(platform)) {
      const error = new Error("UNKNOWN_PLATFORM") as Error & { code?: string };
      error.code = "UNKNOWN_PLATFORM";
      throw error;
    }
    return platform;
  }

  async myBindings(userId: string) {
    return this.prisma.momentPlatformBinding.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
  }

  async bindPlatform(userId: string, platformRaw: string, handle: string, displayName?: string) {
    const platform = this.assertPlatform(platformRaw) as never;
    const trimmed = handle.trim().slice(0, 128);
    if (!trimmed) {
      const error = new Error("INVALID_HANDLE") as Error & { code?: string };
      error.code = "INVALID_HANDLE";
      throw error;
    }
    const binding = await this.prisma.momentPlatformBinding.upsert({
      where: { userId_platform: { userId, platform } },
      update: { handle: trimmed, displayName: displayName?.trim().slice(0, 128) ?? null, syncEnabled: true },
      create: { userId, platform, handle: trimmed, displayName: displayName?.trim().slice(0, 128) ?? null, syncEnabled: true },
    });
    await this.prisma.momentSetting.upsert({
      where: { userId },
      update: { syncEnabled: true },
      create: { userId, syncEnabled: true },
    });
    await this.seedDemoMoments(userId, platformRaw);
    return binding;
  }

  async unbindPlatform(userId: string, platformRaw: string) {
    const platform = this.assertPlatform(platformRaw) as never;
    await this.prisma.momentPlatformBinding.deleteMany({ where: { userId, platform } });
    return { unbound: true };
  }

  async togglePlatform(userId: string, platformRaw: string, syncEnabled: boolean) {
    const platform = this.assertPlatform(platformRaw) as never;
    const binding = await this.prisma.momentPlatformBinding.updateMany({
      where: { userId, platform },
      data: { syncEnabled },
    });
    return { updated: binding.count };
  }

  async mySetting(userId: string) {
    const setting = await this.prisma.momentSetting.findUnique({ where: { userId } });
    if (setting) return setting;
    return this.prisma.momentSetting.create({ data: { userId } });
  }

  async updateSetting(
    userId: string,
    patch: {
      syncEnabled?: boolean;
      visibleTo?: string;
      filterSensitive?: boolean;
      showPhotos?: boolean;
      showVideos?: boolean;
      showTexts?: boolean;
      showReels?: boolean;
      showLives?: boolean;
    },
  ) {
    const visibleTo = patch.visibleTo ? patch.visibleTo.toLowerCase().slice(0, 16) : undefined;
    if (visibleTo && !["everyone", "connections", "private"].includes(visibleTo)) {
      const error = new Error("INVALID_VISIBILITY") as Error & { code?: string };
      error.code = "INVALID_VISIBILITY";
      throw error;
    }
    return this.prisma.momentSetting.upsert({
      where: { userId },
      update: { ...patch, ...(visibleTo ? { visibleTo } : {}) },
      create: { userId, ...patch, ...(visibleTo ? { visibleTo } : {}) },
    });
  }

  async feed(viewerId: string, query: { tab?: string; platform?: string; limit?: number; cursor?: string }) {
    const limit = Math.min(Math.max(Number(query.limit ?? 20) || 20, 1), 50);
    const cursor = query.cursor ? new Date(query.cursor) : null;
    const tab = (query.tab ?? "recommend").toLowerCase();
    const platform = query.platform ? query.platform.toUpperCase() : null;
    if (platform) this.assertPlatform(platform);

    const blockedRows = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true },
    });
    const blockedIds = new Set<string>();
    for (const row of blockedRows) {
      blockedIds.add(row.blockerId);
      blockedIds.add(row.blockedId);
    }
    blockedIds.delete(viewerId);

    const connectionRows = await this.prisma.connection.findMany({
      where: { status: "ACTIVE", OR: [{ userAId: viewerId }, { userBId: viewerId }] },
      select: { userAId: true, userBId: true },
    });
    const peerIds = new Set<string>();
    for (const row of connectionRows) {
      peerIds.add(row.userAId === viewerId ? row.userBId : row.userAId);
    }

    let authorIds: string[] | undefined;
    if (tab === "following" || tab === "mine") {
      authorIds = tab === "mine" ? [viewerId] : [...peerIds];
      if (authorIds.length === 0) return { items: [], nextCursor: null };
    }

    const moments = await this.prisma.moment.findMany({
      where: {
        ...(cursor ? { createdAt: { lt: cursor } } : {}),
        ...(platform ? { platform: platform as never } : {}),
        ...(authorIds ? { userId: { in: authorIds } } : {}),
        ...(blockedIds.size > 0 ? { userId: { notIn: [...blockedIds] } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      include: {
        user: { select: { id: true, nickname: true, avatarUrl: true, countryCode: true } },
        likes: { where: { userId: viewerId }, select: { userId: true } },
      },
    });

    const authorIdsInFeed = [...new Set(moments.map((moment) => moment.userId))];
    const authorSettings = await this.prisma.momentSetting.findMany({
      where: { userId: { in: authorIdsInFeed } },
      select: { userId: true, visibleTo: true },
    });
    const visibilityByAuthor = new Map(authorSettings.map((row) => [row.userId, row.visibleTo]));
    const visibleMoments = moments.filter((moment) => {
      if (moment.userId === viewerId) return true;
      const visibleTo = visibilityByAuthor.get(moment.userId) ?? "everyone";
      if (visibleTo === "private") return false;
      if (visibleTo === "connections") return peerIds.has(moment.userId);
      return true;
    });

    const viewerSetting = await this.prisma.momentSetting.findUnique({ where: { userId: viewerId } });
    const items = visibleMoments.slice(0, limit).map((moment) => ({
      id: moment.id,
      userId: moment.userId,
      author: moment.user,
      platform: moment.platform,
      platformName: moment.platformName,
      content: this.filterContent(moment.content, viewerSetting?.filterSensitive ?? true),
      images: this.filterMedia(moment.images, moment.platform, viewerSetting),
      videoUrl: this.filterVideo(moment.videoUrl, viewerSetting),
      durationSec: moment.durationSec,
      tags: moment.tags,
      likeCount: moment.likeCount,
      commentCount: moment.commentCount,
      liked: moment.likes.length > 0,
      source: moment.source,
      isDemo: moment.source === "DEMO",
      syncedAt: moment.syncedAt,
      createdAt: moment.createdAt,
    }));
    const nextCursor =
      visibleMoments.length > limit ? visibleMoments[limit - 1].createdAt : null;
    return { items, nextCursor };
  }

  async userMoments(viewerId: string, authorId: string, query: { platform?: string; limit?: number; cursor?: string }) {
    const author = await this.prisma.user.findUnique({
      where: { id: authorId },
      select: { id: true, nickname: true, avatarUrl: true, countryCode: true, bio: true, status: true },
    });
    if (!author || author.status !== "ACTIVE") return null;
    const setting = await this.prisma.momentSetting.findUnique({ where: { userId: authorId } });
    const visibleTo = setting?.visibleTo ?? "everyone";
    if (viewerId !== authorId && (await this.resolveMomentAccess(viewerId, authorId)) !== "allowed") {
      return { author, setting: { visibleTo }, items: [], nextCursor: null, locked: true };
    }
    const limit = Math.min(Math.max(Number(query.limit ?? 20) || 20, 1), 50);
    const cursor = query.cursor ? new Date(query.cursor) : null;
    const platform = query.platform ? query.platform.toUpperCase() : null;
    if (platform) this.assertPlatform(platform);
    const moments = await this.prisma.moment.findMany({
      where: {
        userId: authorId,
        ...(cursor ? { createdAt: { lt: cursor } } : {}),
        ...(platform ? { platform: platform as never } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      include: { likes: { where: { userId: viewerId }, select: { userId: true } } },
    });
    const items = moments.slice(0, limit).map((moment) => ({
      id: moment.id,
      userId: moment.userId,
      platform: moment.platform,
      platformName: moment.platformName,
      content: this.filterContent(moment.content, setting?.filterSensitive ?? true),
      images: this.filterMedia(moment.images, moment.platform, setting),
      videoUrl: this.filterVideo(moment.videoUrl, setting),
      durationSec: moment.durationSec,
      tags: moment.tags,
      likeCount: moment.likeCount,
      commentCount: moment.commentCount,
      liked: moment.likes.length > 0,
      source: moment.source,
      isDemo: moment.source === "DEMO",
      syncedAt: moment.syncedAt,
      createdAt: moment.createdAt,
    }));
    const bindings = await this.prisma.momentPlatformBinding.findMany({
      where: { userId: authorId },
      orderBy: { createdAt: "asc" },
    });
    return {
      author,
      setting: setting ?? { visibleTo: "everyone" },
      bindings: bindings.map((binding) => ({
        platform: binding.platform,
        handle: binding.handle,
        displayName: binding.displayName,
        syncEnabled: binding.syncEnabled,
      })),
      items,
      nextCursor: moments.length > limit ? moments[limit - 1].createdAt : null,
      locked: false,
    };
  }

  /**
   * PC-2.1 - single-moment read behind the Post Detail screen.
   *
   * The detail route is a new entry point into the same data, so it goes
   * through the same gate as every other interaction (`resolveMomentAccess`):
   * a private / connections-only / blocked moment stays locked here too.
   *
   * The projection is explicit and limited to what the detail card renders -
   * no author e-mail, no token, no social handle, no admin flag. Media
   * filtering reuses the viewer's own MomentSetting, exactly like `feed()`.
   */
  async getMoment(viewerId: string, momentId: string) {
    const moment = await this.prisma.moment.findUnique({
      where: { id: momentId },
      include: {
        user: { select: { id: true, nickname: true, avatarUrl: true, countryCode: true, status: true } },
        likes: { where: { userId: viewerId }, select: { userId: true } },
      },
    });
    if (!moment || moment.user.status !== "ACTIVE") return null;
    if (viewerId !== moment.userId) await this.assertCanInteract(viewerId, moment.userId);
    const viewerSetting = await this.prisma.momentSetting.findUnique({ where: { userId: viewerId } });
    return {
      id: moment.id,
      userId: moment.userId,
      author: {
        id: moment.user.id,
        nickname: moment.user.nickname,
        avatarUrl: moment.user.avatarUrl,
        countryCode: moment.user.countryCode,
      },
      platform: moment.platform,
      platformName: moment.platformName,
      content: this.filterContent(moment.content, viewerSetting?.filterSensitive ?? true),
      images: this.filterMedia(moment.images, moment.platform, viewerSetting),
      videoUrl: this.filterVideo(moment.videoUrl, viewerSetting),
      durationSec: moment.durationSec,
      tags: moment.tags,
      likeCount: moment.likeCount,
      commentCount: moment.commentCount,
      liked: moment.likes.length > 0,
      source: moment.source,
      isDemo: moment.source === "DEMO",
      syncedAt: moment.syncedAt,
      createdAt: moment.createdAt,
    };
  }
  async toggleLike(userId: string, momentId: string) {
    const moment = await this.prisma.moment.findUnique({ where: { id: momentId } });
    if (!moment) return null;
    await this.assertCanInteract(userId, moment.userId);
    const existing = await this.prisma.momentLike.findUnique({
      where: { momentId_userId: { momentId, userId } },
    });
    if (existing) {
      await this.prisma.$transaction([
        this.prisma.momentLike.delete({ where: { momentId_userId: { momentId, userId } } }),
        this.prisma.moment.update({ where: { id: momentId }, data: { likeCount: { decrement: 1 } } }),
      ]);
      return { liked: false };
    }
    await this.prisma.$transaction([
      this.prisma.momentLike.create({ data: { momentId, userId } }),
      this.prisma.moment.update({ where: { id: momentId }, data: { likeCount: { increment: 1 } } }),
    ]);
    if (moment.userId !== userId) {
      await this.notifications.notify({
        userId: moment.userId,
        type: "MOMENT_LIKE",
        title: "你的动态收到点赞",
        body: moment.content.slice(0, 120),
        data: {
          actorId: userId,
          targetType: "MOMENT",
          targetId: momentId,
          momentId,
        },
      });
    }
    return { liked: true };
  }

  /**
   * PC-2.4 — the thread is paginated on top-level comments only. Replies travel
   * nested under the comment they belong to, so a page boundary can never split
   * a thread: `pageSize` bounds top-level comments, not rows.
   *
   * The shape is the console's list shape (`items` / `total` / `page` /
   * `pageSize` / `totalPages`) rather than a second, comment-only pagination
   * contract. `hasMore` is deliberately not added: it is derived from
   * `page < totalPages` and duplicating it would let the two disagree.
   *
   * The order is unchanged (oldest first) so a page stays stable while the
   * thread grows, and the access check still runs before anything is read: a
   * locked moment rejects without ever reaching `count`.
   */
  async listComments(viewerId: string, momentId: string, page = 1, pageSize = 20) {
    const moment = await this.prisma.moment.findUnique({ where: { id: momentId } });
    if (!moment) return null;
    await this.assertCanInteract(viewerId, moment.userId);
    const safePage = Math.min(Math.max(Number(page) || 1, 1), 1000);
    // The bound the thread already had before pagination existed, kept so a
    // request cannot ask for an unbounded slice of 500-char bodies.
    const safePageSize = Math.min(Math.max(Number(pageSize) || 20, 1), 50);
    const where = { momentId, parentCommentId: null };
    // Explicit projection: a comment exposes the author's public identity only.
    // `momentId` / `userId` are not part of the API contract either, so they are
    // left out rather than shipped by accident through a default select.
    // PC-2.3.2 — the thread is one level deep: only top-level comments are
    // listed and replies travel nested under their parent. A nested select
    // cannot recurse past the data, and only one level is ever written.
    // PC-2.4 — replies arrive with their page of parents in the same query, so
    // a page costs two round trips no matter how many comments it holds.
    const [total, items] = await Promise.all([
      this.prisma.momentComment.count({ where }),
      this.prisma.momentComment.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
        select: {
          id: true,
          content: true,
          createdAt: true,
          user: { select: { id: true, nickname: true, avatarUrl: true } },
          replies: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              content: true,
              createdAt: true,
              user: { select: { id: true, nickname: true, avatarUrl: true } },
            },
          },
        },
      }),
    ]);
    return {
      items,
      total,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.ceil(total / safePageSize),
    };
  }

  async addComment(userId: string, momentId: string, content: string, parentCommentId?: string | null) {
    const moment = await this.prisma.moment.findUnique({ where: { id: momentId } });
    if (!moment) return null;
    await this.assertCanInteract(userId, moment.userId);
    const trimmed = content.trim().slice(0, 500);
    if (!trimmed) {
      const error = new Error("EMPTY_COMMENT") as Error & { code?: string };
      error.code = "EMPTY_COMMENT";
      throw error;
    }
    const scan = this.safety.scanText(trimmed);
    // Same contract as profile attributes: a HIGH signal or an explicit block
    // stops the write. SafetyService stays the single source of that decision.
    if (scan.blocked || scan.level === "HIGH") {
      const error = new Error("COMMENT_BLOCKED") as Error & { code?: string };
      error.code = "COMMENT_BLOCKED";
      throw error;
    }
    // PC-3.1c — who a reply is *for*.
    //
    // A reply is addressed to the author of the comment being answered, which is
    // a different person from the author of the moment. The parent row is
    // already being read here for the depth check, so its `userId` rides along
    // and is carried out of the transaction: the notification is written after
    // the commit, never inside it, so a notification problem cannot roll back a
    // reply that was successfully stored.
    let parentAuthorId: string | null = null;
    const comment = await this.prisma.$transaction(async (tx) => {
      // PC-2.3.2 — one reply level. The rule spans two rows, so no CHECK can
      // express it and the self-FK only proves the parent *exists*: it must
      // also belong to this moment and itself be top-level. Checked inside the
      // same transaction as the write, so an illegal reply is never stored.
      if (parentCommentId) {
        const parent = await tx.momentComment.findUnique({
          where: { id: parentCommentId },
          select: { id: true, momentId: true, parentCommentId: true, userId: true },
        });
        if (!parent || parent.momentId !== momentId || parent.parentCommentId !== null) {
          const error = new Error("COMMENT_PARENT_INVALID") as Error & { code?: string };
          error.code = "COMMENT_PARENT_INVALID";
          throw error;
        }
        parentAuthorId = parent.userId;
      }
      const created = await tx.momentComment.create({
        data: { momentId, userId, content: trimmed, parentCommentId: parentCommentId ?? null },
        // The author travels with the created row so the UI can render the new
        // comment immediately, without a second round trip.
        select: {
          id: true,
          content: true,
          createdAt: true,
          parentCommentId: true,
          user: { select: { id: true, nickname: true, avatarUrl: true } },
        },
      });
      // commentCount counts top-level comments only, so a reply leaves it
      // untouched: the counter keeps the meaning it had before replies existed.
      if (!parentCommentId) {
        await tx.moment.update({ where: { id: momentId }, data: { commentCount: { increment: 1 } } });
      }
      return created;
    });
    if (parentCommentId && parentAuthorId) {
      // A reply notifies exactly one person: the comment's author. The moment's
      // author is not told "your moment got a comment" for a reply, because the
      // comment they would be told about is not addressed to them.
      //
      // Self suppression is not repeated here — `NotificationService` owns that
      // rule, so replying to one's own comment simply produces no row.
      await this.notifications.notify({
        userId: parentAuthorId,
        type: "MOMENT_REPLY",
        title: "你的评论收到回复",
        body: trimmed.slice(0, 120),
        data: {
          actorId: userId,
          targetType: "COMMENT",
          targetId: parentCommentId,
          momentId,
          commentId: comment.id,
          parentCommentId,
        },
      });
    } else if (moment.userId !== userId) {
      await this.notifications.notify({
        userId: moment.userId,
        type: "MOMENT_COMMENT",
        title: "你的动态收到评论",
        body: trimmed.slice(0, 120),
        data: {
          actorId: userId,
          targetType: "MOMENT",
          targetId: momentId,
          momentId,
          commentId: comment.id,
        },
      });
    }
    return comment;
  }

  /**
   * PC-2.4 — a comment is removed by its owner only.
   *
   * Ownership is read from the row itself and never from the request, and the
   * row must belong to the moment named in the path: without that second check
   * any readable moment would become a handle on any other moment's thread.
   *
   * Deleting a top-level comment takes its replies with it through the
   * self-relation's ON DELETE CASCADE, and `commentCount` follows it down —
   * but only from a value above zero, so a counter that already drifted
   * historically can never be pushed negative. The guard is part of the same
   * atomic update instead of a read-then-write, so two concurrent deletes
   * cannot both observe the same non-zero value.
   */
  async deleteComment(userId: string, momentId: string, commentId: string) {
    const moment = await this.prisma.moment.findUnique({ where: { id: momentId } });
    if (!moment) return null;
    // The thread is not readable without this, so it is not writable either:
    // the same gate as listing and commenting, reused rather than re-derived.
    await this.assertCanInteract(userId, moment.userId);
    return this.prisma.$transaction(async (tx) => {
      const comment = await tx.momentComment.findUnique({
        where: { id: commentId },
        select: { id: true, momentId: true, userId: true, parentCommentId: true },
      });
      if (!comment || comment.momentId !== momentId) {
        const error = new Error("COMMENT_NOT_FOUND") as Error & { code?: string };
        error.code = "COMMENT_NOT_FOUND";
        throw error;
      }
      if (comment.userId !== userId) {
        const error = new Error("COMMENT_FORBIDDEN") as Error & { code?: string };
        error.code = "COMMENT_FORBIDDEN";
        throw error;
      }
      await tx.momentComment.delete({ where: { id: comment.id } });
      if (comment.parentCommentId === null) {
        await tx.moment.updateMany({
          where: { id: momentId, commentCount: { gt: 0 } },
          data: { commentCount: { decrement: 1 } },
        });
      }
      // Which level was removed is the server's answer, not the client's
      // assumption: only a top-level delete moves the counter the card shows.
      return { deleted: true, parentCommentId: comment.parentCommentId };
    });
  }

  async publish(
    userId: string,
    input: { content: string; images?: string[]; videoUrl?: string; tags?: string[] },
  ) {
    const content = input.content.trim().slice(0, 2000);
    if (!content) {
      const error = new Error("EMPTY_CONTENT") as Error & { code?: string };
      error.code = "EMPTY_CONTENT";
      throw error;
    }
    let scan = { blocked: false };
    try {
      scan = this.safety.scanText(content);
    } catch {
      scan = { blocked: false };
    }
    if (scan.blocked) {
      const error = new Error("CONTENT_BLOCKED") as Error & { code?: string };
      error.code = "CONTENT_BLOCKED";
      throw error;
    }
    const images = Array.isArray(input.images)
      ? input.images.filter((url) => typeof url === "string" && /^https?:\/\/\S{4,2000}$/.test(url)).slice(0, 9)
      : [];
    const videoUrl =
      typeof input.videoUrl === "string" && /^https?:\/\/\S{4,2000}$/.test(input.videoUrl) ? input.videoUrl : null;
    const tags = Array.isArray(input.tags)
      ? input.tags
          .filter((tag) => typeof tag === "string")
          .map((tag) => tag.trim().replace(/^#+/, "").toLowerCase().slice(0, 32))
          .filter((tag) => tag.length > 0)
          .slice(0, 10)
      : [];
    const created = await this.prisma.moment.create({
      data: {
        userId,
        platform: "TALKFIRST" as never,
        platformName: "TalkFirst",
        content,
        images,
        videoUrl,
        tags,
        // Published by the user in-app — genuine content, not demo filler.
        source: "USER",
        syncedAt: new Date(),
      },
    });
    return {
      id: created.id,
      userId: created.userId,
      platform: created.platform,
      platformName: created.platformName,
      content: created.content,
      images: created.images,
      videoUrl: created.videoUrl,
      tags: created.tags,
      likeCount: 0,
      commentCount: 0,
      liked: false,
      source: created.source,
      isDemo: created.source === "DEMO",
      createdAt: created.createdAt,
    };
  }

  async remove(userId: string, momentId: string) {
    const moment = await this.prisma.moment.findUnique({ where: { id: momentId } });
    if (!moment || moment.userId !== userId) return null;
    await this.prisma.moment.delete({ where: { id: momentId } });
    return { deleted: true };
  }

  private filterContent(content: string, filterSensitive: boolean) {
    if (!filterSensitive) return content;
    return content.replace(/[\w.-]+@[\w.-]+\.\w+|\b\d{7,}\b/g, "•••");
  }

  private filterMedia(
    images: string[],
    platform: string,
    setting: { showPhotos?: boolean; showVideos?: boolean; showReels?: boolean } | null | undefined,
  ) {
    if (!setting) return images;
    if (!setting.showPhotos && platform === "INSTAGRAM") return [];
    if (!setting.showReels && (platform === "TIKTOK" || platform === "YOUTUBE")) return images.slice(0, 1);
    return images;
  }

  private filterVideo(
    videoUrl: string | null,
    setting: { showVideos?: boolean } | null | undefined,
  ) {
    if (!setting || setting.showVideos) return videoUrl;
    return null;
  }

  /**
   * Creates placeholder moments for a newly bound platform handle.
   *
   * IMPORTANT: TalkFirst has no real OAuth/sync integration with any external
   * platform yet. These rows are fabricated (hardcoded copy, Unsplash stock
   * images, random engagement counts) purely so the Moments UI has something to
   * render. They are written with `source: "DEMO"` and are surfaced to clients
   * as `source: "DEMO"` + `isDemo: true` so nothing downstream can present them
   * as genuine synced activity.
   */
  private async seedDemoMoments(userId: string, platform: string) {
    const existing = await this.prisma.moment.count({ where: { userId, platform: platform as never } });
    if (existing > 0) return;
    const now = Date.now();
    const seeds: Record<string, Array<{ content: string; images: string[]; tags: string[]; hoursAgo: number }>> = {
      INSTAGRAM: [
        {
          content: "Hiking is always a good idea.\n#nature #travel #hiking",
          images: ["https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800"],
          tags: ["nature", "travel", "hiking"],
          hoursAgo: 26,
        },
        {
          content: "Just finished a great hike today! The view was amazing.\nNature really recharges me.",
          images: ["https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800"],
          tags: ["hiking"],
          hoursAgo: 74,
        },
      ],
      X: [
        {
          content: "Just got back from Tokyo! What a great trip.",
          images: ["https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800"],
          tags: ["travel", "tokyo"],
          hoursAgo: 52,
        },
      ],
      TIKTOK: [
        {
          content: "Tokyo at night is just another world\n#tokyo #japan #travel #fyp",
          images: ["https://images.unsplash.com/photo-1542051841857-5f90071e7989?w=800"],
          tags: ["tokyo", "japan"],
          hoursAgo: 30,
        },
      ],
      YOUTUBE: [
        {
          content: "Minecraft 1.21 New Update - What's New?",
          images: ["https://images.unsplash.com/photo-1587573089734-09cb69c0f2b4?w=800"],
          tags: ["gaming"],
          hoursAgo: 50,
        },
      ],
      FACEBOOK: [
        {
          content: "Weekend hotpot with old friends. Nothing beats it.",
          images: ["https://images.unsplash.com/photo-1547592180-85f173990554?w=800"],
          tags: ["food", "friends"],
          hoursAgo: 96,
        },
      ],
    };
    const rows = seeds[platform] ?? [];
    for (const row of rows) {
      await this.prisma.moment.create({
        data: {
          userId,
          platform: platform as never,
          platformName: platform.charAt(0) + platform.slice(1).toLowerCase(),
          content: row.content,
          images: row.images,
          tags: row.tags,
          likeCount: Math.floor(Math.random() * 200) + 20,
          commentCount: Math.floor(Math.random() * 40) + 2,
          source: "DEMO",
          syncedAt: new Date(now - row.hoursAgo * 3600 * 1000),
          createdAt: new Date(now - row.hoursAgo * 3600 * 1000),
        },
      });
    }
  }
}
