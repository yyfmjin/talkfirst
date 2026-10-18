"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import {
  TFBadge,
  TFButton,
  TFChip,
  TFErrorState,
  TFSearch,
} from "@/components/tf";
import { apiFetch } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/errors";
import { useT } from "@/lib/i18n";

/**
 * PC-1.4 §5: everyday editing of the fields that used to be onboarding-only.
 *
 * Registration used to be the last chance to set languages / interests /
 * purposes / preferred countries. Each section saves on its own through the
 * existing replacement endpoints (no new API was added), and every save
 * re-reads the server so the screen shows stored state.
 *
 * The API constraints are mirrored here so a member is told before a request
 * fails: languages 1–8, interests 3–20, purposes 1–7, countries ≤ 10.
 */

type Language = { code: string; name: string; nativeName: string | null };
type Interest = { id: string; slug: string; name: string; nameZh: string | null; category: string };
type Purpose = { slug: string; name: string; nameZh: string | null };
type Country = { code: string; name: string; flag: string | null };

type FullCard = {
  languages: Array<{ code: string; type: string; level: string }>;
  interests: Array<{ slug: string }>;
  purposes: Array<{ slug: string }>;
  preferredCountries: Array<{ code: string }>;
};

const LANGUAGE_MAX = 8;
const INTEREST_MIN = 3;
const INTEREST_MAX = 20;
const PURPOSE_MAX = 7;
const COUNTRY_MAX = 10;

type SectionId = "languages" | "interests" | "purposes" | "countries";


export default function MeInterestsPage() {
  const { t } = useT();
  const [languages, setLanguages] = useState<Language[]>([]);
  const [interests, setInterests] = useState<Interest[]>([]);
  const [purposes, setPurposes] = useState<Purpose[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);

  const [nativeCode, setNativeCode] = useState("");
  const [learning, setLearning] = useState<string[]>([]);
  const [interestSlugs, setInterestSlugs] = useState<string[]>([]);
  const [purposeSlugs, setPurposeSlugs] = useState<string[]>([]);
  const [countryCodes, setCountryCodes] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState<SectionId | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [languageMeta, interestMeta, purposeMeta, countryMeta, me] = await Promise.all([
        apiFetch<Language[]>("/meta/languages"),
        apiFetch<Interest[]>("/meta/interests"),
        apiFetch<Purpose[]>("/meta/purposes"),
        apiFetch<Country[]>("/meta/countries"),
        apiFetch<FullCard>("/users/me"),
      ]);
      setLanguages(languageMeta);
      setInterests(interestMeta);
      setPurposes(purposeMeta);
      setCountries(countryMeta);

      setNativeCode(me.languages.find((item) => item.type === "NATIVE")?.code ?? "");
      setLearning(me.languages.filter((item) => item.type === "LEARNING").map((item) => item.code));
      setInterestSlugs(me.interests.map((item) => item.slug));
      setPurposeSlugs(me.purposes.map((item) => item.slug));
      setCountryCodes(me.preferredCountries.map((item) => item.code));
    } catch (requestError) {
      setError(friendlyErrorMessage(requestError, t("it.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Each section saves through its own existing endpoint and then re-reads. */
  const save = useCallback(
    async (section: SectionId, action: () => Promise<unknown>, successMessage: string) => {
      setSaving(section);
      setError("");
      setNotice("");
      try {
        await action();
        await load();
        setNotice(successMessage);
        return true;
      } catch (requestError) {
        setError(friendlyErrorMessage(requestError, t("it.saveFailed")));
        return false;
      } finally {
        setSaving(null);
      }
    },
    [load, t],
  );

  const learningClean = learning.filter((code) => code !== nativeCode);

  async function saveLanguages() {
    if (!nativeCode) {
      setError(t("it.nativeRequired"));
      return;
    }
    if (learningClean.length === 0) {
      setError(t("it.learningRequired"));
      return;
    }
    await save(
      "languages",
      () =>
        apiFetch("/users/me/languages", {
          method: "PUT",
          body: {
            items: [
              { code: nativeCode, type: "NATIVE", level: "NATIVE" },
              ...learningClean.map((code) => ({ code, type: "LEARNING", level: "INTERMEDIATE" })),
            ],
          },
        }),
      t("it.savedLanguages"),
    );
  }

  async function saveInterests() {
    if (interestSlugs.length < INTEREST_MIN) {
      setError(t("it.interestsMin", { min: INTEREST_MIN, count: interestSlugs.length }));
      return;
    }
    await save(
      "interests",
      () => apiFetch("/users/me/interests", { method: "PUT", body: { slugs: interestSlugs } }),
      t("it.savedInterests"),
    );
  }

  async function savePurposes() {
    if (purposeSlugs.length === 0) {
      setError(t("it.purposeRequired"));
      return;
    }
    await save(
      "purposes",
      () => apiFetch("/users/me/purposes", { method: "PUT", body: { slugs: purposeSlugs } }),
      t("it.savedPurposes"),
    );
  }

  async function saveCountries() {
    await save(
      "countries",
      () => apiFetch("/users/me/preferred-countries", { method: "PUT", body: { codes: countryCodes } }),
      t("it.savedCountries"),
    );
  }

  const filteredInterests = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return interests;
    return interests.filter((item) =>
      `${item.slug} ${item.name} ${item.nameZh ?? ""}`.toLowerCase().includes(keyword),
    );
  }, [interests, search]);

  const interestCategories = useMemo(
    () => [...new Set(filteredInterests.map((item) => item.category))],
    [filteredInterests],
  );

  function languageName(code: string) {
    const found = languages.find((item) => item.code === code);
    return found ? found.nativeName ?? found.name : code;
  }

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  }

  return (
    <PhoneShell>
      <ScreenHeader title={t("it.title")} backHref="/me" />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        <p className="text-ui leading-6 text-content-muted">
          {t("it.intro")}
        </p>

        {loading ? (
          <div className="mt-5 animate-pulse space-y-3">
            <div className="h-40 rounded-card bg-neutral-100" />
            <div className="h-40 rounded-card bg-neutral-100" />
            <div className="h-40 rounded-card bg-neutral-100" />
          </div>
        ) : null}

        {!loading && error ? (
          <div className="mt-5">
            <TFErrorState description={error} onRetry={() => void load()} />
          </div>
        ) : null}

        {!loading ? (
          <>
            <section className="mt-5 rounded-card border border-border bg-surface p-4">
              <p className="text-ui font-semibold text-content">{t("it.langHeading")}</p>
              <p className="mt-0.5 text-caption leading-4 text-content-muted">
                {t("it.langHint", { max: LANGUAGE_MAX - 1 })}
              </p>
              <p className="mb-2 mt-3 text-caption font-medium text-content-muted">{t("it.nativeLabel")}</p>
              <div data-testid="native-languages" className="flex flex-wrap gap-1.5">
                {languages.map((item) => (
                  <TFChip
                    key={item.code}
                    selected={nativeCode === item.code}
                    onClick={() => {
                      setNativeCode(item.code);
                      setLearning((current) => current.filter((code) => code !== item.code));
                    }}
                  >
                    {item.nativeName ?? item.name}
                  </TFChip>
                ))}
              </div>
              <p className="mb-2 mt-4 text-caption font-medium text-content-muted">
                {t("it.learningLabel", { count: learningClean.length })}
              </p>
              <div data-testid="learning-languages" className="flex flex-wrap gap-1.5">
                {languages
                  .filter((item) => item.code !== nativeCode)
                  .map((item) => (
                    <TFChip
                      key={item.code}
                      selected={learning.includes(item.code)}
                      onClick={() => setLearning((current) => toggle(current, item.code))}
                    >
                      {item.nativeName ?? item.name}
                    </TFChip>
                  ))}
              </div>
              <p className="mt-3 text-caption leading-4 text-content-muted">
                {t("it.summary", {
                  native: nativeCode ? languageName(nativeCode) : t("it.notChosen"),
                  learning:
                    learningClean.length > 0 ? learningClean.map(languageName).join(", ") : t("it.none"),
                })}
              </p>
              <TFButton
                size="lg"
                fullWidth
                className="mt-4"
                onClick={() => void saveLanguages()}
                disabled={saving !== null && saving !== "languages"}
                loading={saving === "languages"}
                loadingLabel={t("it.saving")}
                aria-label={t("it.saveLanguagesAria")}
              >
                {t("it.saveLanguages")}
              </TFButton>
            </section>

            <section className="mt-5 rounded-card border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-ui font-semibold text-content">{t("it.interestsHeading")}</p>
                  <p className="mt-0.5 text-caption leading-4 text-content-muted">
                    {t("it.interestsHint", { min: INTEREST_MIN, max: INTEREST_MAX })}
                  </p>
                </div>
                <TFBadge tone="brand" className="shrink-0">
                  {interestSlugs.length} / {INTEREST_MAX}
                </TFBadge>
              </div>

              {interestSlugs.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5 rounded-row bg-surface-sunken p-2.5">
                  {interestSlugs.map((slug) => {
                    const found = interests.find((item) => item.slug === slug);
                    return (
                      <button
                        key={slug}
                        type="button"
                        onClick={() => setInterestSlugs((current) => toggle(current, slug))}
                        aria-label={t("it.removeInterest", { name: found?.nameZh ?? found?.name ?? slug })}
                        className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-caption text-brand-600 transition-colors duration-instant hover:bg-brand-50"
                      >
                        <span className="min-w-0 truncate">{found?.nameZh ?? found?.name ?? slug}</span>
                        <span aria-hidden="true">✕</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {/* `TFSearch` keeps the accessible name 「搜索兴趣」 and adds the clear
                  affordance + leading icon. */}
              <TFSearch
                className="mt-3"
                label={t("it.searchLabel")}
                placeholder={t("it.searchPlaceholder")}
                value={search}
                onValueChange={setSearch}
                onClear={() => setSearch("")}
              />

              {interestCategories.length === 0 ? (
                <p className="mt-3 text-caption text-content-muted">{t("it.noMatch")}</p>
              ) : (
                interestCategories.map((category) => (
                  <div key={category} className="mt-4">
                    <p className="mb-2 text-caption font-medium text-content-muted">{category}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {filteredInterests
                        .filter((item) => item.category === category)
                        .map((item) => {
                          const active = interestSlugs.includes(item.slug);
                          return (
                            <TFChip
                              key={item.slug}
                              selected={active}
                              onClick={() =>
                                setInterestSlugs((current) => {
                                  if (current.includes(item.slug)) {
                                    return current.filter((slug) => slug !== item.slug);
                                  }
                                  if (current.length >= INTEREST_MAX) return current;
                                  return [...current, item.slug];
                                })
                              }
                            >
                              {item.nameZh ?? item.name}
                            </TFChip>
                          );
                        })}
                    </div>
                  </div>
                ))
              )}

              {interestSlugs.length >= INTEREST_MAX ? (
                <p className="mt-3 text-caption text-warning-800">{t("it.interestLimit", { max: INTEREST_MAX })}</p>
              ) : null}

              <TFButton
                size="lg"
                fullWidth
                className="mt-4"
                onClick={() => void saveInterests()}
                disabled={saving !== null && saving !== "interests"}
                loading={saving === "interests"}
                loadingLabel={t("it.saving")}
                aria-label={t("it.saveInterests")}
              >
                {t("it.saveInterests")}
              </TFButton>
            </section>

            <section className="mt-5 rounded-card border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-ui font-semibold text-content">{t("it.purposesHeading")}</p>
                  <p className="mt-0.5 text-caption leading-4 text-content-muted">
                    {t("it.purposesHint", { max: PURPOSE_MAX })}
                  </p>
                </div>
                <TFBadge tone="brand" className="shrink-0">
                  {purposeSlugs.length} / {PURPOSE_MAX}
                </TFBadge>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {purposes.map((item) => {
                  const active = purposeSlugs.includes(item.slug);
                  return (
                    <TFChip
                      key={item.slug}
                      selected={active}
                      onClick={() =>
                        setPurposeSlugs((current) => {
                          if (current.includes(item.slug)) {
                            return current.filter((slug) => slug !== item.slug);
                          }
                          if (current.length >= PURPOSE_MAX) return current;
                          return [...current, item.slug];
                        })
                      }
                    >
                      {item.nameZh ?? item.name}
                    </TFChip>
                  );
                })}
              </div>
              <TFButton
                size="lg"
                fullWidth
                className="mt-4"
                onClick={() => void savePurposes()}
                disabled={saving !== null && saving !== "purposes"}
                loading={saving === "purposes"}
                loadingLabel={t("it.saving")}
                aria-label={t("it.savePurposes")}
              >
                {t("it.savePurposes")}
              </TFButton>
            </section>

            <section className="mt-5 rounded-card border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-ui font-semibold text-content">{t("it.countriesHeading")}</p>
                  <p className="mt-0.5 text-caption leading-4 text-content-muted">
                    {t("it.countriesHint", { max: COUNTRY_MAX })}
                  </p>
                </div>
                <TFBadge tone="brand" className="shrink-0">
                  {countryCodes.length} / {COUNTRY_MAX}
                </TFBadge>
              </div>
              <div
                data-testid="country-options"
                className="tf-scroll mt-3 grid max-h-64 grid-cols-2 gap-1.5 overflow-y-auto"
              >
                {countries.map((item) => {
                  const active = countryCodes.includes(item.code);
                  return (
                    /* `w-full justify-start` because this cluster is a two-column
                       GRID, not a wrapping row: a chip that shrink-wraps would
                       leave ragged cell widths. `truncate` keeps a long country
                       name from forcing the column wider. */
                    <TFChip
                      key={item.code}
                      selected={active}
                      onClick={() =>
                        setCountryCodes((current) => {
                          if (current.includes(item.code)) {
                            return current.filter((code) => code !== item.code);
                          }
                          if (current.length >= COUNTRY_MAX) return current;
                          return [...current, item.code];
                        })
                      }
                      className="w-full justify-start"
                    >
                      <span className="truncate">
                        {item.flag ?? ""} {item.name}
                      </span>
                    </TFChip>
                  );
                })}
              </div>
              <TFButton
                size="lg"
                fullWidth
                className="mt-4"
                onClick={() => void saveCountries()}
                disabled={saving !== null && saving !== "countries"}
                loading={saving === "countries"}
                loadingLabel={t("it.saving")}
                aria-label={t("it.saveCountriesAria")}
              >
                {t("it.saveCountries")}
              </TFButton>
            </section>
          </>
        ) : null}

        {notice ? (
          <p role="status" className="mt-4 text-center text-caption text-success-600">
            {notice}
          </p>
        ) : null}

        <div className="mt-6">
          <TFButton variant="secondary" fullWidth href="/me">
            {t("it.back")}
          </TFButton>
        </div>
      </div>
    </PhoneShell>
  );
}
