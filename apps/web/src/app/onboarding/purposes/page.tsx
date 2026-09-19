"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { GradientButton } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

type Purpose = { id: string; slug: string; name: string; nameZh: string | null };
type MeResponse = { purposes?: Array<{ slug: string }> };

const PURPOSE_EMOJI: Record<string, string> = {
  "language-exchange": "🗣️",
  "making-friends": "🤝",
  gaming: "🎮",
  travel: "✈️",
  music: "🎵",
  study: "📚",
  culture: "🌏",
};

export default function PurposesPage() {
  const router = useRouter();
  const [purposes, setPurposes] = useState<Purpose[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        const [meta, me] = await Promise.all([
          apiFetch<Purpose[]>("/meta/purposes"),
          apiFetch<MeResponse>("/users/me").catch(() => null),
        ]);
        setPurposes(meta);
        if (me?.purposes && me.purposes.length > 0) {
          setSelected(me.purposes.map((item) => item.slug));
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "加载失败");
      } finally {
        setFetching(false);
      }
    }
    void init();
  }, []);

  function toggle(slug: string) {
    setSelected((current) =>
      current.includes(slug) ? current.filter((value) => value !== slug) : [...current, slug],
    );
  }

  async function handleNext() {
    if (selected.length === 0) {
      setError("请至少选择一个目的。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await apiFetch("/users/me/purposes", { method: "PUT", body: { slugs: selected } });
      router.push("/onboarding/countries");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存失败，请稍后再试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PhoneShell>
      <ScreenHeader title="交友目的" backHref="/onboarding/languages" />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-2">
        <p className="text-[15px] font-medium">你想认识别人是为了？（可多选）</p>
        {fetching ? (
          <div className="mt-5 animate-pulse space-y-3">
            <div className="h-12 rounded-2xl bg-indigo-50" />
            <div className="h-12 rounded-2xl bg-indigo-50" />
            <div className="h-12 rounded-2xl bg-indigo-50" />
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {purposes.map((item) => {
              const active = selected.includes(item.slug);
              return (
                <button
                  key={item.slug}
                  onClick={() => toggle(item.slug)}
                  aria-pressed={active}
                  className={cn(
                    "flex h-12 w-full items-center justify-between rounded-2xl border border-line px-4 text-left text-[14px]",
                    active && "border-[#8B6CFF] bg-[#F4F1FF] font-medium",
                  )}
                >
                  <span>
                    {PURPOSE_EMOJI[item.slug] ? `${PURPOSE_EMOJI[item.slug]} ` : ""}
                    {item.nameZh ?? item.name}
                  </span>
                  <span
                    className={cn(
                      "grid h-5 w-5 place-items-center rounded-full border text-[11px]",
                      active ? "border-transparent tf-gradient text-white" : "text-transparent",
                    )}
                  >
                    ✓
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {selected.length > 0 ? (
          <p className="mt-3 text-[12px] text-muted">已选 {selected.length} 个</p>
        ) : null}
        {error ? <p className="mt-4 text-[12px] text-red-500">{error}</p> : null}
        <div className="mb-1 mt-8">
          <GradientButton onClick={handleNext} disabled={loading || fetching}>
            {loading ? "保存中…" : "下一步"}
          </GradientButton>
        </div>
      </div>
    </PhoneShell>
  );
}
