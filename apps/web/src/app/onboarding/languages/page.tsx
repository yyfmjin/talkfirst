"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PhoneShell } from "@/components/phone-shell";
import { ScreenHeader } from "@/components/screen-header";
import { GradientButton } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/cn";

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
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-2">
        <p className="text-[13px] text-muted">语言互补是推荐的核心，先告诉我们你的语言。</p>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="搜索语言 / code，如 中文、en"
          aria-label="搜索语言"
          className="mt-4 h-11 w-full min-w-0 rounded-xl border border-line bg-[#F8FAFF] px-3 text-[13px] outline-none focus:ring-2 focus:ring-indigo-200"
        />
        {fetching ? (
          <div className="mt-5 animate-pulse space-y-3">
            <div className="h-16 rounded-2xl bg-indigo-50" />
            <div className="h-24 rounded-2xl bg-indigo-50" />
          </div>
        ) : (
          <>
            <div className="mt-5">
              <p className="mb-2 text-[13px] text-muted">母语（单选）</p>
              <div className="flex flex-wrap gap-2">
                {filtered.slice(0, 20).map((item) => (
                  <button
                    key={item.code}
                    onClick={() => {
                      setNative(item.code);
                      setLearning((current) => current.filter((code) => code !== item.code));
                    }}
                    className={cn(
                      "min-h-[2.25rem] rounded-full border border-line px-4 py-1.5 text-[13px]",
                      native === item.code && "border-transparent tf-gradient text-white",
                    )}
                  >
                    {item.nativeName ?? item.name}
                  </button>
                ))}
              </div>
              {filtered.length === 0 ? (
                <p className="mt-2 text-[12px] text-muted">没有匹配的语言，换个关键词试试。</p>
              ) : null}
            </div>
            <div className="mt-6">
              <p className="mb-2 text-[13px] text-muted">
                正在学习（可多选，已选 {learning.filter((code) => code !== native).length}）
              </p>
              <div className="flex flex-wrap gap-2">
                {filtered.map((item) => {
                  if (item.code === native) return null;
                  const active = learning.includes(item.code);
                  return (
                    <button
                      key={item.code}
                      onClick={() => toggleLearning(item.code)}
                      className={cn(
                        "min-h-[2.25rem] rounded-full border border-line px-4 py-1.5 text-[13px]",
                        active && "border-[#8B6CFF] bg-[#F4F1FF] font-medium",
                      )}
                    >
                      {item.nativeName ?? item.name}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-[12px] text-muted">
                母语：{native ? nameOf(native) : "未选"}；学习中：
                {learning.length > 0 ? learning.map(nameOf).join("、") : "暂无"}
              </p>
            </div>
          </>
        )}
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
