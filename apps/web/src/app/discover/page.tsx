"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PhoneShell } from "@/components/phone-shell";
import { TabBar } from "@/components/tab-bar";
import { SmallButton } from "@/components/ui";
import { apiFetch } from "@/lib/api";
import { AdminEntry } from "@/components/admin-entry";
import { ProfilePreviewCard } from "@/components/profile-preview-card";
import { cn } from "@/lib/cn";

type Recommendation = {
  id: string;
  nickname: string | null;
  avatarUrl: string | null;
  countryCode: string | null;
  countryName: string | null;
  countryFlag: string | null;
  age: number | null;
  bio: string | null;
  languages: Array<{ code: string; name: string; nativeName: string | null; type: string; level: string }>;
  interests: Array<{ slug: string; name: string; nameZh: string | null }>;
  purposes: Array<{ slug: string; name: string; nameZh: string | null }>;
  matchScore: number;
  matchReasons: string[];
};

type RecommendationResponse = {
  items: Recommendation[];
  limit: number;
  used: number;
  remaining: number;
  filter?: string;
};

type HelloTemplate = { id: string; label: string; category: string };

const FILTERS = [
  { id: "all", label: "🌎 Everyone" },
  { id: "language", label: "Language exchange" },
  { id: "gaming", label: "Gaming" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

const FILTER_STORAGE_KEY = "talkfirst.discover.filter";
const DAILY_LIMIT = 20;

export default function DiscoverPage() {
  const [filter, setFilter] = useState<FilterId>("all");
  const [items, setItems] = useState<Recommendation[]>([]);
  const [remaining, setRemaining] = useState(DAILY_LIMIT);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [helloSent, setHelloSent] = useState<string[]>([]);
  const [helloOpen, setHelloOpen] = useState(false);
  const [helloTarget, setHelloTarget] = useState<Recommendation | null>(null);
  const [templates, setTemplates] = useState<HelloTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("language");
  const [customMessage, setCustomMessage] = useState("");
  const [helloError, setHelloError] = useState("");
  const [helloSending, setHelloSending] = useState(false);
  // PC-1.4 §17: the avatar and the nickname open the shared profile card.
  const [previewUserId, setPreviewUserId] = useState<string | null>(null);

  const loadRecommendations = useCallback(async (nextFilter: FilterId, initial = false) => {
    if (initial) setLoading(true);
    else setSwitching(true);
    setError("");
    try {
      const data = await apiFetch<RecommendationResponse>(
        `/discover/recommendations?limit=20&filter=${nextFilter}`,
      );
      setItems(data.items);
      setRemaining(data.remaining);
      setActiveIndex(0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "推荐加载失败，请稍后再试");
    } finally {
      setLoading(false);
      setSwitching(false);
    }
  }, []);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const loaded = await apiFetch<HelloTemplate[]>("/connections/templates");
      setTemplates(loaded);
    } catch {
      setTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(FILTER_STORAGE_KEY);
    const initialFilter: FilterId =
      stored === "language" || stored === "gaming" ? (stored as FilterId) : "all";
    setFilter(initialFilter);
    void loadRecommendations(initialFilter, true);
    void loadTemplates();
  }, [loadRecommendations, loadTemplates]);

  function changeFilter(next: FilterId) {
    if (next === filter || switching) return;
    setFilter(next);
    setSkipped(0);
    window.localStorage.setItem(FILTER_STORAGE_KEY, next);
    void loadRecommendations(next);
  }

  function openHello(item: Recommendation) {
    setHelloTarget(item);
    setCustomMessage("");
    setHelloError("");
    const preferred = filter === "gaming" ? "gaming" : "language";
    if (templates.some((template) => template.id === preferred)) {
      setSelectedTemplate(preferred);
    } else if (templates.length > 0) {
      setSelectedTemplate(templates[0].id);
    }
    setHelloOpen(true);
  }

  async function submitHello() {
    if (!helloTarget || helloSending) return;
    const template = templates.find((item) => item.id === selectedTemplate);
    const message =
      selectedTemplate === "custom"
        ? customMessage.trim().slice(0, 200)
        : (template?.label ?? "").slice(0, 200);
    if (!template && selectedTemplate !== "custom") {
      setHelloError("模板加载失败，请重试。");
      return;
    }
    if (selectedTemplate === "custom" && message.length === 0) {
      setHelloError("请填写你的破冰消息。");
      return;
    }
    setHelloSending(true);
    setHelloError("");
    try {
      await apiFetch("/connections/requests", {
        method: "POST",
        body: {
          receiverId: helloTarget.id,
          message,
          templateId: selectedTemplate,
        },
      });
      await apiFetch(`/discover/views/${helloTarget.id}`, { method: "POST" }).catch(() => undefined);
      setHelloSent((current) =>
        current.includes(helloTarget.id) ? current : [...current, helloTarget.id],
      );
      setHelloOpen(false);
      setRemaining((value) => Math.max(0, value - 1));
      setActiveIndex((index) => index + 1);
    } catch (requestError) {
      setHelloError(requestError instanceof Error ? requestError.message : "发送失败，请稍后再试");
    } finally {
      setHelloSending(false);
    }
  }

  function nextCard() {
    setSkipped((value) => value + 1);
    setActiveIndex((index) => Math.min(index + 1, items.length));
  }

  function prevCard() {
    setActiveIndex((index) => Math.max(0, index - 1));
    setSkipped((value) => Math.max(0, value - 1));
  }

  const current = items[activeIndex];
  const seen = helloSent.length + skipped;
  const progressPercent = Math.min(100, Math.round(((DAILY_LIMIT - remaining) / DAILY_LIMIT) * 100));
  const groupedTemplates = useMemo(() => {
    const groups = new Map<string, HelloTemplate[]>();
    for (const template of templates) {
      const list = groups.get(template.category) ?? [];
      list.push(template);
      groups.set(template.category, list);
    }
    return [...groups.entries()];
  }, [templates]);

  return (
    <PhoneShell>
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[22px] font-semibold">Discover</h1>
            <p className="mt-1 text-[13px] text-muted">先聊聊，再成为朋友。</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <span className="rounded-full bg-indigo-50 px-3 py-1.5 text-[11px] font-medium text-[#6B7CFF]">
              今日剩余 {remaining}
            </span>
            <AdminEntry />
          </div>
        </div>

        <div className="mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-indigo-100">
            <div
              className="tf-gradient h-full rounded-full transition-all"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="mt-1.5 text-center text-[11px] text-muted">
            今日已看 {Math.min(DAILY_LIMIT - remaining, DAILY_LIMIT)}/{DAILY_LIMIT}
            {helloSent.length > 0 ? ` · 已 Say Hello ${helloSent.length}` : ""}
          </p>
        </div>

        <div className="tf-scroll-x mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="推荐筛选">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={filter === item.id}
              disabled={switching}
              onClick={() => changeFilter(item.id)}
              className={cn(
                "min-h-[2.25rem] shrink-0 rounded-full border px-4 py-1.5 text-[12px] transition disabled:opacity-60",
                filter === item.id ? "border-transparent tf-gradient font-medium text-white" : "border-line text-muted",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted">
          {filter === "language"
            ? "只看想语言交换的人，破冰默认选中语言模板。"
            : filter === "gaming"
              ? "只看有游戏兴趣的人，破冰默认选中游戏模板。"
              : "按语言互补、共同兴趣和活跃度综合排序。"}
        </p>

        {loading ? <DiscoverSkeleton /> : null}
        {!loading && error ? (
          <div className="mt-8 rounded-3xl border border-red-100 bg-red-50 p-6 text-center">
            <p className="text-[14px] font-medium text-red-700">推荐暂时不可用</p>
            <p className="mt-2 text-[12px] leading-5 text-red-600">{error}</p>
            <SmallButton variant="gradient" className="mt-5 w-full" onClick={() => void loadRecommendations(filter)}>
              重试
            </SmallButton>
          </div>
        ) : null}
        {!loading && !error && switching ? <DiscoverSkeleton /> : null}
        {!loading && !error && !switching && !current ? (
          <DiscoverEmpty
            filter={filter}
            remaining={remaining}
            onRetry={() => void loadRecommendations(filter)}
            onReset={() => changeFilter("all")}
          />
        ) : null}
        {!loading && !error && !switching && current ? (
          <RecommendationCard
            item={current}
            sent={helloSent.includes(current.id)}
            onHello={() => openHello(current)}
            onProfile={() => setPreviewUserId(current.id)}
            onSkip={nextCard}
            onBack={activeIndex > 0 ? prevCard : undefined}
          />
        ) : null}
        {!loading && !error && !switching && current ? (
          <Link
            href={`/moments/user/${current.id}`}
            className="mt-3 flex items-center justify-between rounded-3xl border border-indigo-100 bg-[#F7F9FF] px-4 py-3 text-[12px] text-[#6572D8]"
          >
            <span>查看 TA 的个人动态，了解真实生活</span>
            <span>→</span>
          </Link>
        ) : null}
        {!loading && !error && items.length > 0 ? (
          <div className="mt-4 flex items-center justify-center gap-1.5">
            {activeIndex > 0 ? (
              <SmallButton size="sm" className="mr-2 h-7 px-3 text-[11px]" onClick={prevCard}>
                ← 上一位
              </SmallButton>
            ) : null}
            {items.slice(0, Math.min(items.length, 5)).map((item, index) => (
              <span
                key={item.id}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  index === activeIndex ? "w-5 bg-indigo-500" : "w-1.5 bg-indigo-100",
                )}
              />
            ))}
            {seen > 0 ? (
              <span className="ml-2 text-[11px] text-muted">已看 {Math.min(seen, items.length)}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {helloOpen && helloTarget ? (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-black/40" role="dialog" aria-modal="true">
          <div className="tf-scroll max-h-[85%] w-full overflow-y-auto rounded-t-[28px] bg-white p-6 pb-[calc(2rem+env(safe-area-inset-bottom))]">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-[16px] font-semibold">Say Hello</h2>
                <p className="mt-1 text-[12px] text-muted">
                  向 {helloTarget.nickname ?? "对方"} 发送认识请求，选择一个破冰方式。
                </p>
              </div>
              <SmallButton size="sm" className="h-8 shrink-0 px-3 text-[11px]" onClick={() => setHelloOpen(false)}>
                关闭
              </SmallButton>
            </div>
            {templatesLoading ? (
              <div className="mt-4 animate-pulse space-y-2">
                <div className="h-12 rounded-2xl bg-indigo-50" />
                <div className="h-12 rounded-2xl bg-indigo-50" />
                <div className="h-12 rounded-2xl bg-indigo-50" />
              </div>
            ) : templates.length === 0 ? (
              <div className="mt-4 rounded-2xl bg-red-50 p-4 text-center">
                <p className="text-[13px] text-red-700">破冰模板加载失败</p>
                <SmallButton className="mt-3" onClick={() => void loadTemplates()}>
                  重新加载
                </SmallButton>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {groupedTemplates.map(([category, list]) => (
                  <div key={category}>
                    <p className="mb-2 text-[11px] font-medium text-muted">{category}</p>
                    <div className="space-y-2">
                      {list.map((template) => (
                        <button
                          key={template.id}
                          onClick={() => setSelectedTemplate(template.id)}
                          aria-pressed={selectedTemplate === template.id}
                          className={cn(
                            "w-full rounded-2xl border px-4 py-3 text-left text-[13px] transition",
                            selectedTemplate === template.id
                              ? "border-[#8B6CFF] bg-[#F4F1FF] font-medium"
                              : "border-line",
                          )}
                        >
                          {template.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {selectedTemplate === "custom" && templates.length > 0 ? (
              <div>
                <textarea
                  value={customMessage}
                  onChange={(event) => setCustomMessage(event.target.value)}
                  maxLength={200}
                  rows={3}
                  placeholder="写下你想说的话（最多 200 字）"
                  className="mt-3 w-full rounded-2xl border border-line bg-[#F8FAFF] p-4 text-[13px] outline-none focus:ring-2 focus:ring-indigo-200"
                />
                <p className="mt-1 text-right text-[11px] text-muted">{customMessage.length}/200</p>
              </div>
            ) : null}
            {helloError ? <p className="mt-3 text-[12px] text-red-500">{helloError}</p> : null}
            <div className="mt-5 flex gap-2">
              <SmallButton className="flex-1" onClick={() => setHelloOpen(false)}>
                取消
              </SmallButton>
              <SmallButton
                variant="gradient"
                className="flex-[2]"
                onClick={() => void submitHello()}
                disabled={helloSending || templatesLoading || templates.length === 0}
              >
                {helloSending ? "发送中…" : "发送请求"}
              </SmallButton>
            </div>
          </div>
        </div>
      ) : null}
      <ProfilePreviewCard userId={previewUserId} onClose={() => setPreviewUserId(null)} />
      <TabBar active="/discover" />
    </PhoneShell>
  );
}

function RecommendationCard({
  item,
  sent,
  onHello,
  onProfile,
  onSkip,
  onBack,
}: {
  item: Recommendation;
  sent: boolean;
  onHello: () => void;
  onProfile: () => void;
  onSkip: () => void;
  onBack?: () => void;
}) {
  return (
    <article className="mt-6 overflow-hidden rounded-[28px] border border-indigo-100 bg-white shadow-[0_16px_40px_rgba(87,103,180,0.12)]">
      <div className="relative flex h-48 items-center justify-center bg-gradient-to-br from-[#DCE6FF] via-[#EEF1FF] to-[#FBE7F1]">
        <button
          type="button"
          onClick={onProfile}
          aria-label={`查看 ${item.nickname ?? "用户"} 的资料卡`}
          className="shrink-0 rounded-full"
        >
          {item.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.avatarUrl}
              alt={`${item.nickname ?? "用户"} 的头像`}
              className="h-28 w-28 rounded-full object-cover shadow-xl"
            />
          ) : (
            <div className="tf-gradient grid h-28 w-28 place-items-center rounded-full text-4xl font-semibold text-white shadow-xl shadow-indigo-200">
              {(item.nickname ?? "?").slice(0, 1).toUpperCase()}
            </div>
          )}
        </button>
        <span className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1 text-[12px] font-semibold text-[#6B7CFF]">
          {item.matchScore}% match
        </span>
        {onBack ? (
          <button
            onClick={onBack}
            aria-label="上一位"
            className="absolute left-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-[15px] text-[#6B7CFF]"
          >
            ←
          </button>
        ) : null}
      </div>
      <div className="p-5">
        <div className="flex items-center justify-between">
          <button type="button" onClick={onProfile} className="min-w-0 text-left">
            <h2 className="text-[20px] font-semibold">
              {item.nickname ?? "TalkFirst 用户"} {item.countryFlag ?? "🌎"}
            </h2>
          </button>
          {item.age ? <span className="text-[13px] text-muted">{item.age} 岁</span> : null}
        </div>
        <p className="mt-1 text-[12px] text-muted">{item.countryName ?? item.countryCode ?? "全球"}</p>
        {item.bio ? <p className="mt-3 tf-clamp-2 text-[13px] leading-5 text-muted">{item.bio}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {item.interests.slice(0, 4).map((interest) => (
            <span key={interest.slug} className="rounded-full bg-[#F1F3FF] px-3 py-1.5 text-[12px] text-[#6572D8]">
              {interest.nameZh ?? interest.name}
            </span>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
          {item.languages.slice(0, 3).map((language) => (
            <span key={`${language.code}-${language.type}`}>
              {language.nativeName ?? language.name}
              <span className="ml-1 text-[10px]">
                {language.type === "NATIVE" ? "母语" : "学习中"}
              </span>
            </span>
          ))}
        </div>
        {item.matchReasons.length > 0 ? (
          <p className="mt-4 rounded-2xl bg-[#F8F9FF] px-3 py-2 text-[11px] leading-5 text-[#6975D2]">
            {item.matchReasons.join(" · ")}
          </p>
        ) : null}
        <div className="mt-4 flex items-center gap-2">
          <SmallButton
            size="sm"
            className="w-[3.25rem] shrink-0 px-0 text-[12px]"
            onClick={onSkip}
            ariaLabel="跳过此推荐"
          >
            跳过
          </SmallButton>
          <SmallButton
            size="sm"
            variant="gradient"
            className="min-w-0 flex-1 px-4 text-[13px]"
            onClick={onHello}
            disabled={sent}
          >
            {sent ? "已 Say Hello" : "Say Hello"}
          </SmallButton>
        </div>
      </div>
    </article>
  );
}

function DiscoverSkeleton() {
  return (
    <div className="mt-6 animate-pulse overflow-hidden rounded-[28px] border border-line">
      <div className="h-48 bg-indigo-50" />
      <div className="space-y-3 p-5">
        <div className="h-5 w-2/3 rounded bg-indigo-50" />
        <div className="h-3 w-1/3 rounded bg-indigo-50" />
        <div className="h-9 rounded-2xl bg-indigo-50" />
        <div className="h-9 rounded-full bg-indigo-50" />
      </div>
    </div>
  );
}

function DiscoverEmpty({
  filter,
  remaining,
  onRetry,
  onReset,
}: {
  filter: FilterId;
  remaining: number;
  onRetry: () => void;
  onReset: () => void;
}) {
  return (
    <div className="mt-8 rounded-3xl border border-dashed border-indigo-200 bg-[#F7F9FF] p-6 text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-indigo-100 text-2xl">🌎</div>
      <p className="mt-4 text-[15px] font-medium">
        {remaining === 0 ? "今天的推荐看完啦" : filter === "all" ? "暂时没有合适的人" : "这个筛选下暂时没有合适的人"}
      </p>
      <p className="mt-2 text-[13px] leading-6 text-muted">
        {remaining === 0
          ? "明天再来看看，认真认识一个人。"
          : filter === "all"
            ? "完善语言、兴趣和目的后，会得到更好的推荐。"
            : "换个筛选看看，或完善语言和兴趣后会有更多匹配。"}
      </p>
      <div className="mt-5 flex gap-2">
        {filter !== "all" ? (
          <SmallButton className="flex-1" onClick={onReset}>
            看全部
          </SmallButton>
        ) : null}
        {remaining > 0 ? (
          <SmallButton variant="gradient" className="flex-1" onClick={onRetry}>
            重新加载
          </SmallButton>
        ) : null}
      </div>
    </div>
  );
}
