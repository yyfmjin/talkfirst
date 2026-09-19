"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { GradientButton } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

type Country = { code: string; name: string; flag: string | null };
type MeResponse = { preferredCountries?: Array<{ code: string }> };

export default function CountriesPage() {
  const router = useRouter();
  const [countries, setCountries] = useState<Country[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        const [meta, me] = await Promise.all([
          apiFetch<Country[]>("/meta/countries"),
          apiFetch<MeResponse>("/users/me").catch(() => null),
        ]);
        setCountries(meta);
        if (me?.preferredCountries && me.preferredCountries.length > 0) {
          setSelected(me.preferredCountries.map((item) => item.code));
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "加载失败");
      } finally {
        setFetching(false);
      }
    }
    void init();
  }, []);

  const keyword = search.trim().toLowerCase();
  const filtered = keyword
    ? countries.filter((item) =>
        `${item.code} ${item.name}`.toLowerCase().includes(keyword),
      )
    : countries;

  function toggle(code: string) {
    setSelected((current) =>
      current.includes(code) ? current.filter((value) => value !== code) : [...current, code],
    );
  }

  async function handleNext() {
    setLoading(true);
    setError("");
    try {
      await apiFetch("/users/me/preferred-countries", {
        method: "PUT",
        body: { codes: selected },
      });
      router.push("/onboarding/social");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存失败，请稍后再试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PhoneShell>
      <ScreenHeader title="想认识谁？" backHref="/onboarding/purposes" />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-2">
        <p className="text-[13px] text-muted">
          选择你想认识的国家 / 地区（可多选，不选表示全球{selected.length > 0 ? `，已选 ${selected.length}` : ""}）。
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索国家，如 Japan、JP"
            aria-label="搜索国家"
            className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-[#F8FAFF] px-3 text-[13px] outline-none focus:ring-2 focus:ring-indigo-200"
          />
          {selected.length > 0 ? (
            <button
              onClick={() => setSelected([])}
              className="h-11 shrink-0 rounded-xl border border-line px-3 text-[12px] text-muted"
            >
              全球
            </button>
          ) : null}
        </div>
        {fetching ? (
          <div className="mt-5 animate-pulse space-y-2">
            <div className="h-12 rounded-2xl bg-indigo-50" />
            <div className="h-12 rounded-2xl bg-indigo-50" />
            <div className="h-12 rounded-2xl bg-indigo-50" />
          </div>
        ) : (
          <div className="mt-5 space-y-2">
            {filtered.map((item) => {
              const active = selected.includes(item.code);
              return (
                <button
                  key={item.code}
                  onClick={() => toggle(item.code)}
                  aria-pressed={active}
                  className={cn(
                    "flex h-12 w-full items-center justify-between rounded-2xl border border-line px-4 text-left text-[14px]",
                    active && "border-[#8B6CFF] bg-[#F4F1FF] font-medium",
                  )}
                >
                  <span>
                    {item.flag ?? "🌐"} {item.name}
                    <span className="ml-2 text-[11px] text-muted">{item.code}</span>
                  </span>
                  <span
                    className={cn(
                      "grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px]",
                      active ? "border-transparent tf-gradient text-white" : "text-transparent",
                    )}
                  >
                    ✓
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 ? (
              <p className="text-[12px] text-muted">没有匹配的国家，换个关键词试试。</p>
            ) : null}
          </div>
        )}
        {error ? <p className="mt-4 text-[12px] text-red-500">{error}</p> : null}
        <div className="mb-1 mt-8">
          <GradientButton onClick={handleNext} disabled={loading || fetching}>
            {loading ? "保存中…" : selected.length > 0 ? `下一步（${selected.length}）` : "全球，下一步"}
          </GradientButton>
        </div>
      </div>
    </PhoneShell>
  );
}
