import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import {
  canViewField,
  resolveFieldVisibilityMap,
  type ProfileVisibilityField,
  type ViewerContext,
} from "../users/profile-visibility.constants";

const DAILY_VIEW_LIMIT = 20;
const LANGUAGE_SCORE = 30;
const INTEREST_SCORE = 25;
const PURPOSE_SCORE = 20;
const COUNTRY_SCORE = 15;
const ACTIVITY_SCORE = 10;

/**
 * The filter tabs that existed before `DiscoverCategory` did.
 *
 * ## Why they are still here
 *
 * A fresh deployment has no category rows, and the tabs must not vanish the moment this
 * feature ships. These two are therefore the fallback: when the table has no active row
 * for a slug, the service behaves exactly as it did before — same matching, same tab list
 * — and an administrator adding a category takes over from there.
 *
 * That also means the migration needs no data seeding, which matters because a seed would
 * have to invent a keywords list and would silently change behaviour on deploy.
 */
const BUILT_IN_CATEGORIES: ReadonlyArray<{ slug: string; label: string; keywords: readonly string[] }> = [
  { slug: "language", label: "语言交换", keywords: ["language-exchange"] },
  {
    slug: "gaming",
    label: "游戏搭子",
    keywords: ["minecraft", "valorant", "gta", "steam", "nintendo", "gaming"],
  },
];

/**
 * Parses the admin-typed keyword list.
 *
 * Splits on commas and whitespace-collapses each entry, so `"a, b ,c"` and `"a,b,c"` are
 * the same list. `toLowerCase` because the slugs it is compared against are lowercase, and
 * an operator typing `Steam` should not produce a dead keyword.
 */
export function parseCategoryKeywords(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * True when a candidate matches any of the category's keywords.
 *
 * Both sides are lower-cased here rather than trusting the caller to have normalised the
 * keywords. The first version lower-cased only the candidate's slugs and claimed in a
 * comment that a hand-edited row would still work — it would not: a row containing `STEAM`
 * compared against a `steam` slug matched nothing, so the tab was silently narrower than
 * the operator intended. Normalising both sides removes the asymmetry, and a `Set` makes
 * the lookup constant-time instead of scanning the keyword list per slug.
 */
export function matchesCategoryKeywords(
  keywords: readonly string[],
  card: { interests: Array<{ slug: string }>; purposes: Array<{ slug: string }> },
): boolean {
  if (keywords.length === 0) return true;
  const wanted = new Set(keywords.map((keyword) => keyword.trim().toLowerCase()));
  const slugs = [...card.interests.map((row) => row.slug), ...card.purposes.map((row) => row.slug)];
  return slugs.some((slug) => wanted.has(slug.trim().toLowerCase()));
}

export type DiscoverCard = {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  countryCode: string | null;
  countryName: string | null;
  countryFlag: string | null;
  age: number | null;
  bio: string | null;
  languages: Array<{ code: string; name: string; nativeName: string | null; type: string; level: string }>;
  interests: Array<{ slug: string; name: string; nameZh: string | null }>;
  purposes: Array<{ slug: string; name: string; nameZh: string | null }>;
  matchScore: number;
  matchReasons: string[];
};

type UserWithRelations = Awaited<ReturnType<DiscoverService["findUser"]>>;

@Injectable()
export class DiscoverService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The tabs the client renders, database-first with the built-in pair as fallback.
   *
   * `all` is always first and is not a row: it is the absence of a filter, and storing it
   * would let an administrator deactivate the unfiltered view.
   */
  async listCategories() {
    const rows = await this.prisma.discoverCategory
      .findMany({
        where: { isActive: true },
        orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
        select: { slug: true, label: true, labelZh: true, keywords: true },
      })
      .catch(() => [] as Array<{ slug: string; label: string; labelZh: string | null; keywords: string }>);

    const items =
      rows.length > 0
        ? rows.map((row) => ({
            id: row.slug,
            label: row.labelZh ?? row.label,
            keywords: parseCategoryKeywords(row.keywords),
          }))
        : BUILT_IN_CATEGORIES.map((row) => ({
            id: row.slug,
            label: row.label,
            keywords: [...row.keywords],
          }));

    return [{ id: "all", label: "🌎 全部", keywords: [] as string[] }, ...items];
  }

  /**
   * Resolves a requested filter into its keyword list.
   *
   * Returns `all` semantics (an empty list) for an unknown slug rather than rejecting the
   * request: a client holding a stale tab list, or a category an administrator just
   * deactivated, would otherwise get an error page instead of the unfiltered feed.
   */
  private async keywordsForFilter(raw: string): Promise<{ slug: string; keywords: string[] }> {
    const slug = (raw ?? "all").trim().toLowerCase();
    if (!slug || slug === "all") return { slug: "all", keywords: [] };

    const row = await this.prisma.discoverCategory
      .findFirst({ where: { slug, isActive: true }, select: { slug: true, keywords: true } })
      .catch(() => null);

    if (row) {
      const keywords = parseCategoryKeywords(row.keywords);
      // An active category with no keywords yet is not a filter that matches nothing —
      // that would show an empty wall to every member. It means "not configured", so it
      // falls back to unfiltered.
      return keywords.length > 0 ? { slug: row.slug, keywords } : { slug: "all", keywords: [] };
    }

    const builtIn = BUILT_IN_CATEGORIES.find((entry) => entry.slug === slug);
    if (builtIn) return { slug: builtIn.slug, keywords: [...builtIn.keywords] };

    return { slug: "all", keywords: [] };
  }

  async getRecommendations(userId: string, requestedLimit = 20, filterRaw?: string) {
    const limit = Math.min(Math.max(requestedLimit, 1), DAILY_VIEW_LIMIT);
    const { slug: normalizedFilter, keywords: filterKeywords } = await this.keywordsForFilter(
      filterRaw ?? "all",
    );
    const today = this.startOfToday();
    const viewed = await this.prisma.discoverView.findMany({
      where: { userId, viewDate: today },
      select: { viewedUserId: true },
    });
    const viewedIds = new Set(viewed.map((row) => row.viewedUserId));
    const remaining = Math.max(DAILY_VIEW_LIMIT - viewedIds.size, 0);

    if (remaining === 0) {
      return { items: [], limit: DAILY_VIEW_LIMIT, used: viewedIds.size, remaining: 0 };
    }

    const current = await this.findUser(userId);
    if (!current) {
      throw new BadRequestException({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }

    // P0-3: Discovery must never surface someone the viewer has blocked, someone
    // who blocked the viewer, or someone already connected. `id: { not: userId }`
    // alone covered only the self case.
    const { excluded, blockedIds, connectedIds } = await this.excludedCandidateIds(userId);
    const candidates = await this.prisma.user.findMany({
      where: {
        id: { not: userId, notIn: [...viewedIds, ...excluded] },
        status: "ACTIVE",
        nickname: { not: null },
        birthDate: { not: null },
      },
      include: {
        languages: { include: { language: true } },
        interests: { include: { interest: true } },
        purposes: { include: { purpose: true } },
        preferredCountries: { include: { country: true } },
        fieldVisibilities: { select: { fieldKey: true, visibility: true } },
      },
      take: 200,
    });

    // The exclusion query above already drops blocked users, but the projection
    // re-checks instead of trusting it: if that rule ever loosens, a blocked
    // user must still never be projected, which is the "Block > visibility"
    // invariant PC-1.3 states.
    const ranked = candidates
      .filter((candidate) => !blockedIds.has(candidate.id))
      .map((candidate) =>
        this.scoreCandidate(current, candidate, {
          isSelf: candidate.id === userId,
          isConnected: connectedIds.has(candidate.id),
        }),
      )
      // Filtering runs on the projected card rather than the raw row on purpose:
      // if a hidden `interests`/`purposes` list were consulted here, merely
      // showing up in a category tab would disclose the value.
      .filter((card) => matchesCategoryKeywords(filterKeywords, card))
      .sort((a, b) => b.matchScore - a.matchScore || b.lastActiveTimestamp - a.lastActiveTimestamp)
      .slice(0, Math.min(limit, remaining));

    return {
      items: ranked.map(({ lastActiveTimestamp: _lastActiveTimestamp, ...card }) => card),
      limit: DAILY_VIEW_LIMIT,
      used: viewedIds.size,
      remaining: remaining - ranked.length,
      filter: normalizedFilter,
    };
  }

  async markViewed(userId: string, viewedUserId: string) {
    if (userId === viewedUserId) {
      throw new BadRequestException({
        success: false,
        error: { code: "CANNOT_VIEW_SELF", message: "You cannot view your own recommendation" },
      });
    }

    const candidate = await this.prisma.user.findUnique({
      where: { id: viewedUserId },
      select: { id: true, status: true },
    });
    if (!candidate || candidate.status !== "ACTIVE") {
      throw new BadRequestException({
        success: false,
        error: { code: "USER_NOT_FOUND", message: "Recommended user not found" },
      });
    }

    await this.prisma.discoverView.upsert({
      where: {
        userId_viewedUserId_viewDate: {
          userId,
          viewedUserId,
          viewDate: this.startOfToday(),
        },
      },
      // Idempotent: opening the same card twice does not consume a second slot.
      update: {},
      create: { userId, viewedUserId, viewDate: this.startOfToday() },
    });

    /**
     * FEATURE (post-audit) — the response now carries the quota.
     *
     * This route existed, fed the daily limit, and was called by **no client**:
     * the user app never opened a card through it, so `remaining` could never
     * fall and 「今日已看 x/20」 was decorative on every platform. Two things were
     * needed — a caller (see `apps/web/src/app/discover/page.tsx`), and an answer
     * the caller can use without guessing.
     *
     * Returning the authoritative remaining count (rather than letting the client
     * decrement a local counter and hope) means the number shown is recomputed
     * from the same query the recommendation list uses, so a re-opened card, a
     * second tab, or a duplicated request cannot drift the badge.
     */
    const viewedCount = await this.prisma.discoverView.count({
      where: { userId, viewDate: this.startOfToday() },
    });
    const remaining = Math.max(DAILY_VIEW_LIMIT - viewedCount, 0);
    return { viewed: true as const, remaining, limit: DAILY_VIEW_LIMIT, used: viewedCount };
  }

  async findUser(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        languages: { include: { language: true } },
        interests: { include: { interest: true } },
        purposes: { include: { purpose: true } },
        preferredCountries: { include: { country: true } },
        fieldVisibilities: { select: { fieldKey: true, visibility: true } },
      },
    });
  }

  /**
   * P0-3: the set of user ids that must never appear in the viewer's Discovery
   * feed — users the viewer blocked, users who blocked the viewer, and users
   * with an ACTIVE Connection. The viewer themself is excluded separately by the
   * `id: { not: userId }` predicate.
   */
  private async excludedCandidateIds(userId: string): Promise<{
    excluded: string[];
    blockedIds: Set<string>;
    connectedIds: Set<string>;
  }> {
    const [blocks, connections] = await Promise.all([
      this.prisma.block.findMany({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
        select: { blockerId: true, blockedId: true },
      }),
      this.prisma.connection.findMany({
        where: {
          status: "ACTIVE",
          OR: [{ userAId: userId }, { userBId: userId }],
        },
        select: { userAId: true, userBId: true },
      }),
    ]);

    const blockedIds = new Set<string>();
    for (const row of blocks) {
      // Keep the counterpart, drop the viewer themself.
      blockedIds.add(row.blockerId === userId ? row.blockedId : row.blockerId);
    }
    const connectedIds = new Set<string>();
    for (const row of connections) {
      connectedIds.add(row.userAId === userId ? row.userBId : row.userAId);
    }
    blockedIds.delete(userId);
    connectedIds.delete(userId);

    // The two subsets stay separate: "blocked" means nothing may be projected,
    // while "connected" only means the CONNECTIONS tier opens up.
    return {
      excluded: [...new Set([...blockedIds, ...connectedIds])],
      blockedIds,
      connectedIds,
    };
  }

  private scoreCandidate(
    current: NonNullable<UserWithRelations>,
    candidate: NonNullable<UserWithRelations>,
    viewer: ViewerContext,
  ) {
    // Discovery reads the `User` row directly, so without this every governed
    // field reached the card regardless of `ProfileFieldVisibility` — a
    // `bio`/`interests` set to PRIVATE was still published here. This is the
    // same helper `GET /users/:id` uses, so there is exactly one rule set and
    // not a second copy that can drift. The ranking below is untouched.
    const fieldVisibility = resolveFieldVisibilityMap(candidate.fieldVisibilities ?? []);
    const canSee = (field: ProfileVisibilityField) => canViewField(fieldVisibility[field], viewer);

    const currentNative = new Set(
      current.languages.filter((row) => row.type === "NATIVE").map((row) => row.languageCode),
    );
    const currentLearning = new Set(
      current.languages.filter((row) => row.type === "LEARNING").map((row) => row.languageCode),
    );
    const candidateNative = new Set(
      candidate.languages.filter((row) => row.type === "NATIVE").map((row) => row.languageCode),
    );
    const candidateLearning = new Set(
      candidate.languages.filter((row) => row.type === "LEARNING").map((row) => row.languageCode),
    );

    const languageComplement =
      [...currentLearning].some((code) => candidateNative.has(code)) ||
      [...candidateLearning].some((code) => currentNative.has(code));
    const sharedInterests = this.intersection(
      current.interests.map((row) => row.interest.slug),
      candidate.interests.map((row) => row.interest.slug),
    );
    const sharedPurposes = this.intersection(
      current.purposes.map((row) => row.purpose.slug),
      candidate.purposes.map((row) => row.purpose.slug),
    );
    const preferredCountries = new Set(current.preferredCountries.map((row) => row.countryCode));
    const countryMatch = candidate.countryCode ? preferredCountries.has(candidate.countryCode) : false;
    const activityScore = this.activityScore(candidate.lastActiveAt);

    const languageScore = languageComplement ? LANGUAGE_SCORE : 0;
    const interestScore = Math.round((sharedInterests.length / Math.max(current.interests.length, 1)) * INTEREST_SCORE);
    const purposeScore = sharedPurposes.length > 0 ? PURPOSE_SCORE : 0;
    const countryScore = countryMatch ? COUNTRY_SCORE : 0;
    const score = Math.min(languageScore + interestScore + purposeScore + countryScore + activityScore, 100);
    const reasons: string[] = [];
    // A reason may only be shown when the field it is derived from is visible to
    // this viewer: "共同兴趣：摄影" would otherwise hand over a hidden interest.
    // The `score` above is computed from the raw rows and does not change.
    if (canSee("languages") && languageScore) reasons.push("语言互补");
    if (canSee("interests") && sharedInterests.length) reasons.push(`共同兴趣：${sharedInterests.slice(0, 2).join("、")}`);
    if (canSee("purposes") && purposeScore) reasons.push("交友目的相近");
    if (canSee("countryCode") && countryScore) reasons.push("符合国家偏好");
    // Activity is not a governed field (`lastActiveAt` is not on the whitelist).
    if (activityScore >= 8) reasons.push("近期活跃");

    // Hidden scalars become null and hidden lists become [], so the response
    // shape is stable and the card simply omits the row.
    const ownCountry = canSee("countryCode")
      ? candidate.preferredCountries.find((row) => row.countryCode === candidate.countryCode)?.country
      : undefined;

    return {
      id: candidate.id,
      nickname: canSee("nickname") ? candidate.nickname : null,
      avatarUrl: canSee("avatarUrl") ? candidate.avatarUrl : null,
      countryCode: canSee("countryCode") ? candidate.countryCode : null,
      countryName: ownCountry?.name ?? null,
      countryFlag: ownCountry?.flag ?? null,
      age: canSee("birthDate") ? this.calculateAge(candidate.birthDate) : null,
      bio: canSee("bio") ? candidate.bio : null,
      languages: canSee("languages")
        ? candidate.languages.map((row) => ({
            code: row.languageCode,
            name: row.language.name,
            nativeName: row.language.nativeName,
            type: row.type,
            level: row.level,
          }))
        : [],
      interests: canSee("interests")
        ? candidate.interests.map((row) => ({
            slug: row.interest.slug,
            name: row.interest.name,
            nameZh: row.interest.nameZh,
          }))
        : [],
      purposes: canSee("purposes")
        ? candidate.purposes.map((row) => ({
            slug: row.purpose.slug,
            name: row.purpose.name,
            nameZh: row.purpose.nameZh,
          }))
        : [],
      matchScore: score,
      matchReasons: reasons,
      lastActiveTimestamp: candidate.lastActiveAt?.getTime() ?? 0,
    } satisfies DiscoverCard & { lastActiveTimestamp: number };
  }

  private intersection(left: string[], right: string[]) {
    const rightSet = new Set(right);
    return [...new Set(left)].filter((value) => rightSet.has(value));
  }

  private activityScore(lastActiveAt: Date | null) {
    if (!lastActiveAt) return 0;
    const hours = (Date.now() - lastActiveAt.getTime()) / (60 * 60 * 1000);
    if (hours <= 24) return ACTIVITY_SCORE;
    if (hours <= 72) return 8;
    if (hours <= 168) return 5;
    return 2;
  }

  private calculateAge(birthDate: Date | null) {
    if (!birthDate) return null;
    const now = new Date();
    let age = now.getFullYear() - birthDate.getFullYear();
    const month = now.getMonth() - birthDate.getMonth();
    if (month < 0 || (month === 0 && now.getDate() < birthDate.getDate())) age -= 1;
    return age;
  }

  private startOfToday() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }
}
