import { Injectable } from "@nestjs/common";
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
      await this.prisma.notification.create({
        data: {
          userId: moment.userId,
          type: "MOMENT_LIKE",
          title: "你的动态收到点赞",
          body: moment.content.slice(0, 120),
          data: JSON.stringify({ momentId }),
        },
      }).catch(() => undefined);
    }
    return { liked: true };
  }

  async listComments(viewerId: string, momentId: string, limit = 20) {
    const moment = await this.prisma.moment.findUnique({ where: { id: momentId } });
    if (!moment) return null;
    await this.assertCanInteract(viewerId, moment.userId);
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    return this.prisma.momentComment.findMany({
      where: { momentId },
      orderBy: { createdAt: "asc" },
      take: safeLimit,
      include: { user: { select: { id: true, nickname: true, avatarUrl: true } } },
    });
  }

  async addComment(userId: string, momentId: string, content: string) {
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
    if (scan.blocked) {
      const error = new Error("COMMENT_BLOCKED") as Error & { code?: string };
      error.code = "COMMENT_BLOCKED";
      throw error;
    }
    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.momentComment.create({ data: { momentId, userId, content: trimmed } });
      await tx.moment.update({ where: { id: momentId }, data: { commentCount: { increment: 1 } } });
      return created;
    });
    if (moment.userId !== userId) {
      await this.prisma.notification.create({
        data: {
          userId: moment.userId,
          type: "MOMENT_COMMENT",
          title: "你的动态收到评论",
          body: trimmed.slice(0, 120),
          data: JSON.stringify({ momentId }),
        },
      }).catch(() => undefined);
    }
    return comment;
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
