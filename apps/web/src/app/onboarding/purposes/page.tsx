"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { TFRowSkeleton, TFButton, TFLoadingRegion } from "@/components/tf";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";
import { displayName, localePath } from "@/lib/i18n";
import { useT } from "@/lib/i18n/use-locale";

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
  const { locale, t } = useT();
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
        setError(requestError instanceof Error ? requestError.message : t("onboarding.common.loadFailed"));
      } finally {
        setFetching(false);
      }
    }
    void init();
  }, [t]);

  function toggle(slug: string) {
    setSelected((current) =>
      current.includes(slug) ? current.filter((value) => value !== slug) : [...current, slug],
    );
  }

  async function handleNext() {
    if (selected.length === 0) {
      setError(t("onboarding.purposes.required"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      await apiFetch("/users/me/purposes", { method: "PUT", body: { slugs: selected } });
      router.push(localePath(locale, "/onboarding/countries"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("onboarding.common.saveFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <PhoneShell>
      <ScreenHeader title={t("onboarding.purposes.title")} backHref={localePath(locale, "/onboarding/languages")} />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-2">
        <p className="text-[15px] font-medium">{t("onboarding.purposes.question")}</p>
        {fetching ? (
          <TFLoadingRegion label={t("onboarding.purposes.loading")}>
            <div className="mt-5 space-y-3">
              <TFRowSkeleton />
              <TFRowSkeleton />
              <TFRowSkeleton />
            </div>
          </TFLoadingRegion>
        ) : (
          /*
           * Selectable ROWS, not chips — deliberately. `TFChip` is for a compact
           * tag cloud; these are multi-select options with a description-length
           * label, so they keep the full-width row shape and get the design system
           * only where it matters: brand-500 for the selected border and fill (the
           * old code used a `tf-gradient` checkmark, which made selection look like
           * a button rather than a state), a real `bg-brand-500` tick instead of a
           * gradient one, and `aria-pressed` so the state is announced.
           */
          <div className="mt-5 space-y-2.5">
            {purposes.map((item) => {
              const active = selected.includes(item.slug);
              return (
                <button
                  key={item.slug}
                  type="button"
                  onClick={() => toggle(item.slug)}
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
                    {PURPOSE_EMOJI[item.slug] ? `${PURPOSE_EMOJI[item.slug]} ` : ""}
                    {displayName(locale, item)}
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
          </div>
        )}
        {selected.length > 0 ? (
          <p className="mt-3 text-caption text-content-muted">
            {t("onboarding.common.selectedCount", { count: selected.length })}
          </p>
        ) : null}
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
            loadingLabel={t("onboarding.common.saving")}
          >
            {t("onboarding.common.next")}
          </TFButton>
        </div>
      </div>
    </PhoneShell>
  );
}
