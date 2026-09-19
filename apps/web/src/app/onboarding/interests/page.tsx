"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { GradientButton } from "@/components/ui";
import { cn } from "@/lib/cn";
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
        <p className="text-[13px] text-muted">
          选择你最感兴趣的内容（至少 3 个，已选 {selected.length}）
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索兴趣，如 游戏、音乐、旅行"
            aria-label="搜索兴趣"
            className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-[#F8FAFF] px-3 text-[13px] outline-none focus:ring-2 focus:ring-indigo-200"
          />
          {selected.length > 0 ? (
            <button
              onClick={() => setSelected([])}
              className="h-11 shrink-0 rounded-xl border border-line px-3 text-[12px] text-muted"
            >
              清空
            </button>
          ) : null}
        </div>
        {fetching ? (
          <div className="mt-5 animate-pulse space-y-3">
            <div className="h-20 rounded-2xl bg-indigo-50" />
            <div className="h-20 rounded-2xl bg-indigo-50" />
          </div>
        ) : (
          <>
            {selected.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2 rounded-2xl bg-[#F7F9FF] p-3">
                {selected.map((slug) => {
                  const found = interests.find((item) => item.slug === slug);
                  return (
                    <button
                      key={slug}
                      onClick={() => toggle(slug)}
                      className="rounded-full bg-white px-3 py-1.5 text-[12px] text-[#6572D8] shadow-sm"
                    >
                      {INTEREST_EMOJI[slug] ? `${INTEREST_EMOJI[slug]} ` : ""}
                      {found?.nameZh ?? found?.name ?? slug} ✕
                    </button>
                  );
                })}
              </div>
            ) : null}
            {categories.length === 0 ? (
              <p className="mt-4 text-[12px] text-muted">没有匹配的兴趣，换个关键词试试。</p>
            ) : null}
            {categories.map((category) => (
              <section key={category} className="mt-5">
                <h2 className="mb-3 text-[13px] font-medium text-muted">{category}</h2>
                <div className="flex flex-wrap gap-2">
                  {filtered
                    .filter((item) => item.category === category)
                    .map((item) => {
                      const active = selected.includes(item.slug);
                      return (
                        <button
                          key={item.slug}
                          onClick={() => toggle(item.slug)}
                          aria-pressed={active}
                          className={cn(
                            "min-h-[2.25rem] rounded-full border border-line px-4 py-1.5 text-[13px]",
                            active && "border-transparent tf-gradient font-medium text-white",
                          )}
                        >
                          {INTEREST_EMOJI[item.slug] ? `${INTEREST_EMOJI[item.slug]} ` : ""}
                          {item.nameZh ?? item.name}
                        </button>
                      );
                    })}
                </div>
              </section>
            ))}
          </>
        )}
        {error ? <p className="mt-4 text-[12px] text-red-500">{error}</p> : null}
        <div className="mb-1 mt-8">
          <GradientButton onClick={handleNext} disabled={loading || fetching}>
            {loading ? "保存中…" : selected.length >= 3 ? `下一步（${selected.length}）` : "下一步"}
          </GradientButton>
        </div>
      </div>
    </PhoneShell>
  );
}
