"use client";

import { useCallback, useEffect, useState } from "react";
import { PhoneShell } from "@/components/phone-shell";
import { TabBar } from "@/components/tab-bar";
import { SmallButton } from "@/components/ui";
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
  { id: "all", label: "🌎 Everyone" },
  { id: "language", label: "Language exchange" },
  { id: "gaming", label: "Gaming" },
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

  const viewed = Math.min(DAILY_LIMIT, Math.max(0, DAILY_LIMIT - remaining));
  const progress = Math.round((viewed / DAILY_LIMIT) * 100);

  return (
    <PhoneShell>
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[22px] font-semibold">Discover</h1>
            <p className="mt-1 text-[13px] text-muted">先聊聊，再成为朋友。</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-full bg-indigo-50 px-3 py-1.5 text-[11px] font-medium text-[#6B7CFF]">
              今日剩余 {remaining}
            </span>
            <AdminEntry />
          </div>
        </div>

        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-indigo-100">
            <div className="tf-gradient h-full rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1.5 text-center text-[11px] text-muted">
            今日已看 {viewed}/{DAILY_LIMIT}
          </p>
        </div>

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
                "min-h-[2.25rem] shrink-0 rounded-full border px-4 py-1.5 text-[12px] transition disabled:opacity-60",
                filter === option.id ? "border-transparent tf-gradient font-medium text-white" : "border-line text-muted",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <p className="mt-2 text-[11px] text-muted">
          {filter === "language"
            ? "只看想语言交换的人，点头像看完整资料。"
            : filter === "gaming"
              ? "只看有游戏兴趣的人，点头像看完整资料。"
              : "按语言互补、共同兴趣和活跃度综合排序，点头像看完整资料。"}
        </p>

        {loading ? <DiscoverBubbleFieldSkeleton /> : null}

        {!loading && error ? (
          <div className="mt-8 rounded-3xl border border-red-100 bg-red-50 p-6 text-center">
            <p className="text-[14px] font-medium text-red-700">推荐暂时不可用</p>
            <p className="mt-2 text-[12px] leading-5 text-red-600">{error}</p>
            <SmallButton variant="gradient" className="mt-5 w-full" onClick={() => void loadRecommendations(filter)}>
              重试
            </SmallButton>
          </div>
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
          <DiscoverBubbleField items={items} onOpenProfile={setPreviewUserId} />
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
    <div className="mt-8 rounded-3xl border border-dashed border-indigo-200 bg-[#F7F9FF] p-6 text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-indigo-100 text-2xl">🌎</div>
      <p className="mt-4 text-[15px] font-medium">
        {remaining === 0 ? "今天的推荐看完啦" : filter === "all" ? "暂时没有合适的人" : "这个筛选下暂时没有合适的人"}
      </p>
      <p className="mt-2 text-[13px] leading-6 text-muted">
        {remaining === 0
          ? "明天再来看看，认真认识一个人。"
          : filter === "all"
            ? "完善语言、兴趣和目的后，会得到更好的推荐。"
            : "换个筛选看看，或完善语言和兴趣后会有更多匹配。"}
      </p>
      <div className="mt-5 flex gap-2">
        {filter !== "all" ? (
          <SmallButton className="flex-1" onClick={onReset}>
            看全部
          </SmallButton>
        ) : null}
        {remaining > 0 ? (
          <SmallButton variant="gradient" className="flex-1" onClick={onRetry}>
            重新加载
          </SmallButton>
        ) : null}
      </div>
    </div>
  );
}
