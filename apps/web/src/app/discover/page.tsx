"use client";

import { useCallback, useEffect, useState } from "react";
import { Compass } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { TabBar } from "@/components/tab-bar";
import { TFBadge, TFButton, TFEmptyState, TFErrorState } from "@/components/tf";
import { apiFetch } from "@/lib/api";
import { AdminEntry } from "@/components/admin-entry";
import { ProfilePreviewCard } from "@/components/profile-preview-card";
import { DiscoverBubbleField, DiscoverBubbleFieldSkeleton } from "@/components/discover-bubble-field";
import type { DiscoverBubbleUser } from "@/components/discover-avatar-bubble";
import { cn } from "@/lib/cn";

/**
 * The endpoint still returns the whole candidate — bio, interests, languages,
 * purposes, match reasons — and this type still describes every one of those
 * fields. What changed is what Discover renders: the wall takes
 * `DiscoverBubbleUser` instead, so the full card reaches the browser only for
 * the shared profile card that opens on tap. Dropping the fields here would
 * hide the privacy projection the API already performs, so they stay.
 */
type Recommendation = {
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

type RecommendationResponse = {
  items: Recommendation[];
  limit: number;
  used: number;
  remaining: number;
  filter?: string;
};

const FILTERS = [
  { id: "all", label: "🌎 全部" },
  { id: "language", label: "语言交换" },
  { id: "gaming", label: "游戏搭子" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

const FILTER_STORAGE_KEY = "talkfirst.discover.filter";
const DAILY_LIMIT = 20;

/**
 * Discover answers "who is here".
 *
 * It used to answer "who is here" and "what are they like" at once: the page
 * rendered the whole profile card, and tapping an avatar opened the same card
 * again. The wall now shows identity only — avatar, nickname, age, country —
 * and every remaining field belongs to `ProfilePreviewCard`, which stays the
 * single place a candidate is read in full and the single place Say Hello
 * lives.
 */
export default function DiscoverPage() {
  const [filter, setFilter] = useState<FilterId>("all");
  const [items, setItems] = useState<DiscoverBubbleUser[]>([]);
  const [remaining, setRemaining] = useState(DAILY_LIMIT);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const [previewUserId, setPreviewUserId] = useState<string | null>(null);

  const loadRecommendations = useCallback(async (nextFilter: FilterId, initial = false) => {
    if (initial) setLoading(true);
    else setSwitching(true);
    setError("");
    try {
      const data = await apiFetch<RecommendationResponse>(
        `/discover/recommendations?limit=${DAILY_LIMIT}&filter=${nextFilter}`,
      );
      setItems(data.items);
      setRemaining(data.remaining);
    } catch (err) {
      setError(err instanceof Error ? err.message : "推荐加载失败，请稍后再试");
    } finally {
      setLoading(false);
      setSwitching(false);
    }
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(FILTER_STORAGE_KEY);
    const initialFilter: FilterId = stored === "language" || stored === "gaming" ? stored : "all";
    setFilter(initialFilter);
    void loadRecommendations(initialFilter, true);
  }, [loadRecommendations]);

  function changeFilter(next: FilterId) {
    if (next === filter || switching) return;
    setFilter(next);
    window.localStorage.setItem(FILTER_STORAGE_KEY, next);
    void loadRecommendations(next);
  }

  /**
   * FEATURE (post-audit) — opening a card consumes one of the daily slots.
   *
   * `POST /discover/views/:userId` existed on the server, drove the whole
   * 20-per-day model, and was called by nothing: neither this app nor the native
   * one ever recorded a view, so 「今日剩余 N」 never moved and the "you have seen
   * everyone for today" state could not be reached. Opening the full card is the
   * point at which a recommendation has genuinely been *viewed* — the bubble wall
   * shows identity only — so that is where the slot is spent.
   *
   * The request is fired in the background: a failed bookkeeping call must not
   * prevent somebody from reading a profile, so a rejection is swallowed on
   * purpose. When it succeeds the badge is set from the server's own count rather
   * than from a local `- 1`, which keeps two tabs (or a duplicated request) from
   * drifting apart.
   */
  const openProfile = useCallback(
    (userId: string) => {
      setPreviewUserId(userId);
      void apiFetch<{ remaining: number }>(`/discover/views/${userId}`, { method: "POST" })
        .then((data) => {
          if (typeof data?.remaining === "number") setRemaining(data.remaining);
        })
        .catch(() => {
          // Bookkeeping only — never blocks reading a profile.
        });
    },
    [],
  );

  const viewed = Math.min(DAILY_LIMIT, Math.max(0, DAILY_LIMIT - remaining));
  const progress = Math.round((viewed / DAILY_LIMIT) * 100);

  return (
    <PhoneShell>
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-title font-semibold text-content">发现</h1>
            <p className="mt-1 text-caption text-content-muted">先聊聊，再成为朋友。</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <TFBadge tone="brand">今日剩余 {remaining}</TFBadge>
            <AdminEntry />
          </div>
        </div>

        {/* The daily allowance, as a meter. `neutral-200` track + brand-500 fill
            rather than `bg-indigo-100` + a gradient: this is a quota indicator, so
            it should read as one colour at two brightnesses. */}
        <div className="mt-3">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-neutral-200"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={DAILY_LIMIT}
            aria-valuenow={viewed}
            aria-label="今日已查看的推荐数"
          >
            <div
              className="h-full rounded-full bg-brand-500 transition-[width] duration-base ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1.5 text-center text-caption text-content-muted">
            今日已看 {viewed}/{DAILY_LIMIT}
          </p>
        </div>

        {/*
          The filter row stays a hand-rolled `role="tab"` list rather than becoming
          `TFTabs`, because this one scrolls horizontally when the labels are long.
          `TFTabs` is an equal-width flex row — correct for 推荐/关注/我的 on the
          feed, wrong here, where forcing five tabs into 390px would truncate the
          labels. What it gains from the design system is the selected style: a
          brand border and tint, not a gradient fill (a filter is a state, not a
          call to action).
        */}
        <div className="tf-scroll-x mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="推荐筛选">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={filter === option.id}
              disabled={switching}
              onClick={() => changeFilter(option.id)}
              className={cn(
                "inline-flex min-h-9 shrink-0 items-center rounded-full border px-3.5 text-ui transition-[background-color,border-color,color] duration-instant ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-60",
                filter === option.id
                  ? "border-brand-300 bg-brand-50 font-medium text-brand-600"
                  : "border-border bg-surface text-content-muted hover:bg-surface-sunken",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <p className="mt-2 text-caption leading-5 text-content-muted">
          {filter === "language"
            ? "只看想语言交换的人，点头像看完整资料。"
            : filter === "gaming"
              ? "只看有游戏兴趣的人，点头像看完整资料。"
              : "按语言互补、共同兴趣和活跃度综合排序，点头像看完整资料。"}
        </p>

        {loading ? <DiscoverBubbleFieldSkeleton /> : null}

        {!loading && error ? (
          <TFErrorState
            className="mt-4"
            title="推荐暂时不可用"
            description={error}
            onRetry={() => void loadRecommendations(filter)}
          />
        ) : null}

        {!loading && !error && switching ? <DiscoverBubbleFieldSkeleton /> : null}

        {!loading && !error && !switching && items.length === 0 ? (
          <DiscoverEmpty
            filter={filter}
            remaining={remaining}
            onRetry={() => void loadRecommendations(filter)}
            onReset={() => changeFilter("all")}
          />
        ) : null}

        {!loading && !error && !switching && items.length > 0 ? (
          <DiscoverBubbleField items={items} onOpenProfile={openProfile} />
        ) : null}
      </div>

      <ProfilePreviewCard userId={previewUserId} onClose={() => setPreviewUserId(null)} />
      <TabBar active="/discover" />
    </PhoneShell>
  );
}

function DiscoverEmpty({
  filter,
  remaining,
  onRetry,
  onReset,
}: {
  filter: FilterId;
  remaining: number;
  onRetry: () => void;
  onReset: () => void;
}) {
  return (
    <div className="mt-4">
      <TFEmptyState
        icon={<Compass size={26} />}
        title={remaining === 0 ? "今天的推荐看完啦" : filter === "all" ? "暂时没有合适的人" : "这个筛选下暂时没有合适的人"}
        description={
          remaining === 0
            ? "明天再来看看，认真认识一个人。"
            : filter === "all"
              ? "完善语言、兴趣和目的后，会得到更好的推荐。"
              : "换个筛选看看，或完善语言和兴趣后会有更多匹配。"
        }
        action={
          /*
           * One primary action, chosen by what can actually help:
           *   - a filter that is too narrow  -> 「看全部」 (widening produces results)
           *   - a filter that is already all -> 「重新加载」
           *   - an exhausted daily quota     -> neither; it is a wait, not a retry
           * `filterAll` is derived first so the two branches cannot disagree.
           */
          (() => {
            const filterAll = filter === "all";
            if (remaining === 0) return undefined;
            if (filterAll) {
              return (
                <TFButton className="w-full" onClick={onRetry}>
                  重新加载
                </TFButton>
              );
            }
            return (
              <div className="flex w-full gap-2">
                <TFButton className="flex-1" onClick={onReset}>
                  看全部
                </TFButton>
                <TFButton variant="secondary" className="flex-1" onClick={onRetry}>
                  重新加载
                </TFButton>
              </div>
            );
          })()
        }
      />
    </div>
  );
}
