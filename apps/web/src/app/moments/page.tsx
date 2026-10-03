"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Compass, Heart, MessageCircle, Plus, Share2, SlidersHorizontal, Trash2 } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { TabBar } from "@/components/tab-bar";
import { ProfilePreviewCard } from "@/components/profile-preview-card";
import { MomentComments, type MomentComment } from "@/components/moment-comments";
import {
  TFAvatar,
  TFBadge,
  TFButton,
  TFChip,
  TFDialog,
  TFEmptyState,
  TFErrorState,
  TFLoadingRegion,
  TFRowSkeleton,
  TFSkeleton,
  TFTabs,
  useToast,
} from "@/components/tf";
import { apiFetch } from "@/lib/api";
import { useSession } from "@/lib/session";
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
// PC-2.2: the thread is rendered by the shared comment component, so the feed
// and Post Detail cannot drift apart.
type Comment = MomentComment;

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
  /**
   * `loadError` is "the feed could not be fetched" — the only case that may
   * replace the list with a 重试 panel. `actionError` is "one like / comment /
   * delete was rejected", which used to be written into the same state and so
   * deleted the entire feed from the screen in response to one failed tap.
   */
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [commenting, setCommenting] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  /**
   * A thread that failed to load and a thread with no comments are different
   * facts: the failure used to be swallowed into `[]`, which rendered as
   * "还没有评论" and told the user their comments did not exist.
   */
  const [commentErrors, setCommentErrors] = useState<Record<string, string>>({});
  const [draftComment, setDraftComment] = useState("");
  const [liking, setLiking] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [shared, setShared] = useState<string | null>(null);
  /**
   * The feed's delete confirmation.
   *
   * This was `window.confirm`. A browser-native dialog cannot be styled, cannot
   * be reached by the app's own focus management, and looks like the browser
   * rather than the product — while `/me` already used a real `TFDialog` for its
   * irreversible action. Two different confirmations for two similarly
   * destructive actions was itself the inconsistency the design system exists to
   * remove.
   *
   * Holding the whole moment (not just the id) also lets the dialog name what is
   * about to be deleted.
   */
  const [pendingDelete, setPendingDelete] = useState<Moment | null>(null);
  /** `useToast()` returns `{ show }` — aliased so call sites read as a sentence. */
  const { show: toast } = useToast();
  // PC-1.4 §17: one card for every avatar / nickname entry point on this page.
  const [previewUserId, setPreviewUserId] = useState<string | null>(null);
  /**
   * The viewer's own id, so ownership is decided by WHO WROTE the post rather than
   * by which tab is open.
   *
   * This used to be `isMine={tab === "mine"}`, which meant the delete control
   * appeared ONLY on the 「我的」 tab. A member looking at their own post on the
   * default 「推荐」 feed — the most natural place to notice a mistake — saw no way
   * to remove it, and nothing on screen explained that switching tabs would reveal
   * one. Ownership is a property of the row, not of the filter.
   *
   * KEEP AS A LAYOUT-ONLY DECISION: the API re-checks ownership on every write
   * (`MomentService.remove` / `updateMoment` reject a non-author), so a hidden
   * button was never the boundary and a shown-but-not-yours button still cannot
   * delete anything.
   */
  const { user } = useSession();

  const load = useCallback(
    async (reset = true) => {
      if (reset) {
        setLoading(true);
        setCursor(null);
      } else {
        setLoadingMore(true);
      }
      setLoadError("");
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
        setLoadError(requestError instanceof Error ? requestError.message : "动态加载失败");
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
    setActionError("");
    setCommentErrors({});
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
    setActionError("");
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
      // Inline banner: the optimistic like is rolled back, the feed stays.
      setActionError(requestError instanceof Error ? requestError.message : "点赞失败");
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
    setCommentErrors((current) => {
      if (!(momentId in current)) return current;
      const next = { ...current };
      delete next[momentId];
      return next;
    });
    if (!comments[momentId]) {
      try {
        // PC-2.4 — GET comments 回答的是分页对象；卡片只读首页，不提供加载更多。
        const data = await apiFetch<{ items: Comment[] }>(`/moments/${momentId}/comments`);
        setComments((current) => ({ ...current, [momentId]: data.items }));
      } catch (requestError) {
        // No `[]` fallback: an empty array is indistinguishable from a real
        // empty thread, and the component would claim "还没有评论".
        setCommentErrors((current) => ({
          ...current,
          [momentId]: requestError instanceof Error ? requestError.message : "评论加载失败",
        }));
      }
    }
  }

  async function addComment(momentId: string) {
    const content = draftComment.trim();
    if (!content) return;
    setActionError("");
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
      setActionError(requestError instanceof Error ? requestError.message : "评论失败");
    }
  }

  /**
   * Ask before deleting — the dialog is rendered below; this only opens it.
   *
   * Nothing irreversible happens until the confirm button in the dialog is
   * pressed, which is the same contract `/me`'s account deletion follows.
   */
  function removeMoment(moment: Moment) {
    setPendingDelete(moment);
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const momentId = pendingDelete.id;
    setDeleting(momentId);
    setActionError("");
    try {
      await apiFetch(`/moments/${momentId}`, { method: "DELETE" });
      setFeed((current) => current.filter((item) => item.id !== momentId));
      setPendingDelete(null);
      /* The one place `useToast` is called. The feed row disappears in the same
       * frame the delete lands, so without this the member gets no confirmation
       * that anything happened — the provider is mounted in `layout.tsx` and had
       * no callers at all before this. */
      toast({ message: "动态已删除" });
    } catch (requestError) {
      // The dialog stays open so the message is readable and a retry is one tap.
      setActionError(requestError instanceof Error ? requestError.message : "删除失败");
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
      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto pb-6">
        {/* Header. The identity of the page, then exactly two icon actions — one
            for the feed's own settings, one for the composer, which is the only
            filled control here. The tab bar already offers 「+」, so this is
            redundant by design: the feed is where a member is most likely to
            decide to post. */}
        <div className="flex items-start justify-between px-5 pt-4">
          <div>
            {/* Phase B: the tab is 「首页」 now, so the page title matches the tab
                that opens it. The E2E suite pins this heading by name. */}
            <h1 className="text-title font-semibold text-content">首页</h1>
            <p className="mt-1 text-caption text-content-muted">看看朋友最近在世界各地的生活。</p>
          </div>
          <div className="flex gap-1.5">
            <Link
              href="/moments/settings"
              aria-label="动态设置"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-surface text-content-muted transition-colors duration-instant hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              <SlidersHorizontal size={17} />
            </Link>
            <Link
              href="/moments/compose"
              aria-label="发布动态"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-500 text-white shadow-brand transition-transform duration-instant active:scale-95 motion-reduce:transition-none"
            >
              <Plus size={18} />
            </Link>
          </div>
        </div>

        {/* Feed tabs. `TFTabs` replaces the hand-rolled row, which had no
            `role`/`aria-selected` at all — a screen reader could not tell which
            of 推荐/关注/我的 was active. */}
        <div className="mt-3 px-5">
          <TFTabs
            label="动态分类"
            variant="underline"
            value={tab}
            onChange={(next) => setTab(next)}
            items={tabItems.map(([id, label]) => ({ id, label }))}
          />
        </div>

        {stories.length > 0 && tab !== "mine" ? (
          <div className="tf-scroll-x mt-4 flex gap-3 overflow-x-auto px-5 pb-1">
            {stories.map(([userId, author]) => (
              <button
                key={userId}
                type="button"
                onClick={() => setPreviewUserId(userId)}
                aria-label={`查看 ${author.nickname ?? "用户"} 的资料卡`}
                className="flex w-14 shrink-0 flex-col items-center gap-1"
              >
                {/* One brand-coloured ring instead of a three-stop pink/purple
                    gradient: "someone posted" is brand information, not a
                    different category of thing. */}
                <span className="rounded-full bg-brand-500 p-[2px]">
                  <span className="grid h-12 w-12 place-items-center overflow-hidden rounded-full bg-surface text-ui font-semibold text-brand-600">
                    {author.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={author.avatarUrl} alt={author.nickname ?? ""} className="h-full w-full object-cover" />
                    ) : (
                      (author.nickname ?? "?").slice(0, 1).toUpperCase()
                    )}
                  </span>
                </span>
                <span className="w-full truncate text-center text-overline text-content-muted">
                  {author.nickname ?? "用户"}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {/* Platform filter. `TFChip` gives it `aria-pressed`, a 36px target and the
            one selected style, instead of a fourth hand-rolled pill that marked
            selection by filling itself with the brand gradient. */}
        <div className="tf-scroll-x mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
          <TFChip selected={!platform} onClick={() => setPlatform("")}>
            全部
          </TFChip>
          {platforms.map((item) => (
            <TFChip
              key={item.id}
              selected={platform === item.id}
              onClick={() => setPlatform(platform === item.id ? "" : item.id)}
            >
              <span
                aria-hidden="true"
                className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-bold text-white"
                style={{ background: item.color }}
              >
                {item.icon.slice(0, 1)}
              </span>
              {item.label}
            </TFChip>
          ))}
        </div>

        {loading ? <FeedSkeleton /> : null}
        {/* Only an initial load failure replaces the feed. */}
        {loadError ? (
          <div className="mt-6">
            <TFErrorState description={loadError} onRetry={() => void load(true)} />
          </div>
        ) : null}
        {/* An action failure is dismissible and never hides the feed. */}
        {actionError ? (
          <div
            role="alert"
            className="mx-5 mt-4 flex items-start gap-2 rounded-row bg-danger-50 px-3 py-2 text-caption leading-5 text-danger-700"
          >
            <span className="min-w-0 flex-1 break-words">{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError("")}
              aria-label="关闭错误提示"
              className="shrink-0 font-medium underline"
            >
              关闭
            </button>
          </div>
        ) : null}
        {!loading && !loadError && feed.length === 0 ? <EmptyFeed tab={tab} /> : null}
        {!loading && !loadError ? (
          /*
           * One hairline between posts, not a stack of bordered cards.
           *
           * The brief is specific about this: a feed should be separated by
           * whitespace and a thin rule, not by a heavy border plus a shadow on
           * every item — which is what "大圆角白卡片套白卡片" describes. `divide-y`
           * gives exactly one separator between children (never a leading or
           * trailing rule), so the composition reads as one continuous column.
           */
          <div className="mt-2 divide-y divide-border">
            {feed.map((moment) => (
              <MomentCard
                key={moment.id}
                moment={moment}
                isMine={Boolean(user?.id) && moment.userId === user?.id}
                liking={liking === moment.id}
                deleting={deleting === moment.id}
                shared={shared === moment.id}
                onProfile={(userId) => setPreviewUserId(userId)}
                onLike={() => void toggleLike(moment)}
                onDelete={() => removeMoment(moment)}
                onShare={() => void shareMoment(moment)}
                onComments={() => void toggleComments(moment.id)}
                comments={comments[moment.id]}
                commentsOpen={commenting === moment.id}
                commentError={commentErrors[moment.id] ?? ""}
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
          <div className="px-5">
            <TFButton
              variant="secondary"
              size="sm"
              fullWidth
              className="mt-4"
              onClick={() => void load(false)}
              loading={loadingMore}
              loadingLabel="加载中…"
            >
              加载更多
            </TFButton>
          </div>
        ) : null}
      </div>
      <ProfilePreviewCard userId={previewUserId} onClose={() => setPreviewUserId(null)} />

      {/*
        The delete confirmation. Type-to-confirm would be excessive here — a post
        can be re-written, whereas an account cannot — so this is a plain
        two-button dialog, but it is the app's OWN dialog rather than
        `window.confirm`. The error stays inside the dialog so a failure is
        readable and retrying is one tap.
      */}
      <TFDialog
        open={pendingDelete !== null}
        onClose={() => {
          setPendingDelete(null);
          setActionError("");
        }}
        title="删除这条动态？"
        description="删除后无法恢复，评论也会一并消失。"
        footer={
          <>
            <TFButton
              variant="secondary"
              className="flex-1"
              onClick={() => {
                setPendingDelete(null);
                setActionError("");
              }}
            >
              取消
            </TFButton>
            <TFButton
              variant="danger"
              className="flex-1"
              onClick={() => void confirmDelete()}
              loading={deleting !== null}
              loadingLabel="删除中…"
              data-testid="moment-delete-confirm"
            >
              确认删除
            </TFButton>
          </>
        }
      >
        {pendingDelete ? (
          <p className="line-clamp-3 break-words rounded-row bg-surface-sunken px-3.5 py-2.5 text-caption leading-5 text-content-muted">
            {pendingDelete.content.trim() || "（这条动态只有图片）"}
          </p>
        ) : null}
        {actionError ? (
          <p role="alert" className="mt-2 break-words text-caption text-danger-600">
            {actionError}
          </p>
        ) : null}
      </TFDialog>

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
  commentError,
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
  /** Passed straight to `MomentComments`, which owns how it is displayed. */
  commentError: string;
  draft: string;
  onDraft: (value: string) => void;
  onComment: () => void;
  platformColor: string;
  platformLabel: string;
}) {
  return (
    /*
     * A post is a ROW, not a card.
     *
     * The briefing's "do not put a heavy card on every post" rule, applied: no
     * border, no radius, no shadow, no background of its own — the feed's own
     * hairline separators do the dividing. The media inside keeps its rounded
     * corners, which is what gives the column its shape without boxing every
     * item.
     */
    <article className="bg-surface">
      <div className="flex items-center gap-3 px-5 pt-4">
        <button
          type="button"
          onClick={() => onProfile(moment.userId)}
          aria-label={`查看 ${moment.author.nickname ?? "用户"} 的资料卡`}
          className="shrink-0"
        >
          {/* `TFAvatar` replaced a ten-line inline implementation. The gradient
              fallback became the avatar's own deterministic tint, so the same
              person is the same colour everywhere instead of always purple. */}
          <TFAvatar name={moment.author.nickname} src={moment.author.avatarUrl} size="md" />
        </button>
        <button type="button" onClick={() => onProfile(moment.userId)} className="min-w-0 flex-1 text-left">
          <p className="truncate text-ui font-semibold text-content">{moment.author.nickname ?? "TalkFirst 用户"}</p>
          <p className="text-caption text-content-muted">
            {moment.author.countryCode ?? "全球"} · {relativeTime(moment.createdAt)}
          </p>
        </button>
        <TFBadge tone="brand" className="shrink-0">
          <span
            aria-hidden="true"
            className="grid h-3.5 w-3.5 place-items-center rounded-full text-[8px] font-bold text-white"
            style={{ background: platformColor }}
          >
            {(moment.platformName ?? platformLabel).slice(0, 1)}
          </span>
          {moment.platformName ?? platformLabel}
        </TFBadge>
        {moment.isDemo ? (
          <TFBadge tone="warning" className="shrink-0" title="示例内容，并非来自该平台的真实同步">
            示例
          </TFBadge>
        ) : null}
      </div>

      <Link
        href={`/moments/${moment.id}`}
        aria-label={`查看动态详情：${moment.author.nickname ?? "用户"}`}
        className="block"
      >
        <div className="px-5 pb-3 pt-3">
          {/* Body copy at the reading size (15px), not 13px: this is the content
              the whole product exists to carry, and it was the same size as the
              metadata around it. */}
          <p className="whitespace-pre-line text-body text-content">{moment.content}</p>
          {moment.tags.length ? (
            <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">
              {moment.tags.map((tag) => (
                <span key={tag} className="text-caption text-brand-500">
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
              <span className="absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-overline text-white">
                {formatDuration(moment.durationSec)}
              </span>
            ) : null}
          </div>
        ) : moment.images.length === 1 ? (
          /* Media reaches the edges on a single image: it is the post's subject,
             and insetting it would make it read as an attachment. Multi-image
             posts stay inset so the swipe affordance is visible. */
          <div className="relative aspect-[4/3] overflow-hidden bg-surface-sunken">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={moment.images[0]} alt="动态图片" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
          </div>
        ) : moment.images.length > 1 ? (
          <div className="tf-scroll-x flex snap-x snap-mandatory gap-2 overflow-x-auto px-5 pb-1">
            {moment.images.map((src, index) => (
              <div key={`${src}-${index}`} className="relative aspect-[4/3] w-[78%] shrink-0 snap-center overflow-hidden rounded-card bg-surface-sunken">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`动态图片${index + 1}`} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                <span className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-overline text-white">
                  {index + 1}/{moment.images.length}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </Link>

      {/* The action row. `aria-pressed` on the like button is new: it is a toggle,
          and a screen reader had no way to know whether it was already on. */}
      <div className="flex items-center gap-1 px-4 pb-3 pt-2 text-caption text-content-muted">
        <button
          type="button"
          onClick={onLike}
          disabled={liking}
          aria-label="点赞"
          aria-pressed={moment.liked}
          className={`flex min-h-9 items-center gap-1.5 rounded-full px-2.5 transition-colors duration-instant hover:bg-surface-sunken disabled:opacity-60 ${
            moment.liked ? "text-danger-500" : ""
          }`}
        >
          <Heart size={17} fill={moment.liked ? "currentColor" : "none"} aria-hidden="true" />
          {formatCount(moment.likeCount)}
        </button>
        <button
          type="button"
          onClick={onComments}
          aria-label="评论"
          aria-expanded={commentsOpen}
          className="flex min-h-9 items-center gap-1.5 rounded-full px-2.5 transition-colors duration-instant hover:bg-surface-sunken"
        >
          <MessageCircle size={17} aria-hidden="true" />
          {formatCount(moment.commentCount)}
        </button>
        <button
          type="button"
          onClick={onShare}
          aria-label="分享"
          className="ml-auto flex min-h-9 items-center gap-1.5 rounded-full px-2.5 transition-colors duration-instant hover:bg-surface-sunken"
        >
          <Share2 size={17} aria-hidden="true" />
          {shared ? <span className="text-caption text-success-600">已复制</span> : null}
        </button>
        {isMine ? (
          <button
            type="button"
            onClick={onDelete}
            aria-label="删除动态"
            disabled={deleting}
            className="flex min-h-9 items-center gap-1.5 rounded-full px-2.5 transition-colors duration-instant hover:bg-surface-sunken disabled:opacity-60"
          >
            <Trash2 size={16} aria-hidden="true" />
            {deleting ? <span className="text-caption">删除中…</span> : null}
          </button>
        ) : null}
      </div>

      {commentsOpen ? (
        <div className="border-t border-border bg-surface-sunken/60 px-5 py-3">
          <MomentComments
            comments={comments ?? []}
            max={8}
            draft={draft}
            onDraft={onDraft}
            onSend={onComment}
            onProfile={onProfile}
            error={commentError}
          />
        </div>
      ) : null}
    </article>
  );
}

/**
 * The loading state, as rows rather than blocks.
 *
 * `TFSkeleton` gives the shimmer one definition (a 1.6s opacity pulse that stops
 * under `prefers-reduced-motion`), and the row shape matches what actually
 * arrives — avatar, name line, two body lines — instead of two anonymous tiles
 * that guessed at a height. A skeleton that does not resemble the content is just
 * a slower spinner.
 */
function FeedSkeleton() {
  return (
    <TFLoadingRegion label="正在加载动态">
      <div className="mt-2 divide-y divide-border">
        {[0, 1, 2].map((index) => (
          <div key={index} className="px-5 py-4">
            <TFRowSkeleton />
            <TFSkeleton shape="block" className="mt-3 h-40 w-full" />
          </div>
        ))}
      </div>
    </TFLoadingRegion>
  );
}

/**
 * The empty state.
 *
 * Replaced a dashed indigo box with an emoji. The brief asks for icon + one
 * sentence + the single action that fixes it, and — importantly — for the action
 * to be the RIGHT one for the situation: 「我的」 with no posts needs the composer,
 * while a feed with nothing in it needs the platform-sync settings, because the
 * member cannot fix an empty followed-feed by posting.
 */
function EmptyFeed({ tab }: { tab: string }) {
  const mine = tab === "mine";
  return (
    <TFEmptyState
      icon={<Compass size={26} />}
      title={mine ? "还没有发布过动态" : tab === "following" ? "还没有关注动态" : "这里还没有动态"}
      description={
        mine
          ? "发布第一条动态，让聊得来的人先认识真实的你。"
          : "去「发现」找几个聊得来的人，连接之后他们的动态会出现在这里。"
      }
      action={
        <TFButton href={mine ? "/moments/compose" : "/discover"} size="md">
          {mine ? "去发布" : "去发现"}
        </TFButton>
      }
    />
  );
}
