"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Heart, MessageCircle, Plus, Share2, SlidersHorizontal, Trash2 } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { TabBar } from "@/components/tab-bar";
import { GradientButton, OutlineButton } from "@/components/ui";
import { ProfilePreviewCard } from "@/components/profile-preview-card";
import { apiFetch } from "@/lib/api";
import { formatCount, formatDuration, relativeTime } from "@/lib/moments";

type Platform = { id: string; label: string; icon: string; color: string; connectedLabel: string };
type Moment = {
  id: string;
  userId: string;
  author: { id: string; nickname: string | null; avatarUrl: string | null; countryCode: string | null };
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
};

type Feed = { items: Moment[]; nextCursor: string | null };
type Comment = { id: string; content: string; createdAt: string; user: { id: string; nickname: string | null; avatarUrl: string | null } };

const tabItems = [
  ["recommend", "推荐"],
  ["following", "关注"],
  ["mine", "我的"],
] as const;

type TabId = (typeof tabItems)[number][0];

export default function MomentsPage() {
  const [tab, setTab] = useState<TabId>("recommend");
  const [platform, setPlatform] = useState("");
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [feed, setFeed] = useState<Moment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [commenting, setCommenting] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [draftComment, setDraftComment] = useState("");
  const [liking, setLiking] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [shared, setShared] = useState<string | null>(null);
  // PC-1.4 §17: one card for every avatar / nickname entry point on this page.
  const [previewUserId, setPreviewUserId] = useState<string | null>(null);

  const load = useCallback(
    async (reset = true) => {
      if (reset) {
        setLoading(true);
        setCursor(null);
      } else {
        setLoadingMore(true);
      }
      setError("");
      try {
        const cursorParam = !reset && cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const [result, list] = await Promise.all([
          apiFetch<Feed>(`/moments/feed?tab=${tab}${platform ? `&platform=${platform}` : ""}&limit=20${cursorParam}`),
          platforms.length ? Promise.resolve(platforms) : apiFetch<Platform[]>("/moments/platforms"),
        ]);
        if (!platforms.length) setPlatforms(list as Platform[]);
        setFeed((current) => (reset ? result.items : [...current, ...result.items]));
        setCursor(result.nextCursor);
        setHasMore(Boolean(result.nextCursor));
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "动态加载失败");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [cursor, platform, platforms, tab],
  );

  useEffect(() => {
    setFeed([]);
    setCursor(null);
    setHasMore(false);
    setCommenting(null);
  }, [tab, platform]);

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, platform]);

  const stories = useMemo(() => {
    const seen = new Map<string, Moment["author"]>();
    for (const item of feed) {
      if (!seen.has(item.userId)) seen.set(item.userId, item.author);
      if (seen.size >= 8) break;
    }
    return [...seen.entries()];
  }, [feed]);

  async function toggleLike(moment: Moment) {
    if (liking) return;
    setLiking(moment.id);
    const previous = feed;
    setFeed((current) =>
      current.map((item) =>
        item.id === moment.id
          ? { ...item, liked: !item.liked, likeCount: Math.max(0, item.likeCount + (item.liked ? -1 : 1)) }
          : item,
      ),
    );
    try {
      const result = await apiFetch<{ liked: boolean }>(`/moments/${moment.id}/like`, { method: "POST" });
      setFeed((current) =>
        current.map((item) =>
          item.id === moment.id
            ? { ...item, liked: result.liked, likeCount: Math.max(0, item.likeCount + (result.liked === item.liked ? 0 : result.liked ? 1 : -1)) }
            : item,
        ),
      );
    } catch (requestError) {
      setFeed(previous);
      setError(requestError instanceof Error ? requestError.message : "点赞失败");
    } finally {
      setLiking(null);
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
        const data = await apiFetch<Comment[]>(`/moments/${momentId}/comments`);
        setComments((current) => ({ ...current, [momentId]: data }));
      } catch {
        setComments((current) => ({ ...current, [momentId]: [] }));
      }
    }
  }

  async function addComment(momentId: string) {
    const content = draftComment.trim();
    if (!content) return;
    try {
      const comment = await apiFetch<Comment>(`/moments/${momentId}/comments`, {
        method: "POST",
        body: { content },
      });
      setComments((current) => ({ ...current, [momentId]: [...(current[momentId] ?? []), comment] }));
      setFeed((current) =>
        current.map((item) => (item.id === momentId ? { ...item, commentCount: item.commentCount + 1 } : item)),
      );
      setDraftComment("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "评论失败");
    }
  }

  async function removeMoment(momentId: string) {
    if (!window.confirm("确定删除这条动态吗？")) return;
    setDeleting(momentId);
    try {
      await apiFetch(`/moments/${momentId}`, { method: "DELETE" });
      setFeed((current) => current.filter((item) => item.id !== momentId));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "删除失败");
    } finally {
      setDeleting(null);
    }
  }

  async function shareMoment(moment: Moment) {
    const url = `${window.location.origin}/moments/user/${moment.userId}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "TalkFirst 动态", text: moment.content.slice(0, 80), url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared(moment.id);
      setTimeout(() => setShared((current) => (current === moment.id ? null : current)), 1800);
    } catch {
      // user cancelled share sheet
    }
  }

  const platformColor = (id: string) => platforms.find((item) => item.id === id)?.color ?? "#6572D8";
  const platformLabel = (id: string) => platforms.find((item) => item.id === id)?.label ?? id;

  return (
    <PhoneShell>
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[22px] font-semibold">动态</h1>
            <p className="mt-1 text-[13px] text-muted">看看朋友最近在世界各地的生活。</p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/moments/settings"
              aria-label="动态设置"
              className="grid h-10 w-10 place-items-center rounded-full bg-[#F1F3FF] text-[#6572D8]"
            >
              <SlidersHorizontal size={17} />
            </Link>
            <Link
              href="/moments/compose"
              aria-label="发布动态"
              className="tf-gradient grid h-10 w-10 place-items-center rounded-full text-white"
            >
              <Plus size={18} />
            </Link>
          </div>
        </div>

        <div className="mt-5 flex border-b border-line">
          {tabItems.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`relative flex-1 pb-3 text-[13px] ${tab === id ? "font-semibold text-[#6572D8]" : "text-muted"}`}
            >
              {label}
              {tab === id ? <span className="absolute inset-x-6 bottom-0 h-0.5 rounded-full bg-[#6572D8]" /> : null}
            </button>
          ))}
        </div>

        {stories.length > 0 && tab !== "mine" ? (
          <div className="tf-scroll-x mt-4 flex gap-3 overflow-x-auto pb-1">
            {stories.map(([userId, author]) => (
              <button
                key={userId}
                type="button"
                onClick={() => setPreviewUserId(userId)}
                aria-label={`查看 ${author.nickname ?? "用户"} 的资料卡`}
                className="flex w-14 shrink-0 flex-col items-center gap-1"
              >
                <span className="rounded-full bg-gradient-to-br from-[#7B86FF] via-[#A47BFF] to-[#F472B6] p-[2px]">
                  <span className="grid h-12 w-12 place-items-center overflow-hidden rounded-full bg-white text-sm font-semibold text-[#6572D8]">
                    {author.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={author.avatarUrl} alt={author.nickname ?? ""} className="h-full w-full object-cover" />
                    ) : (
                      (author.nickname ?? "?").slice(0, 1).toUpperCase()
                    )}
                  </span>
                </span>
                <span className="w-full truncate text-center text-[10px] text-muted">{author.nickname ?? "用户"}</span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="tf-scroll-x mt-3 flex gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setPlatform("")}
            className={`shrink-0 rounded-full px-3 py-2 text-[12px] ${!platform ? "tf-gradient text-white" : "bg-[#F1F3FF] text-muted"}`}
          >
            全部
          </button>
          {platforms.map((item) => (
            <button
              key={item.id}
              onClick={() => setPlatform(platform === item.id ? "" : item.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-[12px] ${platform === item.id ? "tf-gradient text-white" : "bg-[#F1F3FF] text-muted"}`}
            >
              <span
                className="grid h-4 w-4 place-items-center rounded-full text-[8px] font-bold text-white"
                style={{ background: item.color }}
              >
                {item.icon.slice(0, 1)}
              </span>
              {item.label}
            </button>
          ))}
        </div>

        {loading ? <FeedSkeleton /> : null}
        {error ? (
          <div className="mt-6 rounded-2xl bg-red-50 p-4 text-[12px] text-red-600">
            {error}
            <OutlineButton className="mt-3 h-9 w-full text-[12px]" onClick={() => void load(true)}>
              重试
            </OutlineButton>
          </div>
        ) : null}
        {!loading && !error && feed.length === 0 ? <EmptyFeed tab={tab} /> : null}
        {!loading && !error ? (
          <div className="mt-5 space-y-4">
            {feed.map((moment) => (
              <MomentCard
                key={moment.id}
                moment={moment}
                isMine={tab === "mine"}
                liking={liking === moment.id}
                deleting={deleting === moment.id}
                shared={shared === moment.id}
                onProfile={(userId) => setPreviewUserId(userId)}
                onLike={() => void toggleLike(moment)}
                onDelete={() => void removeMoment(moment.id)}
                onShare={() => void shareMoment(moment)}
                onComments={() => void toggleComments(moment.id)}
                comments={comments[moment.id]}
                commentsOpen={commenting === moment.id}
                draft={draftComment}
                onDraft={setDraftComment}
                onComment={() => void addComment(moment.id)}
                platformColor={platformColor(moment.platform)}
                platformLabel={platformLabel(moment.platform)}
              />
            ))}
          </div>
        ) : null}
        {!loading && hasMore ? (
          <OutlineButton className="mb-1 mt-5 min-h-[2.75rem] w-full text-[12px]" onClick={() => void load(false)}>
            {loadingMore ? "加载中…" : "加载更多"}
          </OutlineButton>
        ) : null}
      </div>
      <ProfilePreviewCard userId={previewUserId} onClose={() => setPreviewUserId(null)} />
      <TabBar active="/moments" />
    </PhoneShell>
  );
}

function MomentCard({
  moment,
  isMine,
  liking,
  deleting,
  shared,
  onProfile,
  onLike,
  onDelete,
  onShare,
  onComments,
  comments,
  commentsOpen,
  draft,
  onDraft,
  onComment,
  platformColor,
  platformLabel,
}: {
  moment: Moment;
  isMine: boolean;
  liking: boolean;
  deleting: boolean;
  shared: boolean;
  onProfile: (userId: string) => void;
  onLike: () => void;
  onDelete: () => void;
  onShare: () => void;
  onComments: () => void;
  comments?: Comment[];
  commentsOpen: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onComment: () => void;
  platformColor: string;
  platformLabel: string;
}) {
  return (
    <article className="overflow-hidden rounded-3xl border border-line bg-white shadow-sm">
          <div className="flex items-center gap-3 p-4">
        <button
          type="button"
          onClick={() => onProfile(moment.userId)}
          aria-label={`查看 ${moment.author.nickname ?? "用户"} 的资料卡`}
          className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#7B86FF] to-[#A47BFF] text-sm font-semibold text-white"
        >
          {moment.author.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={moment.author.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            (moment.author.nickname ?? "?").slice(0, 1).toUpperCase()
          )}
        </button>
        <button type="button" onClick={() => onProfile(moment.userId)} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[13px] font-semibold">{moment.author.nickname ?? "TalkFirst 用户"}</p>
          <p className="text-[11px] text-muted">
            {moment.author.countryCode ?? "全球"} · {relativeTime(moment.createdAt)}
          </p>
        </button>
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#F1F3FF] px-2.5 py-1 text-[10px] text-[#6572D8]">
          <span className="grid h-4 w-4 place-items-center rounded-full text-[8px] font-bold text-white" style={{ background: platformColor }}>
            {(moment.platformName ?? platformLabel).slice(0, 1)}
          </span>
          {moment.platformName ?? platformLabel}
        </span>
        {moment.isDemo ? (
          <span
            className="shrink-0 rounded-full bg-[#FFF4E5] px-2 py-1 text-[10px] text-[#B26A00]"
            title="示例内容，并非来自该平台的真实同步"
          >
            示例
          </span>
        ) : null}
      </div>

      <div className="px-4 pb-3">
        <p className="whitespace-pre-line text-[13px] leading-5">{moment.content}</p>
        {moment.tags.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {moment.tags.map((tag) => (
              <span key={tag} className="text-[11px] text-[#6572D8]">
                #{tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {moment.videoUrl ? (
        <div className="relative bg-black">
          <video src={moment.videoUrl} poster={moment.images[0]} controls preload="metadata" playsInline className="aspect-video max-h-[420px] w-full" />
          {moment.durationSec ? (
            <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
              {formatDuration(moment.durationSec)}
            </span>
          ) : null}
        </div>
      ) : moment.images.length === 1 ? (
        <div className="relative aspect-[4/3] overflow-hidden bg-[#F1F3FF]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={moment.images[0]} alt="动态图片" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
        </div>
      ) : moment.images.length > 1 ? (
        <div className="tf-scroll-x flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1">
          {moment.images.map((src, index) => (
            <div key={`${src}-${index}`} className="relative aspect-[4/3] w-[78%] shrink-0 snap-center overflow-hidden rounded-2xl bg-[#F1F3FF]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`动态图片${index + 1}`} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
              <span className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">
                {index + 1}/{moment.images.length}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-5 px-4 py-3 text-[12px] text-muted">
        <button onClick={onLike} disabled={liking} aria-label="点赞" className={`flex items-center gap-1.5 transition active:scale-110 ${moment.liked ? "text-red-500" : ""}`}>
          <Heart size={16} fill={moment.liked ? "currentColor" : "none"} />
          {formatCount(moment.likeCount)}
        </button>
        <button onClick={onComments} aria-label="评论" className="flex items-center gap-1.5">
          <MessageCircle size={16} />
          {formatCount(moment.commentCount)}
        </button>
        <button onClick={onShare} aria-label="分享" className="ml-auto flex items-center gap-1">
          <Share2 size={16} />
          {shared ? <span className="text-[10px] text-emerald-600">已复制</span> : null}
        </button>
        {isMine ? (
          <button onClick={onDelete} aria-label="删除动态" className="flex items-center gap-1 text-muted">
            <Trash2 size={15} />
            {deleting ? "…" : ""}
          </button>
        ) : null}
      </div>

      {commentsOpen ? (
        <div className="border-t border-line bg-[#FAFBFF] px-4 py-3">
          {comments?.slice(-8).map((comment) => (
            <div key={comment.id} className="mb-2.5 flex items-start gap-2">
              <button
                type="button"
                onClick={() => onProfile(comment.user.id)}
                aria-label={`查看 ${comment.user.nickname ?? "用户"} 的资料卡`}
                className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full bg-[#E4E8FF] text-[10px] font-semibold text-[#6572D8]"
              >
                {comment.user.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={comment.user.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  (comment.user.nickname ?? "?").slice(0, 1).toUpperCase()
                )}
              </button>
              <p className="min-w-0 flex-1 text-[12px] leading-5">
                <button
                  type="button"
                  onClick={() => onProfile(comment.user.id)}
                  className="font-semibold"
                >
                  {comment.user.nickname ?? "用户"}
                </button>{" "}
                {comment.content}
                <span className="ml-2 text-[10px] text-muted">{relativeTime(comment.createdAt)}</span>
              </p>
            </div>
          ))}
          {(!comments || comments.length === 0) && <p className="mb-2 text-[11px] text-muted">还没有评论，来抢沙发吧。</p>}
          <div className="flex gap-2">
            <input
              value={draft}
              onChange={(event) => onDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onComment();
              }}
              placeholder="说点什么…"
              maxLength={500}
              aria-label="写评论"
              className="h-9 min-w-0 flex-1 rounded-full border border-line bg-white px-3 text-[12px] outline-none focus:ring-2 focus:ring-indigo-200"
            />
            <button onClick={onComment} className="h-9 shrink-0 rounded-full bg-[#6572D8] px-4 text-[12px] text-white">
              发送
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function FeedSkeleton() {
  return (
    <div className="mt-5 animate-pulse space-y-4">
      <div className="h-80 rounded-3xl bg-indigo-50" />
      <div className="h-64 rounded-3xl bg-indigo-50" />
    </div>
  );
}

function EmptyFeed({ tab }: { tab: string }) {
  return (
    <div className="mt-10 rounded-3xl border border-dashed border-indigo-200 bg-[#F7F9FF] p-6 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-indigo-100 text-2xl">🌎</div>
      <p className="mt-3 text-[14px] font-medium">{tab === "following" ? "还没有关注动态" : tab === "mine" ? "还没有发布过动态" : "还没有动态"}</p>
      <p className="mt-2 text-[12px] leading-5 text-muted">
        {tab === "mine" ? "发布第一条动态，让朋友了解真实的你。" : "连接朋友并同步 Instagram、TikTok 等平台后，动态会出现在这里。"}
      </p>
      <GradientButton href={tab === "mine" ? "/moments/compose" : "/moments/settings"} className="mt-5 h-10 text-[12px]">
        {tab === "mine" ? "去发布" : "管理同步平台"}
      </GradientButton>
    </div>
  );
}
