"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, BadgeCheck, Heart, MessageCircle, Share2 } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { TabBar } from "@/components/tab-bar";
import { GradientButton, OutlineButton } from "@/components/ui";
import { ProfilePreviewCard } from "@/components/profile-preview-card";
import { apiFetch } from "@/lib/api";
import { formatCount, relativeTime } from "@/lib/moments";

type Comment = {
  id: string;
  content: string;
  createdAt: string;
  user: { id: string; nickname: string | null; avatarUrl: string | null };
};

type Detail = {
  author: { id: string; nickname: string | null; avatarUrl: string | null; countryCode: string | null; bio: string | null };
  setting: { visibleTo: string };
  bindings: Array<{ platform: string; handle: string; displayName: string | null; syncEnabled: boolean }>;
  items: Array<{
    id: string;
    userId: string;
    platform: string;
    platformName: string | null;
    content: string;
    images: string[];
    videoUrl: string | null;
    durationSec: number | null;
    tags: string[];
    likeCount: number;
    commentCount: number;
    liked: boolean;
    source?: "USER" | "DEMO";
    isDemo?: boolean;
    createdAt: string;
  }>;
  locked: boolean;
};

export default function UserMomentsPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [data, setData] = useState<Detail | null>(null);
  const [platform, setPlatform] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [commenting, setCommenting] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [draft, setDraft] = useState("");
  const [sharing, setSharing] = useState(false);
  const [previewUserId, setPreviewUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      const result = await apiFetch<Detail>(`/moments/user/${id}${platform ? `?platform=${platform}` : ""}`);
      setData(result);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [id, platform]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleLike(momentId: string) {
    try {
      const result = await apiFetch<{ liked: boolean }>(`/moments/${momentId}/like`, { method: "POST" });
      setData((current) =>
        current
          ? {
              ...current,
              items: current.items.map((item) =>
                item.id === momentId
                  ? { ...item, liked: result.liked, likeCount: Math.max(0, item.likeCount + (result.liked ? 1 : -1)) }
                  : item,
              ),
            }
          : current,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "点赞失败");
    }
  }

  async function toggleComments(momentId: string) {
    if (commenting === momentId) {
      setCommenting(null);
      return;
    }
    setCommenting(momentId);
    if (!comments[momentId]) {
      try {
        // PC-2.4 — GET comments 回答的是分页对象：这里只读首页，卡片不提供加载更多也不提供删除。
        const data = await apiFetch<{ items: Comment[] }>(`/moments/${momentId}/comments`);
        setComments((current) => ({ ...current, [momentId]: data.items }));
      } catch {
        setComments((current) => ({ ...current, [momentId]: [] }));
      }
    }
  }

  async function addComment(momentId: string) {
    const content = draft.trim();
    if (!content) return;
    try {
      const comment = await apiFetch<Comment>(`/moments/${momentId}/comments`, { method: "POST", body: { content } });
      setComments((current) => ({ ...current, [momentId]: [...(current[momentId] ?? []), comment] }));
      setData((current) =>
        current
          ? { ...current, items: current.items.map((item) => (item.id === momentId ? { ...item, commentCount: item.commentCount + 1 } : item)) }
          : current,
      );
      setDraft("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "评论失败");
    }
  }

  async function shareProfile() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: "TalkFirst 个人动态", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setSharing(true);
      setTimeout(() => setSharing(false), 1800);
    } catch {
      // cancelled
    }
  }

  return (
    <PhoneShell>
      <div className="z-10 grid shrink-0 grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-line/70 bg-white/95 px-3 py-2">
        <Link href="/moments" aria-label="返回动态" className="grid h-9 w-9 place-items-center rounded-full bg-[#F1F3FF]">
          <ArrowLeft size={16} />
        </Link>
        <p className="min-w-0 truncate text-center text-[15px] font-semibold">{data?.author.nickname ?? "个人动态"}</p>
        <button onClick={() => void shareProfile()} aria-label="分享主页" className="grid h-9 w-9 place-items-center rounded-full bg-[#F1F3FF] text-[#6572D8]">
          <Share2 size={15} />
        </button>
      </div>

      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-28 rounded-3xl bg-indigo-50" />
            <div className="h-64 rounded-3xl bg-indigo-50" />
          </div>
        ) : null}
        {error ? (
          <div className="rounded-2xl bg-red-50 p-4 text-[12px] text-red-600">
            {error}
            <OutlineButton className="mt-3 min-h-[2.5rem] w-full text-[12px]" onClick={() => void load()}>
              重试
            </OutlineButton>
          </div>
        ) : null}

        {data ? (
          <>
            <section className="overflow-hidden rounded-3xl border border-line bg-white">
              <div className="tf-gradient-soft h-20" />
              <div className="-mt-8 px-4 pb-4">
                <div className="flex items-end justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewUserId(id ?? null)}
                    aria-label={`查看 ${data.author.nickname ?? "用户"} 的资料卡`}
                    className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-full border-4 border-white bg-gradient-to-br from-[#7B86FF] to-[#A47BFF] text-xl font-semibold text-white shadow"
                  >
                    {data.author.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={data.author.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      (data.author.nickname ?? "?").slice(0, 1).toUpperCase()
                    )}
                  </button>
                  <span className="mb-1 shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] text-emerald-600">
                    {data.items.length} 条动态
                  </span>
                </div>
                <p className="mt-2 flex items-center gap-1 text-[16px] font-semibold">
                  <button
                    type="button"
                    onClick={() => setPreviewUserId(id ?? null)}
                    className="min-w-0 flex-1 truncate text-left"
                  >
                    {data.author.nickname ?? "TalkFirst 用户"}
                  </button>
                  <BadgeCheck size={15} className="shrink-0 text-[#6572D8]" />
                </p>
                <p className="mt-0.5 break-words text-[12px] text-muted">
                  {data.author.countryCode ?? "全球"} · {data.author.bio ?? "查看用户在其他社交平台的最新动态，了解对方的真实生活"}
                </p>
                {sharing ? <p className="mt-1 text-[11px] text-emerald-600">链接已复制</p> : null}
              </div>
            </section>

            <div className="tf-scroll-x mt-4 flex gap-2 overflow-x-auto pb-1">
              <FilterPill active={!platform} label={`全部 ${data.items.length}`} onClick={() => setPlatform("")} />
              {data.bindings.map((binding) => {
                const count = data.items.filter((item) => item.platform === binding.platform).length;
                return (
                  <FilterPill
                    key={binding.platform}
                    active={platform === binding.platform}
                    label={`@${binding.handle} · ${count}`}
                    onClick={() => setPlatform(platform === binding.platform ? "" : binding.platform)}
                  />
                );
              })}
            </div>

            {data.locked ? (
              <div className="mt-4 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-center">
                <p className="text-[13px] font-medium text-amber-800">对方设置了动态可见范围</p>
                <p className="mt-1 text-[12px] text-amber-700">成为连接后才能查看完整动态。</p>
                <GradientButton href="/discover" className="mt-4 min-h-[2.75rem] text-[12px]">
                  去认识更多朋友
                </GradientButton>
              </div>
            ) : null}

            <div className="mt-4 space-y-4">
              {data.items.map((item) => (
                <article key={item.id} className="overflow-hidden rounded-3xl border border-line bg-white">
                  <p className="flex items-center gap-2 px-4 pt-4 text-[11px] text-muted">
                    <span>
                      {item.platformName ?? item.platform} · {relativeTime(item.createdAt)}
                    </span>
                    {item.isDemo ? (
                      <span
                        className="rounded-full bg-[#FFF4E5] px-2 py-0.5 text-[10px] text-[#B26A00]"
                        title="示例内容，并非来自该平台的真实同步"
                      >
                        示例
                      </span>
                    ) : null}
                  </p>
                  <p className="whitespace-pre-line break-words px-4 pt-1.5 text-[13px] leading-5">{item.content}</p>
                  {item.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 px-4 pt-2">
                      {item.tags.map((tag) => (
                        <span key={tag} className="break-all text-[11px] text-[#6572D8]">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {item.videoUrl ? (
                    <video src={item.videoUrl} poster={item.images[0]} controls preload="metadata" playsInline className="mt-3 aspect-video max-h-[420px] w-full bg-black" />
                  ) : item.images.length === 1 ? (
                    <div className="relative mt-3 aspect-[4/3] overflow-hidden bg-[#F1F3FF]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.images[0]} alt="动态图片" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                    </div>
                  ) : item.images.length > 1 ? (
                    <div className="tf-scroll-x mt-3 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1">
                      {item.images.map((src, index) => (
                        <div key={`${src}-${index}`} className="relative aspect-[4/3] w-[76%] shrink-0 snap-center overflow-hidden rounded-2xl bg-[#F1F3FF]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt={`动态图片${index + 1}`} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                          <span className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">
                            {index + 1}/{item.images.length}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex items-center gap-4 px-4 py-3 text-[12px] text-muted">
                    <button onClick={() => void toggleLike(item.id)} aria-label="点赞" className={`flex items-center gap-1 ${item.liked ? "text-red-500" : ""}`}>
                      <Heart size={15} fill={item.liked ? "currentColor" : "none"} />
                      {formatCount(item.likeCount)}
                    </button>
                    <button onClick={() => void toggleComments(item.id)} aria-label="评论" className="flex items-center gap-1">
                      <MessageCircle size={15} />
                      {formatCount(item.commentCount)}
                    </button>
                  </div>
                  {commenting === item.id ? (
                    <div className="border-t border-line bg-[#FAFBFF] px-4 py-3">
                      {(comments[item.id] ?? []).slice(-8).map((comment) => (
                        <p key={comment.id} className="mb-2 break-words text-[12px] leading-5">
     
                          <button
                            type="button"
                            onClick={() => setPreviewUserId(comment.user.id)}
                            className="text-left font-semibold"
                          >
                            {comment.user.nickname ?? "用户"}{" "}
                          </button>
                          {comment.content}
                        </p>
                      ))}
                      <div className="flex gap-2">
                        <input
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void addComment(item.id);
                          }}
                          placeholder="说点什么…"
                          maxLength={500}
                          aria-label="写评论"
                          className="h-9 min-w-0 flex-1 rounded-full border border-line bg-white px-3 text-[12px] outline-none focus:ring-2 focus:ring-indigo-200"
                        />
                        <button onClick={() => void addComment(item.id)} className="h-9 shrink-0 rounded-full bg-[#6572D8] px-4 text-[12px] text-white">
                          发送
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
            {data.items.length === 0 && !data.locked ? (
              <div className="mt-6 rounded-3xl border border-dashed border-indigo-200 bg-[#F7F9FF] p-6 text-center text-[12px] text-muted">
                还没有同步到动态，绑定平台后会自动出现。
              </div>
            ) : null}

            <GradientButton href="/moments" className="mb-1 mt-6">
              回动态广场
            </GradientButton>
          </>
        ) : null}
      </div>
      <ProfilePreviewCard userId={previewUserId} onClose={() => setPreviewUserId(null)} />
      <TabBar active="/moments" />
    </PhoneShell>
  );
}

function FilterPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`max-w-[220px] shrink-0 truncate rounded-full px-3 py-2 text-[12px] ${active ? "tf-gradient text-white" : "bg-[#F1F3FF] text-muted"}`}
    >
      {label}
    </button>
  );
}
