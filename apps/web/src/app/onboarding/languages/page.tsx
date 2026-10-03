"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { TFChip, TFRowSkeleton, TFSearch, TFButton, TFLoadingRegion } from "@/components/tf";
import { apiFetch } from "@/lib/api";

type Language = { code: string; name: string; nativeName: string | null };
type MeResponse = {
  languages?: Array<{ code: string; type: string; level?: string }>;
};

export default function LanguagesPage() {
  const router = useRouter();
  const [languages, setLanguages] = useState<Language[]>([]);
  const [native, setNative] = useState("");
  const [learning, setLearning] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        const [meta, me] = await Promise.all([
          apiFetch<Language[]>("/meta/languages"),
          apiFetch<MeResponse>("/users/me").catch(() => null),
        ]);
        setLanguages(meta);
        const existing = me?.languages ?? [];
        const existingNative = existing.find((item) => item.type === "NATIVE")?.code;
        const existingLearning = existing.filter((item) => item.type === "LEARNING").map((item) => item.code);
        if (existingNative) setNative(existingNative);
        else if (meta.some((item) => item.code === "zh")) setNative("zh");
        else if (meta.length > 0) setNative(meta[0].code);
        if (existingLearning.length > 0) setLearning(existingLearning);
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
    if (!keyword) return languages;
    return languages.filter((item) =>
      `${item.code} ${item.name} ${item.nativeName ?? ""}`.toLowerCase().includes(keyword),
    );
  }, [languages, search]);

  function nameOf(code: string) {
    const found = languages.find((item) => item.code === code);
    return found ? (found.nativeName ?? found.name) : code;
  }

  function toggleLearning(code: string) {
    if (code === native) return;
    setLearning((current) =>
      current.includes(code) ? current.filter((value) => value !== code) : [...current, code],
    );
  }

  async function handleNext() {
    if (!native) {
      setError("请选择母语。");
      return;
    }
    const cleanLearning = learning.filter((code) => code !== native);
    if (cleanLearning.length === 0) {
      setError("请至少选择 1 门正在学习的语言。");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await apiFetch("/users/me/languages", {
        method: "PUT",
        body: {
          items: [
            { code: native, type: "NATIVE", level: "NATIVE" },
            ...cleanLearning.map((code) => ({ code, type: "LEARNING", level: "INTERMEDIATE" })),
          ],
        },
      });
      router.push("/onboarding/purposes");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存失败，请稍后再试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PhoneShell>
      <ScreenHeader title="语言设置" backHref="/onboarding/interests" />
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-2">
        <p className="text-ui leading-6 text-content-muted">语言互补是推荐的核心，先告诉我们你的语言。</p>
        <TFSearch
          className="mt-4"
          label="搜索语言"
          placeholder="搜索语言或代码，如 中文、en"
          value={search}
          onValueChange={setSearch}
          onClear={() => setSearch("")}
        />
        {fetching ? (
          <TFLoadingRegion label="正在加载语言列表">
            <div className="mt-5 space-y-3">
              <TFRowSkeleton />
              <TFRowSkeleton />
            </div>
          </TFLoadingRegion>
        ) : (
          <>
            <fieldset className="mt-5">
              <legend className="mb-2 text-caption font-medium text-content-muted">母语（单选）</legend>
              <div className="flex flex-wrap gap-2">
                {filtered.slice(0, 20).map((item) => (
                  <TFChip
                    key={item.code}
                    selected={native === item.code}
                    onClick={() => {
                      setNative(item.code);
                      setLearning((current) => current.filter((code) => code !== item.code));
                    }}
                  >
                    {item.nativeName ?? item.name}
                  </TFChip>
                ))}
              </div>
              {filtered.length === 0 ? (
                <p className="mt-2 text-caption text-content-muted">没有匹配的语言，换个关键词试试。</p>
              ) : null}
            </fieldset>

            <fieldset className="mt-6">
              <legend className="mb-2 text-caption font-medium text-content-muted">
                正在学习（可多选，已选 {learning.filter((code) => code !== native).length}）
              </legend>
              <div className="flex flex-wrap gap-2">
                {filtered.map((item) => {
                  // The native language cannot also be a language you are learning.
                  if (item.code === native) return null;
                  return (
                    <TFChip
                      key={item.code}
                      selected={learning.includes(item.code)}
                      onClick={() => toggleLearning(item.code)}
                    >
                      {item.nativeName ?? item.name}
                    </TFChip>
                  );
                })}
              </div>
              <p className="mt-3 text-caption leading-5 text-content-muted">
                母语：{native ? nameOf(native) : "未选"}；学习中：
                {learning.length > 0 ? learning.map(nameOf).join("、") : "暂无"}
              </p>
            </fieldset>
          </>
        )}
        {error ? (
          <p className="mt-4 break-words text-caption text-danger-600" role="alert">
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
            下一步
          </TFButton>
        </div>
      </div>
    </PhoneShell>
  );
}
