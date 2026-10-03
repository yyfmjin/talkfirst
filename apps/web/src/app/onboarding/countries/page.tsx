"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { TFRowSkeleton, TFButton, TFLoadingRegion, TFSearch } from "@/components/tf";
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
        <p className="text-ui text-content-muted">
          选择你想认识的国家 / 地区（可多选，不选表示全球{selected.length > 0 ? `，已选 ${selected.length}` : ""}）。
        </p>
        <div className="mt-3 flex items-start gap-2">
          {/* `TFSearch` is what the two sibling onboarding pickers
              (`/onboarding/languages`, `/onboarding/interests`) already use, so the
              three steps now share one search affordance and the clear button.
              The accessible name 「搜索国家」 is preserved. */}
          <TFSearch
            className="min-w-0 flex-1"
            label="搜索国家"
            placeholder="搜索国家或地区，如 日本、JP"
            value={search}
            onValueChange={setSearch}
            onClear={() => setSearch("")}
          />
          {selected.length > 0 ? (
            <TFButton variant="secondary" size="sm" className="mt-0.5 shrink-0" onClick={() => setSelected([])}>
              全球
            </TFButton>
          ) : null}
        </div>
        {fetching ? (
          <TFLoadingRegion label="正在加载国家列表">
            <div className="mt-5 space-y-2.5">
              <TFRowSkeleton />
              <TFRowSkeleton />
              <TFRowSkeleton />
            </div>
          </TFLoadingRegion>
        ) : (
          <div className="mt-5 space-y-2.5">
            {filtered.map((item) => {
              const active = selected.includes(item.code);
              return (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => toggle(item.code)}
                  aria-pressed={active}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-row border px-4 py-3 text-left text-ui",
                    "transition-[background-color,border-color] duration-instant ease-out",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
                    active
                      ? "border-brand-500 bg-brand-50 font-medium text-content"
                      : "border-border bg-surface text-content hover:bg-surface-sunken",
                  )}
                >
                  <span className="min-w-0">
                    {item.flag ?? "🌐"} {item.name}
                    <span className="ml-2 text-caption text-content-subtle">{item.code}</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid h-5 w-5 shrink-0 place-items-center rounded-full text-overline",
                      active ? "bg-brand-500 text-white" : "border border-border text-transparent",
                    )}
                  >
                    ✓
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 ? (
              <p className="text-caption text-content-muted">没有匹配的国家，换个关键词试试。</p>
            ) : null}
          </div>
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
            {selected.length > 0 ? `下一步（${selected.length}）` : "全球，下一步"}
          </TFButton>
        </div>
      </div>
    </PhoneShell>
  );
}
