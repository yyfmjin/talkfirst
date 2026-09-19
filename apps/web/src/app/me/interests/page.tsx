"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { OutlineButton, SmallButton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { apiFetch } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/errors";

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
      setError(friendlyErrorMessage(requestError, "加载失败，请稍后再试。"));
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
        setError(friendlyErrorMessage(requestError, "保存失败，请稍后再试。"));
        return false;
      } finally {
        setSaving(null);
      }
    },
    [load],
  );

  const learningClean = learning.filter((code) => code !== nativeCode);

  async function saveLanguages() {
    if (!nativeCode) {
      setError("请选择母语。");
      return;
    }
    if (learningClean.length === 0) {
      setError("请至少选择 1 门正在学习的语言。");
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
      "语言已保存。",
    );
  }

  async function saveInterests() {
    if (interestSlugs.length < INTEREST_MIN) {
      setError(`请至少选择 ${INTEREST_MIN} 个兴趣（已选 ${interestSlugs.length}）。`);
      return;
    }
    await save(
      "interests",
      () => apiFetch("/users/me/interests", { method: "PUT", body: { slugs: interestSlugs } }),
      "兴趣已保存。",
    );
  }

  async function savePurposes() {
    if (purposeSlugs.length === 0) {
      setError("请至少选择 1 个交友目的。");
      return;
    }
    await save(
      "purposes",
      () => apiFetch("/users/me/purposes", { method: "PUT", body: { slugs: purposeSlugs } }),
      "交友目的已保存。",
    );
  }

  async function saveCountries() {
    await save(
      "countries",
      () => apiFetch("/users/me/preferred-countries", { method: "PUT", body: { codes: countryCodes } }),
      "想认识的国家/地区已保存。",
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
      <ScreenHeader title="语言 · 兴趣 · 目的" backHref="/me" />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        <p className="text-[13px] leading-6 text-muted">
          这里以前只能在注册时填写，现在随时都能改。改完记得点对应小节的保存。
        </p>

        {loading ? (
          <div className="mt-5 animate-pulse space-y-3">
            <div className="h-40 rounded-3xl bg-indigo-50" />
            <div className="h-40 rounded-3xl bg-indigo-50" />
            <div className="h-40 rounded-3xl bg-indigo-50" />
          </div>
        ) : null}

        {!loading && error ? (
          <div className="mt-5 rounded-2xl bg-red-50 p-4 text-center">
            <p className="text-[12px] text-red-700">{error}</p>
            <SmallButton className="mt-3 w-full" onClick={() => void load()}>
              重试
            </SmallButton>
          </div>
        ) : null}

        {!loading ? (
          <>
            <section className="mt-5 rounded-3xl border border-line bg-white p-4">
              <p className="text-[14px] font-semibold">语言</p>
              <p className="mt-0.5 text-[11px] leading-4 text-muted">
                语言互补是推荐的核心：母语 1 门，正在学习最多 {LANGUAGE_MAX - 1} 门。
              </p>
              <p className="mb-2 mt-3 text-[12px] font-medium text-muted">母语（单选）</p>
              <div data-testid="native-languages" className="flex flex-wrap gap-1.5">
                {languages.map((item) => (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => {
                      setNativeCode(item.code);
                      setLearning((current) => current.filter((code) => code !== item.code));
                    }}
                    aria-pressed={nativeCode === item.code}
                    className={cn(
                      "min-h-[2.25rem] rounded-full border border-line px-3 py-1.5 text-[12px]",
                      nativeCode === item.code && "border-transparent tf-gradient font-medium text-white",
                    )}
                  >
                    {item.nativeName ?? item.name}
                  </button>
                ))}
              </div>
              <p className="mb-2 mt-4 text-[12px] font-medium text-muted">
                正在学习（已选 {learningClean.length}）
              </p>
              <div data-testid="learning-languages" className="flex flex-wrap gap-1.5">
                {languages
                  .filter((item) => item.code !== nativeCode)
                  .map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => setLearning((current) => toggle(current, item.code))}
                      aria-pressed={learning.includes(item.code)}
                      className={cn(
                        "min-h-[2.25rem] rounded-full border border-line px-3 py-1.5 text-[12px]",
                        learning.includes(item.code) && "border-[#8B6CFF] bg-[#F4F1FF] font-medium",
                      )}
                    >
                      {item.nativeName ?? item.name}
                    </button>
                  ))}
              </div>
              <p className="mt-3 text-[11px] leading-4 text-muted">
                母语：{nativeCode ? languageName(nativeCode) : "未选"}；学习中：
                {learningClean.length > 0 ? learningClean.map(languageName).join("、") : "暂无"}
              </p>
              <SmallButton
                variant="gradient"
                className="mt-4 w-full"
                onClick={() => void saveLanguages()}
                disabled={saving !== null}
                ariaLabel="保存语言"
              >
                {saving === "languages" ? "保存中…" : "保存语言"}
              </SmallButton>
            </section>

            <section className="mt-5 rounded-3xl border border-line bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold">兴趣</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted">
                    至少 {INTEREST_MIN} 个，最多 {INTEREST_MAX} 个。
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[#F1F3FF] px-2.5 py-1 text-[11px] text-[#6572D8]">
                  {interestSlugs.length} / {INTEREST_MAX}
                </span>
              </div>

              {interestSlugs.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5 rounded-2xl bg-[#F7F9FF] p-2.5">
                  {interestSlugs.map((slug) => {
                    const found = interests.find((item) => item.slug === slug);
                    return (
                      <button
                        key={slug}
                        type="button"
                        onClick={() => setInterestSlugs((current) => toggle(current, slug))}
                        aria-label={`移除 ${found?.nameZh ?? found?.name ?? slug}`}
                        className="rounded-full bg-white px-3 py-1.5 text-[11px] text-[#6572D8] shadow-sm"
                      >
                        {found?.nameZh ?? found?.name ?? slug} ✕
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索兴趣，如 游戏、音乐、旅行"
                aria-label="搜索兴趣"
                className="mt-3 h-11 w-full min-w-0 rounded-2xl border border-line bg-[#F8FAFF] px-3 text-[13px] outline-none focus:ring-2 focus:ring-indigo-200"
              />

              {interestCategories.length === 0 ? (
                <p className="mt-3 text-[12px] text-muted">没有匹配的兴趣，换个关键词试试。</p>
              ) : (
                interestCategories.map((category) => (
                  <div key={category} className="mt-4">
                    <p className="mb-2 text-[11px] font-medium text-muted">{category}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {filteredInterests
                        .filter((item) => item.category === category)
                        .map((item) => {
                          const active = interestSlugs.includes(item.slug);
                          return (
                            <button
                              key={item.slug}
                              type="button"
                              onClick={() =>
                                setInterestSlugs((current) => {
                                  if (current.includes(item.slug)) {
                                    return current.filter((slug) => slug !== item.slug);
                                  }
                                  if (current.length >= INTEREST_MAX) return current;
                                  return [...current, item.slug];
                                })
                              }
                              aria-pressed={active}
                              className={cn(
                                "min-h-[2.25rem] rounded-full border border-line px-3 py-1.5 text-[12px]",
                                active && "border-transparent tf-gradient font-medium text-white",
                              )}
                            >
                              {item.nameZh ?? item.name}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                ))
              )}

              {interestSlugs.length >= INTEREST_MAX ? (
                <p className="mt-3 text-[11px] text-[#B26A00]">已达上限 {INTEREST_MAX} 个，请先移除再添加。</p>
              ) : null}

              <SmallButton
                variant="gradient"
                className="mt-4 w-full"
                onClick={() => void saveInterests()}
                disabled={saving !== null}
                ariaLabel="保存兴趣"
              >
                {saving === "interests" ? "保存中…" : "保存兴趣"}
              </SmallButton>
            </section>

            <section className="mt-5 rounded-3xl border border-line bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold">交友目的</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted">
                    你希望在这段关系里得到什么，至少 1 个，最多 {PURPOSE_MAX} 个。
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[#F1F3FF] px-2.5 py-1 text-[11px] text-[#6572D8]">
                  {purposeSlugs.length} / {PURPOSE_MAX}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {purposes.map((item) => {
                  const active = purposeSlugs.includes(item.slug);
                  return (
                    <button
                      key={item.slug}
                      type="button"
                      onClick={() =>
                        setPurposeSlugs((current) => {
                          if (current.includes(item.slug)) {
                            return current.filter((slug) => slug !== item.slug);
                          }
                          if (current.length >= PURPOSE_MAX) return current;
                          return [...current, item.slug];
                        })
                      }
                      aria-pressed={active}
                      className={cn(
                        "min-h-[2.25rem] rounded-full border border-line px-3 py-1.5 text-[12px]",
                        active && "border-transparent tf-gradient font-medium text-white",
                      )}
                    >
                      {item.nameZh ?? item.name}
                    </button>
                  );
                })}
              </div>
              <SmallButton
                variant="gradient"
                className="mt-4 w-full"
                onClick={() => void savePurposes()}
                disabled={saving !== null}
                ariaLabel="保存交友目的"
              >
                {saving === "purposes" ? "保存中…" : "保存交友目的"}
              </SmallButton>
            </section>

            <section className="mt-5 rounded-3xl border border-line bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold">想认识的国家/地区</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-muted">
                    可留空，最多 {COUNTRY_MAX} 个。
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[#F1F3FF] px-2.5 py-1 text-[11px] text-[#6572D8]">
                  {countryCodes.length} / {COUNTRY_MAX}
                </span>
              </div>
              <div
                data-testid="country-options"
                className="tf-scroll mt-3 grid max-h-64 grid-cols-2 gap-1.5 overflow-y-auto"
              >
                {countries.map((item) => {
                  const active = countryCodes.includes(item.code);
                  return (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() =>
                        setCountryCodes((current) => {
                          if (current.includes(item.code)) {
                            return current.filter((code) => code !== item.code);
                          }
                          if (current.length >= COUNTRY_MAX) return current;
                          return [...current, item.code];
                        })
                      }
                      aria-pressed={active}
                      className={cn(
                        "min-h-[2.25rem] truncate rounded-full border border-line px-3 py-1.5 text-[12px]",
                        active && "border-transparent tf-gradient font-medium text-white",
                      )}
                    >
                      {item.flag ?? ""} {item.name}
                    </button>
                  );
                })}
              </div>
              <SmallButton
                variant="gradient"
                className="mt-4 w-full"
                onClick={() => void saveCountries()}
                disabled={saving !== null}
                ariaLabel="保存想认识的国家地区"
              >
                {saving === "countries" ? "保存中…" : "保存国家/地区"}
              </SmallButton>
            </section>
          </>
        ) : null}

        {notice ? <p className="mt-4 text-center text-[12px] text-emerald-600">{notice}</p> : null}

        <div className="mb-1 mt-6">
          <OutlineButton href="/me" className="min-h-[2.75rem] w-full text-[13px]">
            返回我的
          </OutlineButton>
        </div>
      </div>
    </PhoneShell>
  );
}
