"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { TFChip, TFRowSkeleton, TFSearch, TFButton, TFLoadingRegion } from "@/components/tf";
import { apiFetch } from "@/lib/api";

type Interest = { id: string; slug: string; name: string; nameZh: string | null; category: string };
type MeResponse = { interests?: Array<{ slug: string }> };

const INTEREST_EMOJI: Record<string, string> = {
  minecraft: "⛏️",
  valorant: "🎯",
  gta: "🚗",
  steam: "🎮",
  nintendo: "🍄",
  pop: "🎤",
  rock: "🎸",
  "hip-hop": "🎧",
  kpop: "💜",
  "travel-jp": "🗾",
  "travel-kr": "🇰🇷",
  "travel-uk": "🇬🇧",
  photography: "📷",
  movies: "🎬",
  food: "🍜",
  anime: "🍥",
  "language-exchange": "🗣️",
  culture: "🌏",
};

export default function InterestsPage() {
  const router = useRouter();
  const [interests, setInterests] = useState<Interest[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        const [meta, me] = await Promise.all([
          apiFetch<Interest[]>("/meta/interests"),
          apiFetch<MeResponse>("/users/me").catch(() => null),
        ]);
        setInterests(meta);
        if (me?.interests && me.interests.length > 0) {
          setSelected(me.interests.map((item) => item.slug));
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "加载失败");
      } finally {
        setFetching(false);
      }
    }
    void init();
  }, []);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return interests;
    return interests.filter((item) =>
      `${item.slug} ${item.name} ${item.nameZh ?? ""}`.toLowerCase().includes(keyword),
    );
  }, [interests, search]);

  const categories = useMemo(
    () => [...new Set(filtered.map((item) => item.category))],
    [filtered],
  );

  function toggle(slug: string) {
    setSelected((current) =>
      current.includes(slug) ? current.filter((value) => value !== slug) : [...current, slug],
    );
  }

  async function handleNext() {
    if (selected.length < 3) {
      setError(`请至少选择 3 个兴趣（已选 ${selected.length}）。`);
      return;
    }
    setLoading(true);
    setError("");
    try {
      await apiFetch("/users/me/interests", {
        method: "PUT",
        body: { slugs: selected },
      });
      router.push("/onboarding/languages");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存失败，请稍后再试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PhoneShell>
      <ScreenHeader title="兴趣标签" backHref="/onboarding/profile" />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <p className="text-ui text-content-muted">
          选择你最感兴趣的内容（至少 3 个，已选 {selected.length}）
        </p>
        <div className="mt-3">
          {/* `TFSearch` brings its own clear button, which replaces the separate
              「清空」 control — one less button, and clearing the *query* is what a
              search field's ✕ should do. Clearing the *selection* is a different
              action and is offered explicitly below the selection summary. */}
          <TFSearch
            label="搜索兴趣"
            placeholder="搜索兴趣，如 游戏、音乐、旅行"
            value={search}
            onValueChange={setSearch}
            onClear={() => setSearch("")}
          />
        </div>
        {fetching ? (
          <TFLoadingRegion label="正在加载兴趣列表">
            <div className="mt-5 space-y-3">
              <TFRowSkeleton />
              <TFRowSkeleton />
            </div>
          </TFLoadingRegion>
        ) : (
          <>
            {selected.length > 0 ? (
              <div className="mt-4 rounded-row bg-surface-sunken p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-caption font-medium text-content-muted">已选 {selected.length} 个</p>
                  <button
                    type="button"
                    onClick={() => setSelected([])}
                    className="rounded-control px-2 py-1 text-caption text-content-muted underline decoration-dotted"
                  >
                    清空选择
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selected.map((slug) => {
                    const found = interests.find((item) => item.slug === slug);
                    return (
                      <button
                        key={slug}
                        type="button"
                        onClick={() => toggle(slug)}
                        aria-label={`移除 ${found?.nameZh ?? found?.name ?? slug}`}
                        className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-caption text-brand-600 transition-colors duration-instant hover:bg-brand-50"
                      >
                        <span className="min-w-0 truncate">
                          {INTEREST_EMOJI[slug] ? `${INTEREST_EMOJI[slug]} ` : ""}
                          {found?.nameZh ?? found?.name ?? slug}
                        </span>
                        <span aria-hidden="true">✕</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {categories.length === 0 ? (
              <p className="mt-4 text-caption text-content-muted">没有匹配的兴趣，换个关键词试试。</p>
            ) : null}
            {categories.map((category) => (
              <section key={category} className="mt-5">
                <h2 className="mb-2.5 text-caption font-medium text-content-muted">{category}</h2>
                <div className="flex flex-wrap gap-2">
                  {filtered
                    .filter((item) => item.category === category)
                    .map((item) => (
                      <TFChip
                        key={item.slug}
                        selected={selected.includes(item.slug)}
                        onClick={() => toggle(item.slug)}
                      >
                        {INTEREST_EMOJI[item.slug] ? `${INTEREST_EMOJI[item.slug]} ` : ""}
                        {item.nameZh ?? item.name}
                      </TFChip>
                    ))}
                </div>
              </section>
            ))}
          </>
        )}
        {error ? (
          <p role="alert" className="mt-4 break-words text-caption text-danger-600">
            {error}
          </p>
        ) : null}
        <div className="mt-8">
          <TFButton
            size="lg"
            fullWidth
            onClick={() => void handleNext()}
            disabled={fetching}
            loading={loading}
            loadingLabel="保存中…"
          >
            {selected.length >= 3 ? `下一步（${selected.length}）` : "下一步"}
          </TFButton>
        </div>
      </div>
    </PhoneShell>
  );
}
