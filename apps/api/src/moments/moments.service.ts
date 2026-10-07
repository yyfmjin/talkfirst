import { Injectable } from "@nestjs/common";
import { NotificationService } from "../notifications/notification.service";
import { keysetFilterAfter, keysetNextCursor, keysetOrderBy, parseKeysetCursor } from "../common/keyset-cursor";
import { PrismaService } from "../prisma/prisma.service";
import { SafetyService, type SafetyScan } from "../safety/safety.service";

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

/**
 * The moderation states another member may see.
 *
 * `APPROVED` and `HIDDEN` are the two where a human or the scanner has decided the
 * content may be public — `HIDDEN` is a withdrawal after publication, and rows in it are
 * excluded here because a withdrawn moment must stop being visible to others. `PENDING`
 * and `REJECTED` are owner-only.
 */
const PUBLICLY_VISIBLE_REVIEW_STATUS = ["APPROVED"] as const;

/**
 * Restricts a moment query to what `viewerId` may see.
 *
 * ## Why this is a `where` clause and not a post-filter
 *
 * `feed()` already post-filters visibility in JavaScript, which is why it has a
 * comment about its page size being approximate. Adding moderation to that filter
 * would compound the problem: a page of 20 could come back with far fewer items, and
 * the cursor would advance past rows the caller never saw. Pushing it into SQL keeps
 * the page full.
 *
 * ## Why the owner is exempt
 *
 * A member must be able to see their own post while it awaits review, otherwise the
 * publish appears to have silently failed. The exemption is expressed as
 * `userId: viewerId` inside the `OR`, so it applies only to rows that viewer owns.
 */
function reviewVisibilityFilter(viewerId: string): Record<string, unknown> {
  return {
    OR: [
      { reviewStatus: { in: [...PUBLICLY_VISIBLE_REVIEW_STATUS] } },
      { userId: viewerId },
    ],
  };
}

/**
 * C1 — 话题的归一化。
 *
 * 写入端早就归一化过（`publish` 与 compose 都是 `trim → 去掉开头的 # → 小写 → 截 32`），
 * 所以查询端必须用**逐字同一套**规则：否则 `#旅行` 与 `旅行` 会是两个互相查不到的字符串，
 * 而两边看上去都「对」。
 */
function normalizeTopic(raw: string): string {
  return raw.trim().replace(/^#+/, "").toLowerCase().slice(0, 32);
}

/**
 * True when a non-owner must be refused this row.
 *
 * ## Why an absent status is treated as visible
 *
 * The first version compared against `PUBLICLY_VISIBLE_REVIEW_STATUS` directly, so a row
 * whose `reviewStatus` was `undefined` — which happens on any query that narrows its
 * `select` and forgets this column — was refused. The effect is silent and severe: the
 * detail route returns null for content that is perfectly public, and nothing in the
 * response says why. A missing status means "this code path did not load the moderation
 * state", which is not evidence that the content is withheld.
 *
 * The failure direction matters too. Treating unknown as visible can at worst show a
 * moment that should have been queued, on a path that forgot to load the column; treating
 * it as blocked hides legitimate content from everyone with no way to tell. The list
 * queries filter in SQL where the column is always present, so this guard exists for the
 * by-id route and for future callers.
 */
export function isReviewBlockedForViewer(
  viewerId: string,
  moment: { userId: string; reviewStatus?: string | null },
): boolean {
  if (moment.userId === viewerId) return false;
  if (!moment.reviewStatus) return false;
  return !(PUBLICLY_VISIBLE_REVIEW_STATUS as readonly string[]).includes(moment.reviewStatus);
}

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

  /**
   * C1 — feed / 收藏 / 话题三处都需要的「谁能看谁」上下文。
   *
   * 抽出来之前这段在 feed 与 bookmarks 里各有一份**逐字相同**的副本；话题列表要按
   * 同一套可见性聚合计数，第三份副本只会把「改了一处」变成默认结局。
   * `blockedIds` 已剔除浏览者自己（拉黑自己不存在，而把它留在集合里
   * 会让「我自己的动态」在 feed 里被过滤掉）。
   */
  private async visibilityContext(
    viewerId: string,
  ): Promise<{ blockedIds: Set<string>; peerIds: Set<string> }> {
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

    return { blockedIds, peerIds };
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

  /**
   * FIX (audit P021 / P030) — the feed and the per-user feed both walk with the
   * shared `(createdAt, id)` keyset cursor in `../common/keyset-cursor` instead
   * of a `createdAt`-only comparison.
   *
   * Two defects lived here:
   *
   *  1. The cursor was `createdAt` alone, so two moments written in the same
   *     millisecond could not be ordered against it: the next page used
   *     `createdAt: { lt: cursor }` and skipped the other row of the pair.
   *  2. `nextCursor` was derived from an index into the *pre-filter* array
   *     (`moments[limit - 1]`) while the returned page was the *filtered* slice,
   *     so any moment dropped by the visibility filter shifted that index and
   *     the cursor pointed at a row the client never saw.
   *
   * Visibility filtering still applies to the page; because the underlying query
   * is not visibility-aware, a page can come back shorter than `limit` (the
   * client sees fewer items and, once the cursor is null, stops) — preferable to
   * the previous behaviour, which either duplicated or skipped real rows.
   *
   * A malformed cursor is now a `400 VALIDATION_ERROR` rather than the
   * `new Date("garbage")` → `Invalid Date` → `500` it used to produce.
   */
  async feed(viewerId: string, query: { tab?: string; platform?: string; topic?: string; limit?: number; cursor?: string }) {
    const limit = Math.min(Math.max(Number(query.limit ?? 20) || 20, 1), 50);
    const cursor = parseKeysetCursor(query.cursor);
    const tab = (query.tab ?? "recommend").toLowerCase();
    const platform = query.platform ? query.platform.toUpperCase() : null;
    if (platform) this.assertPlatform(platform);
    /**
     * C1 — 按话题筛动态。这是 `docs/FUNCTIONAL-TEST-UI-UX.md` §2.22 明确点名缺的那个参数：
     * 动态本来就带 `tags`，缺的只是「按 tag 查」的入口。
     * `has` 是 Postgres 的数组包含，与 `tags String[]` 直接对应，不需要额外索引或话题表。
     */
    const topic = query.topic ? normalizeTopic(query.topic) : "";

    const { blockedIds, peerIds } = await this.visibilityContext(viewerId);

    let authorIds: string[] | undefined;
    if (tab === "following" || tab === "mine") {
      authorIds = tab === "mine" ? [viewerId] : [...peerIds];
      if (authorIds.length === 0) return { items: [], nextCursor: null };
    }

    const moments = await this.prisma.moment.findMany({
      where: {
        ...keysetFilterAfter(cursor),
        ...(platform ? { platform: platform as never } : {}),
        ...(topic ? { tags: { has: topic } } : {}),
        ...(authorIds ? { userId: { in: authorIds } } : {}),
        /**
         * Moderation visibility, expressed as an explicit `OR` rather than spread from
         * `reviewVisibilityFilter`, because it has to be combined with the block list
         * below. Two separate `userId` keys would silently overwrite each other, and the
         * surviving one would either ignore blocks or hide the viewer's own queued post.
         */
        AND: [
          ...(blockedIds.size > 0 ? [{ userId: { notIn: [...blockedIds] } }] : []),
          reviewVisibilityFilter(viewerId),
        ],
      },
      orderBy: keysetOrderBy,
      take: limit + 1,
      include: {
        user: { select: { id: true, nickname: true, avatarUrl: true, countryCode: true } },
        likes: { where: { userId: viewerId }, select: { userId: true } },
        bookmarks: { where: { userId: viewerId }, select: { userId: true } },
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
    const page = visibleMoments.slice(0, limit);
    const items = page.map((moment) => this.feedItem(moment, viewerSetting));
    // The cursor is the LAST ITEM OF THE RETURNED PAGE (audit P021) — never an
    // index into the pre-filter array, and never a row the client did not see.
    const nextCursor = keysetNextCursor(moments.length, limit, page);
    return { items, nextCursor };
  }

  /**
   * 动态 → 前端 item 的投影（`feed` 与 `videoFeed` 共用一份）。
   *
   * 抽出来的理由：视频流与普通 feed 必须给出**完全一样**的字段形状
   * （前端复用同一套卡片类型），而里面的 `filterContent` / `filterMedia` /
   * `filterVideo` 三步直接决定「查看者的敏感内容设置有没有被尊重」——
   * 两份拷贝早晚会有一份忘了跟上。
   */
  private feedItem(
    moment: {
      id: string;
      userId: string;
      user: { id: string; nickname: string | null; avatarUrl: string | null; countryCode: string | null };
      platform: string;
      platformName: string | null;
      content: string;
      images: string[];
      videoUrl: string | null;
      durationSec: number | null;
      tags: string[];
      source: string;
      likeCount: number;
      commentCount: number;
      createdAt: Date;
      syncedAt: Date | null;
      likes: Array<{ userId: string }>;
      bookmarks: Array<{ userId: string }>;
    },
    /**
     * 查看者的动态设置（`MomentSetting` 行，或没设置过时的 `null`）。
     * 只声明这里真正会读到的四个开关：多出来的字段由结构化类型自然接受，
     * 而少声明一个就会被 `filterMedia` / `filterVideo` 的签名报出来。
     */
    viewerSetting: {
      filterSensitive?: boolean;
      showPhotos?: boolean;
      showVideos?: boolean;
      showReels?: boolean;
    } | null,
  ) {
    return {
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
      likeCount: this.reportedLikeCount(moment),
      commentCount: moment.commentCount,
      liked: moment.likes.length > 0,
      bookmarked: moment.bookmarks.length > 0,
      source: moment.source,
      isDemo: moment.source === "DEMO",
      syncedAt: moment.syncedAt,
      createdAt: moment.createdAt,
    };
  }

  /**
   * 视频流（2026-10-06）—— 给「点视频 → 全屏沉浸、上下滑」用的候选集。
   *
   * ## 可见性一条不少地复用
   *
   * 拉黑、审核、作者可见范围（`MomentSetting.visibleTo`）、查看者的敏感内容过滤 ——
   * 与 `feed` 同一套，一步都不另写。沉浸模式最容易变成绕过隐私的后门
   * （全屏、快滑、看不出这是谁的），所以这里宁可多跑几次同样的查询。
   * 投影也走同一个 `feedItem`，前端可以直接复用卡片类型。
   *
   * ## 「随机」的实现与代价
   *
   * 先取最近 `candidates` 条**有视频**的动态，按可见范围过滤、剔掉客户端已看过的
   * (`exclude`)，再在内存里 Fisher–Yates 打散取前 `limit` 条。
   *
   * 不用 `ORDER BY random()` 的原因：Prisma 表达不了，而用 `$queryRaw` 重写一遍
   * 可见性等于把最容易出错的逻辑复制成两份。候选集上限是有意为之：
   * 数据量上来后应换成「随机游标」（对某个随机键做 keyset），而不是把上限调大。
   *
   * `exclude` 只认最后 50 个：它来自查询串，不能让它无限长。
   * 库里视频不够时 `exhausted: true`，客户端应当从头再循环而不是无限拉取。
   */
  async videoFeed(viewerId: string, query: { limit?: number; exclude?: string }) {
    const candidates = 200;
    const excludeMax = 50;
    const limit = Math.min(Math.max(Number(query.limit ?? 6) || 6, 1), 20);
    const excludeIds = (query.exclude ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
      .slice(-excludeMax);

    const { blockedIds, peerIds } = await this.visibilityContext(viewerId);

    const rows = await this.prisma.moment.findMany({
      where: {
        videoUrl: { not: null },
        ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
        // 与 `feed` 完全相同的两层：拉黑 + 审核可见性。
        AND: [
          ...(blockedIds.size > 0 ? [{ userId: { notIn: [...blockedIds] } }] : []),
          reviewVisibilityFilter(viewerId),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: candidates,
      include: {
        user: { select: { id: true, nickname: true, avatarUrl: true, countryCode: true } },
        likes: { where: { userId: viewerId }, select: { userId: true } },
        bookmarks: { where: { userId: viewerId }, select: { userId: true } },
      },
    });

    const authorIds = [...new Set(rows.map((row) => row.userId))];
    const authorSettings = await this.prisma.momentSetting.findMany({
      where: { userId: { in: authorIds } },
      select: { userId: true, visibleTo: true },
    });
    const visibilityByAuthor = new Map(authorSettings.map((row) => [row.userId, row.visibleTo]));
    const viewerSetting = await this.prisma.momentSetting.findUnique({ where: { userId: viewerId } });

    const visible = rows.filter((moment) => {
      if (moment.userId === viewerId) return true;
      const visibleTo = visibilityByAuthor.get(moment.userId) ?? "everyone";
      if (visibleTo === "private") return false;
      if (visibleTo === "connections") return peerIds.has(moment.userId);
      return true;
    });

    const shuffled = [...visible];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const items = shuffled
      .map((moment) => this.feedItem(moment, viewerSetting))
      // 投影可能把 videoUrl 抹掉（查看者的敏感内容设置）—— 那种条目在全屏流里
      // 就是一块空白，直接丢掉，而不是让前端猜。
      .filter((item) => Boolean(item.videoUrl))
      .slice(0, limit);

    return { items, exhausted: visible.length === 0 && excludeIds.length > 0 };
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
    // Same `(createdAt, id)` cursor as `feed` (audit P021/P030).
    const cursor = parseKeysetCursor(query.cursor);
    const platform = query.platform ? query.platform.toUpperCase() : null;
    if (platform) this.assertPlatform(platform);
    const moments = await this.prisma.moment.findMany({
      where: {
        userId: authorId,
        ...keysetFilterAfter(cursor),
        ...(platform ? { platform: platform as never } : {}),
        /**
         * A visitor to someone else's profile sees only approved moments, while the owner
         * sees their own queued ones. `AND` rather than a spread so the `userId: authorId`
         * above is never overwritten by the filter's own `userId` branch.
         */
        AND: [reviewVisibilityFilter(viewerId)],
      },
      orderBy: keysetOrderBy,
      take: limit + 1,
      include: {
        likes: { where: { userId: viewerId }, select: { userId: true } },
        bookmarks: { where: { userId: viewerId }, select: { userId: true } },
      },
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
      likeCount: this.reportedLikeCount(moment),
      commentCount: moment.commentCount,
      liked: moment.likes.length > 0,
      bookmarked: moment.bookmarks.length > 0,
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
      // Cursor from the last row actually returned (audit P021).
      nextCursor: keysetNextCursor(moments.length, limit, items),
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
        bookmarks: { where: { userId: viewerId }, select: { userId: true } },
      },
    });
    if (!moment || moment.user.status !== "ACTIVE") return null;
    if (viewerId !== moment.userId) await this.assertCanInteract(viewerId, moment.userId);
    /**
     * A queued or refused moment is visible to its author only.
     *
     * The list queries filter this in SQL, but the detail route is a separate entry point
     * reached by id — without this check, knowing an id would be enough to read content a
     * reviewer has not yet cleared, and the content-visibility rule would hold only for
     * people who used the list.
     */
    if (isReviewBlockedForViewer(viewerId, moment)) return null;
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
      likeCount: this.reportedLikeCount(moment),
      commentCount: moment.commentCount,
      liked: moment.likes.length > 0,
      bookmarked: moment.bookmarks.length > 0,
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
   * C4 — 收藏 / 取消收藏。
   *
   * ## 幂等
   *
   * 收藏用 `upsert`、取消用 `deleteMany`，所以同一个请求重复到达既不会报错，
   * 也不会留下第二行。`(userId, momentId)` 唯一索引是**最后一道保险**，不是主要判据 ——
   * 靠它接住 P2002 再翻成成功，等于把并发的复杂度挪给每个调用方。
   *
   * ## 能不能收藏 = 能不能看
   *
   * 判据与 `getMoment` 完全相同（`resolveMomentAccess` + 作者 ACTIVE）。
   * 这不是洁癖：收藏列表是一份**按用户持久化下来的读取通道**，如果允许收藏看不见的东西，
   * 它就绕过了拉黑与隐私设置 —— 收藏之后对方即使拉黑你，内容还会躺在你的列表里。
   *
   * 返回 `null` 表示「不存在或不可见」，控制器据此回 404：与 `getMoment` 一样**不区分**
   * 「不存在」与「无权」，免得用状态码把别人内容的存在性问出来。
   */
  async setBookmark(userId: string, momentId: string, bookmarked: boolean) {
    const moment = await this.prisma.moment.findUnique({
      where: { id: momentId },
      select: { id: true, userId: true, user: { select: { status: true } } },
    });
    if (!moment || moment.user.status !== "ACTIVE") return null;
    if (
      moment.userId !== userId &&
      (await this.resolveMomentAccess(userId, moment.userId)) !== "allowed"
    ) {
      return null;
    }

    if (bookmarked) {
      await this.prisma.momentBookmark.upsert({
        where: { userId_momentId: { userId, momentId } },
        update: {},
        create: { userId, momentId },
      });
    } else {
      await this.prisma.momentBookmark.deleteMany({ where: { userId, momentId } });
    }
    return { bookmarked };
  }

  /**
   * C1 — 话题列表（按 tag 聚合），**只在当前浏览者看得见的动态里数**。
   *
   * ## 为什么计数必须在同一套可见性下做
   *
   * 一个 tag 的计数如果能被一个看不见它所属动态的人推出来，那它就是一个侧信道：
   * 「某个只被私密动态用过的话题有 3 条」本身就泄漏了那 3 条的存在。所以这里用的是与
   * `feed` **同一个** `visibilityContext`、同一组过滤条件。
   *
   * ## 为什么是「近期窗口」而不是全库计数
   *
   * Prisma 不能 unnest 数组列（`tags` 是 `String[]`），而全库计数只能靠原生 SQL 的
   * `unnest + GROUP BY` ——那会是本仓库除了健康探针之外的第一处原生 SQL。所以这里取
   * **最近 N 条可见动态**的标签在 JS 里聚合：
   *   · 语义诚实：页面说的是「近期话题」而不是「历史总数」；
   *   · 只 select `tags`，payload 极小且走 `(createdAt, id)` 序；
   *   · 不引入新的查询方言。
   * 真需要全量计数时，那就是该上话题表或原生 SQL 的时候 —— 判断写在这里，不埋在实现里。
   */
  async topics(viewerId: string, query: { limit?: number; window?: number } = {}) {
    const limit = Math.min(Math.max(Number(query.limit ?? 20) || 20, 1), 50);
    const window = Math.min(Math.max(Number(query.window ?? 300) || 300, 1), 1000);

    const { blockedIds, peerIds } = await this.visibilityContext(viewerId);
    const moments = await this.prisma.moment.findMany({
      where: {
        ...(blockedIds.size > 0 ? { userId: { notIn: [...blockedIds] } } : {}),
        AND: [reviewVisibilityFilter(viewerId)],
      },
      orderBy: keysetOrderBy,
      take: window,
      select: { tags: true, userId: true },
    });

    // 作者的 private / connections 与 feed 一样在 JS 里判：那一层要读作者的设置行。
    const authorIdsInWindow = [...new Set(moments.map((moment) => moment.userId))];
    const authorSettings = await this.prisma.momentSetting.findMany({
      where: { userId: { in: authorIdsInWindow } },
      select: { userId: true, visibleTo: true },
    });
    const visibilityByAuthor = new Map(authorSettings.map((row) => [row.userId, row.visibleTo]));

    const counts = new Map<string, number>();
    for (const moment of moments) {
      if (moment.userId !== viewerId) {
        const visibleTo = visibilityByAuthor.get(moment.userId) ?? "everyone";
        if (visibleTo === "private") continue;
        if (visibleTo === "connections" && !peerIds.has(moment.userId)) continue;
      }
      for (const tag of moment.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }

    const items = [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      // 数量降序，同数量按 tag 升序：翻页与刷新不会因为 Map 的插入顺序而抖。
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      .slice(0, limit);

    return { items, window };
  }

  /**
   * C4 — 我的收藏，最近收藏在前。
   *
   * 游标是**收藏行**自己的 `(createdAt, id)`，不是动态的：列表顺序由「什么时候收藏的」
   * 决定，分页因此必须按同一把键，否则翻页会跳行或重复。走全仓库共用的
   * `keyset-cursor`，所以形状与 `feed` / `notifications` 一致。
   *
   * 过滤与 `feed` 同源，且**不能省**：收藏是一份会过期的快照。收藏之后对方可能拉黑你、
   * 可能把可见性从 everyone 收紧成 private、动态也可能被审核置为 `PENDING` ——
   * 那时这个列表不能再把内容端出来。所以每次读取都重新判一遍拉黑、可见性、审核状态。
   */
  async bookmarks(viewerId: string, query: { limit?: number; cursor?: string }) {
    const limit = Math.min(Math.max(Number(query.limit ?? 20) || 20, 1), 50);
    const cursor = parseKeysetCursor(query.cursor);

    const { blockedIds, peerIds } = await this.visibilityContext(viewerId);

    const rows = await this.prisma.momentBookmark.findMany({
      where: {
        userId: viewerId,
        ...keysetFilterAfter(cursor),
        /**
         * 拉黑与审核状态能在 SQL 里判掉；可见性（private / connections）要读作者的
         * 设置行，放到下面用同一次查询取回来的 `momentSetting` 判，避免逐行查询。
         */
        moment: {
          AND: [
            reviewVisibilityFilter(viewerId),
            ...(blockedIds.size > 0 ? [{ userId: { notIn: [...blockedIds] } }] : []),
          ],
        },
      },
      orderBy: keysetOrderBy,
      take: limit + 1,
      include: {
        moment: {
          include: {
            user: { select: { id: true, nickname: true, avatarUrl: true, countryCode: true } },
            likes: { where: { userId: viewerId }, select: { userId: true } },
            bookmarks: { where: { userId: viewerId }, select: { userId: true } },
          },
        },
      },
    });

    const authorIdsInPage = [...new Set(rows.map((row) => row.moment.userId))];
    const authorSettings = await this.prisma.momentSetting.findMany({
      where: { userId: { in: authorIdsInPage } },
      select: { userId: true, visibleTo: true },
    });
    const visibilityByAuthor = new Map(authorSettings.map((row) => [row.userId, row.visibleTo]));

    const visibleRows = rows.filter((row) => {
      const moment = row.moment;
      if (moment.userId === viewerId) return true;
      const visibleTo = visibilityByAuthor.get(moment.userId) ?? "everyone";
      if (visibleTo === "private") return false;
      if (visibleTo === "connections") return peerIds.has(moment.userId);
      return true;
    });

    const viewerSetting = await this.prisma.momentSetting.findUnique({
      where: { userId: viewerId },
    });
    const page = visibleRows.slice(0, limit);
    const items = page.map((row) => {
      const moment = row.moment;
      return {
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
        likeCount: this.reportedLikeCount(moment),
        commentCount: moment.commentCount,
        liked: moment.likes.length > 0,
        // 这个列表里的每一条按定义都是收藏过的。写成常量而不是重算：
        // 重算一遍只会多一次判断，却让「为什么这里是 true」变得可疑。
        bookmarked: true as const,
        source: moment.source,
        isDemo: moment.source === "DEMO",
        syncedAt: moment.syncedAt,
        createdAt: moment.createdAt,
      };
    });
    // 游标始终取**客户端真正看到的那一页的最后一行**（audit P021），
    // 而不是预先取多一行里的那一行。
    return { items, nextCursor: keysetNextCursor(rows.length, limit, page) };
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

  async updateComment(userId: string, momentId: string, commentId: string, newContent: string) {
    const trimmed = (newContent || "").trim().slice(0, 500);
    if (!trimmed) {
      const error = new Error("EMPTY_COMMENT") as Error & { code?: string };
      error.code = "EMPTY_COMMENT";
      throw error;
    }
    const moment = await this.prisma.moment.findUnique({ where: { id: momentId } });
    if (!moment) return null;
    await this.assertCanInteract(userId, moment.userId);

    const comment = await this.prisma.momentComment.findUnique({
      where: { id: commentId },
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

    let scan = { blocked: false };
    try {
      scan = this.safety.scanText(trimmed);
    } catch {
      scan = { blocked: false };
    }
    if (scan.blocked) {
      const error = new Error("CONTENT_BLOCKED") as Error & { code?: string };
      error.code = "CONTENT_BLOCKED";
      throw error;
    }

    const updated = await this.prisma.momentComment.update({
      where: { id: commentId },
      data: { content: trimmed },
      include: {
        user: { select: { id: true, nickname: true, avatarUrl: true } },
      },
    });

    return {
      id: updated.id,
      content: updated.content,
      createdAt: updated.createdAt,
      user: updated.user,
      parentCommentId: updated.parentCommentId,
    };
  }

  async publish(
    userId: string,
    input: { content: string; images?: string[]; videoUrl?: string; tags?: string[] },
  ) {
    const content = input.content.trim().slice(0, 2000);
    // PC-3.6 — the composer treats a photo or a clip as content of its own, so
    // an empty body is only `EMPTY_CONTENT` when there is no media attached.
    const images = Array.isArray(input.images)
      ? input.images.filter((url) => typeof url === "string" && /^https?:\/\/\S{4,2000}$/.test(url)).slice(0, 9)
      : [];
    const videoUrl =
      typeof input.videoUrl === "string" && /^https?:\/\/\S{4,2000}$/.test(input.videoUrl) ? input.videoUrl : null;
    if (!content && images.length === 0 && !videoUrl) {
      const error = new Error("EMPTY_CONTENT") as Error & { code?: string };
      error.code = "EMPTY_CONTENT";
      throw error;
    }
    let scan: SafetyScan = { blocked: false, level: "LOW", reasons: [], hasExternalLink: false, hasContactLeak: false };
    try {
      scan = this.safety.scanText(content);
    } catch {
      // A scanner defect must not block publishing outright: the failure mode of an
      // unavailable scanner is "unmoderated", which is the behaviour every moment had
      // before this feature existed.
      scan = { blocked: false, level: "LOW", reasons: [], hasExternalLink: false, hasContactLeak: false };
    }
    if (scan.blocked) {
      const error = new Error("CONTENT_BLOCKED") as Error & { code?: string };
      error.code = "CONTENT_BLOCKED";
      throw error;
    }

    /**
     * Moderation decision, made here rather than in a queue.
     *
     * The rule is risk-based, which is what keeps a queue workable: a keyword match
     * against the scam/spam lists always goes to a human, a medium-risk signal (an
     * external link, a phone number, a handle) goes to a human **only from an untrusted
     * account**, and everything else is visible immediately.
     *
     * The trusted-account exemption is not a loophole: `SafetyService.trustedAccount`
     * requires a week-old account that is ACTIVE and has real activity behind it
     * (connections, messages or requests). Without it, every established member would
     * wait for a human to approve a link they are allowed to post, and the queue would be
     * filled with content nobody needs to look at — which is how moderation queues stop
     * being read.
     */
    let reviewStatus: "PENDING" | "APPROVED" = "APPROVED";
    let reviewReasons: string[] = [];
    if (scan.level === "HIGH") {
      reviewStatus = "PENDING";
      reviewReasons = scan.reasons;
    } else if (scan.level === "MEDIUM") {
      const trusted = await this.safety.trustedAccount(userId).catch(() => false);
      if (!trusted) {
        reviewStatus = "PENDING";
        reviewReasons = scan.reasons;
      }
    }

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
        reviewStatus: reviewStatus as never,
        reviewReasons,
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
      /**
       * Returned so the composer can tell the member their post is queued rather than
       * live. A silent delay is the worst outcome here: the member would assume it
       * published, see nothing in the feed, and publish again.
       */
      reviewStatus: created.reviewStatus,
    };
  }

  async updateMoment(
    userId: string,
    momentId: string,
    input: { content?: string; images?: string[]; videoUrl?: string; tags?: string[] },
  ) {
    const moment = await this.prisma.moment.findUnique({ where: { id: momentId } });
    if (!moment) return null;
    if (moment.userId !== userId) {
      const error = new Error("MOMENT_FORBIDDEN") as Error & { code?: string };
      error.code = "MOMENT_FORBIDDEN";
      throw error;
    }

    const nextContent = input.content !== undefined ? input.content.trim().slice(0, 2000) : moment.content;
    const nextImages =
      input.images !== undefined
        ? Array.isArray(input.images)
          ? input.images.filter((url) => typeof url === "string" && /^https?:\/\/\S{4,2000}$/.test(url)).slice(0, 9)
          : []
        : moment.images;
    /**
     * `""` is an explicit CLEAR, not an invalid value.
     *
     * `publish` keeps the same validation, where a rejected URL simply means "no
     * clip" on a new row. Editing is different: an absent key already means
     * "leave it alone" (that is what the `!== undefined` branch is for), so the
     * only way for the client to say "remove the video" is to send something
     * that is not a URL — and without this branch that request was silently
     * turned into `null` anyway, which happens to be right, while `videoUrl:
     * "not a url"` from a client that meant "keep it" would also have wiped it.
     * Making the empty string the documented clear keeps the two intents apart.
     */
    const clearsVideoUrl = input.videoUrl !== undefined && input.videoUrl.trim() === "";
    const nextVideoUrl =
      input.videoUrl !== undefined
        ? clearsVideoUrl
          ? null
          : typeof input.videoUrl === "string" && /^https?:\/\/\S{4,2000}$/.test(input.videoUrl)
            ? input.videoUrl
            : null
        : moment.videoUrl;

    if (!nextContent && (!nextImages || nextImages.length === 0) && !nextVideoUrl) {
      const error = new Error("EMPTY_CONTENT") as Error & { code?: string };
      error.code = "EMPTY_CONTENT";
      throw error;
    }

    if (input.content !== undefined) {
      let scan = { blocked: false };
      try {
        scan = this.safety.scanText(nextContent);
      } catch {
        scan = { blocked: false };
      }
      if (scan.blocked) {
        const error = new Error("CONTENT_BLOCKED") as Error & { code?: string };
        error.code = "CONTENT_BLOCKED";
        throw error;
      }
    }

    const nextTags =
      input.tags !== undefined
        ? Array.isArray(input.tags)
          ? input.tags
              .filter((tag) => typeof tag === "string")
              .map((tag) => tag.trim().replace(/^#+/, "").toLowerCase().slice(0, 32))
              .filter((tag) => tag.length > 0)
              .slice(0, 10)
          : []
        : moment.tags;

    const updated = await this.prisma.moment.update({
      where: { id: momentId },
      data: {
        content: nextContent,
        images: nextImages,
        videoUrl: nextVideoUrl,
        tags: nextTags,
      },
    });

    return {
      id: updated.id,
      userId: updated.userId,
      platform: updated.platform,
      platformName: updated.platformName,
      content: updated.content,
      images: updated.images,
      videoUrl: updated.videoUrl,
      tags: updated.tags,
      likeCount: this.reportedLikeCount(updated),
      commentCount: updated.commentCount,
      source: updated.source,
      isDemo: updated.source === "DEMO",
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  async remove(userId: string, momentId: string) {
    const moment = await this.prisma.moment.findUnique({ where: { id: momentId } });
    if (!moment) return null;
    if (moment.userId !== userId) {
      const error = new Error("MOMENT_FORBIDDEN") as Error & { code?: string };
      error.code = "MOMENT_FORBIDDEN";
      throw error;
    }
    await this.prisma.moment.delete({ where: { id: momentId } });
    return { deleted: true };
  }

  /**
   * FIX (audit P017) — the like count shown for a DEMO row.
   *
   * `seedDemoMoments` writes `likeCount: Math.floor(Math.random() * 200) + 20`
   * on placeholder rows that have no `MomentLike` rows at all. The column is
   * otherwise an honest denormalised counter maintained with atomic
   * `increment`/`decrement` inside a transaction, so those fabricated values were
   * indistinguishable from real engagement to anything that read the number
   * without also checking `isDemo` — including any future admin statistic.
   *
   * Demo content is placeholder, and a placeholder must not borrow the authority
   * of a real counter: it reports `0`. `commentCount` is NOT zeroed, because a
   * DEMO row can legitimately accumulate real comments from real users, and those
   * are counted truthfully. New DEMO rows are also seeded with zero (see
   * `seedDemoMoments`), so the two halves of the fix agree.
   */
  private reportedLikeCount(moment: { source: string; likeCount: number }): number {
    return moment.source === "DEMO" ? 0 : moment.likeCount;
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
          /**
           * FIX (audit P017) — zero, not a random number.
           *
           * These used to be `Math.floor(Math.random() * 200) + 20` and
           * `Math.floor(Math.random() * 40) + 2`. `likeCount`/`commentCount` are
           * otherwise honest denormalised counters maintained with atomic
           * `increment`/`decrement` inside a transaction, so seeded random values
           * made a placeholder row indistinguishable from genuinely engaged
           * content to every reader that did not also check `isDemo` — including
           * any future aggregate. `reportedLikeCount` additionally clamps the
           * read side, so rows seeded before this change stop reporting fiction
           * too.
           */
          likeCount: 0,
          commentCount: 0,
          source: "DEMO",
          syncedAt: new Date(now - row.hoursAgo * 3600 * 1000),
          createdAt: new Date(now - row.hoursAgo * 3600 * 1000),
        },
      });
    }
  }
}
