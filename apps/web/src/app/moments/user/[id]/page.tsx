"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, BadgeCheck, Heart, MessageCircle, Share2 } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { TabBar } from "@/components/tab-bar";
import {
  TFAvatar,
  TFBadge,
  TFButton,
  TFCard,
  TFChip,
  TFEmptyState,
  TFErrorState,
  TFInput,
  TFLoadingRegion,
  TFRowSkeleton,
  TFSkeleton,
} from "@/components/tf";
import { ProfilePreviewCard } from "@/components/profile-preview-card";
import { apiFetch } from "@/lib/api";
import { formatCount, relativeTime } from "@/lib/moments";
import { useT } from "@/lib/i18n";

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
  /** Initial load failure only — an action failure must not replace the page. */
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [loading, setLoading] = useState(true);
  const [commenting, setCommenting] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  /** A failed thread load is reported instead of being shown as "no comments". */
  const [commentErrors, setCommentErrors] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [sharing, setSharing] = useState(false);
  const [previewUserId, setPreviewUserId] = useState<string | null>(null);
  const { t } = useT();

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError("");
    try {
      const result = await apiFetch<Detail>(`/moments/user/${id}${platform ? `?platform=${platform}` : ""}`);
      setData(result);
    } catch (requestError) {
      setLoadError(requestError instanceof Error ? requestError.message : t("mu.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [id, platform]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleLike(momentId: string) {
    setActionError("");
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
      setActionError(requestError instanceof Error ? requestError.message : t("mu.likeFailed"));
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
        // PC-2.4 — GET comments 回答的是分页对象：这里只读首页，卡片不提供加载更多也不提供删除。
        const data = await apiFetch<{ items: Comment[] }>(`/moments/${momentId}/comments`);
        setComments((current) => ({ ...current, [momentId]: data.items }));
      } catch (requestError) {
        // The old `[]` fallback made a failed request look like an empty thread.
        setCommentErrors((current) => ({
          ...current,
          [momentId]: requestError instanceof Error ? requestError.message : t("mu.commentsLoadFailed"),
        }));
      }
    }
  }

  async function addComment(momentId: string) {
    const content = draft.trim();
    if (!content) return;
    setActionError("");
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
      setActionError(requestError instanceof Error ? requestError.message : t("mu.commentFailed"));
    }
  }

  async function shareProfile() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: t("mu.shareTitle"), url });
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
      <div className="z-10 grid shrink-0 grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-border bg-surface/95 px-2 py-1 backdrop-blur">
        <Link
          href="/moments"
          aria-label={t("mu.back")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-content transition-colors duration-instant hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <ArrowLeft size={22} aria-hidden="true" />
        </Link>
        <p className="min-w-0 truncate text-center text-heading font-semibold text-content">
          {data?.author.nickname ?? t("mu.titleFallback")}
        </p>
        <button
          type="button"
          onClick={() => void shareProfile()}
          aria-label={t("mu.shareAria")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-content-muted transition-colors duration-instant hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <Share2 size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        {loading ? (
          <TFLoadingRegion label={t("mu.loading")}>
            <div className="space-y-3">
              <TFRowSkeleton />
              <TFSkeleton shape="block" className="h-64 w-full" />
            </div>
          </TFLoadingRegion>
        ) : null}
        {loadError ? (
          <TFErrorState description={loadError} onRetry={() => void load()} />
        ) : null}

        {/* One rejected like or comment used to land in the same state as a
            failed page load and took the whole profile body off the screen. */}
        {actionError ? (
          <div
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-row bg-danger-50 px-3 py-2 text-caption leading-5 text-danger-700"
          >
            <span className="min-w-0 flex-1 break-words">{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError("")}
              aria-label={t("mu.closeError")}
              className="shrink-0 font-medium underline"
            >
              {t("mu.close")}
            </button>
          </div>
        ) : null}

        {data ? (
          <>
            <section className="overflow-hidden rounded-card border border-border bg-surface">
              <div className="tf-gradient-soft h-20" />
              <div className="-mt-8 px-4 pb-4">
                <div className="flex items-end justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewUserId(id ?? null)}
                    aria-label={t("mu.viewCard", { name: data.author.nickname ?? t("mu.userFallback") })}
                    className="shrink-0"
                  >
                    <TFAvatar
                      name={data.author.nickname}
                      src={data.author.avatarUrl}
                      size="lg"
                      ring
                      className="border-4 border-white"
                    />
                  </button>
                  <TFBadge tone="success" className="mb-1 shrink-0">
                    {data.items.length} {t("mu.countUnit")}
                  </TFBadge>
                </div>
                <p className="mt-2 flex items-center gap-1 text-heading font-semibold text-content">
                  <button
                    type="button"
                    onClick={() => setPreviewUserId(id ?? null)}
                    className="min-w-0 flex-1 truncate text-left"
                  >
                    {data.author.nickname ?? t("mu.talkfirstUser")}
                  </button>
                  <BadgeCheck size={16} className="shrink-0 text-brand-500" aria-hidden="true" />
                </p>
                <p className="mt-0.5 break-words text-caption leading-5 text-content-muted">
                  {data.author.countryCode ?? t("mu.countryFallback")} · {data.author.bio ?? t("mu.bioFallback")}
                </p>
                {sharing ? (
                  <p role="status" className="mt-1 text-caption text-success-600">
                    {t("mu.copied")}
                  </p>
                ) : null}
              </div>
            </section>

            <div className="tf-scroll-x mt-4 flex gap-2 overflow-x-auto pb-1">
              <FilterPill active={!platform} label={t("mu.allFilter", { count: data.items.length })} onClick={() => setPlatform("")} />
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
              <TFCard tone="quiet" className="mt-4 text-center">
                <p className="text-ui font-medium text-content">{t("mu.lockedTitle")}</p>
                <p className="mt-1 text-caption leading-5 text-content-muted">{t("mu.lockedBody")}</p>
                <TFButton href="/discover" variant="secondary" className="mt-4" fullWidth>
                  {t("mu.goDiscover")}
                </TFButton>
              </TFCard>
            ) : null}

            {/* Rows separated by a hairline, matching the feed: a person's moments
                are one column of content, not a stack of bordered cards. */}
            <div className="mt-3 divide-y divide-border">
              {data.items.map((item) => (
                <article key={item.id} className="bg-surface">
                  <p className="flex items-center gap-2 px-4 pt-4 text-caption text-content-muted">
                    <span>
                      {item.platformName ?? item.platform} · {relativeTime(item.createdAt)}
                    </span>
                    {item.isDemo ? (
                      <TFBadge tone="warning" title={t("mu.demoTitle")}>
                        {t("mu.demoTag")}
                      </TFBadge>
                    ) : null}
                  </p>
                  <p className="whitespace-pre-line break-words px-4 pt-1.5 text-body text-content">{item.content}</p>
                  {item.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-x-2 gap-y-1 px-4 pt-2">
                      {item.tags.map((tag) => (
                        <span key={tag} className="break-all text-caption text-brand-500">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {item.videoUrl ? (
                    <video src={item.videoUrl} poster={item.images[0]} controls preload="metadata" playsInline className="mt-3 aspect-video max-h-[420px] w-full bg-black" />
                  ) : item.images.length === 1 ? (
                    <div className="relative mt-3 aspect-[4/3] overflow-hidden bg-surface-sunken">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.images[0]} alt={t("mu.imageAlt")} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                    </div>
                  ) : item.images.length > 1 ? (
                    <div className="tf-scroll-x mt-3 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1">
                      {item.images.map((src, index) => (
                        <div key={`${src}-${index}`} className="relative aspect-[4/3] w-[76%] shrink-0 snap-center overflow-hidden rounded-card bg-surface-sunken">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt={t("mu.imageAltN", { n: index + 1 })} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                          <span className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-overline text-white">
                            {index + 1}/{item.images.length}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex items-center gap-1 px-3 py-2 text-caption text-content-muted">
                    <button
                      type="button"
                      onClick={() => void toggleLike(item.id)}
                      aria-label={t("mu.like")}
                      aria-pressed={item.liked}
                      className={`flex min-h-9 items-center gap-1.5 rounded-full px-2.5 transition-colors duration-instant hover:bg-surface-sunken ${
                        item.liked ? "text-danger-500" : ""
                      }`}
                    >
                      <Heart size={16} fill={item.liked ? "currentColor" : "none"} aria-hidden="true" />
                      {formatCount(item.likeCount)}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleComments(item.id)}
                      aria-label={t("mu.comment")}
                      aria-expanded={commenting === item.id}
                      className="flex min-h-9 items-center gap-1.5 rounded-full px-2.5 transition-colors duration-instant hover:bg-surface-sunken"
                    >
                      <MessageCircle size={16} aria-hidden="true" />
                      {formatCount(item.commentCount)}
                    </button>
                  </div>
                  {commenting === item.id ? (
                    <div className="border-t border-border bg-surface-sunken/60 px-4 py-3">
                      {(comments[item.id] ?? []).slice(-8).map((comment) => (
                        <p key={comment.id} className="mb-2 break-words text-caption leading-5 text-content">
                          <button
                            type="button"
                            onClick={() => setPreviewUserId(comment.user.id)}
                            className="text-left font-semibold"
                          >
                            {comment.user.nickname ?? t("mu.userFallback")}{" "}
                          </button>
                          {comment.content}
                        </p>
                      ))}
                      {/* Only when there is nothing to list: a failed load must
                          not read as "this moment has no comments". */}
                      {(comments[item.id] ?? []).length === 0 ? (
                        commentErrors[item.id] ? (
                          <p role="alert" className="mb-2 break-words text-caption text-danger-600">
                            {commentErrors[item.id]}
                          </p>
                        ) : (
                          <p className="mb-2 text-caption text-content-muted">{t("mu.emptyComments")}</p>
                        )
                      ) : null}
                      <div className="flex gap-2">
                        {/* `aria-label="写评论"` is asserted by the comment specs —
                            keep it on the input, not on a wrapping label. */}
                        <TFInput
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void addComment(item.id);
                          }}
                          placeholder={t("mu.commentPlaceholder")}
                          maxLength={500}
                          aria-label={t("mu.writeComment")}
                          className="h-9 min-w-0 flex-1 rounded-full px-3 text-caption"
                        />
                        <TFButton size="sm" className="shrink-0" onClick={() => void addComment(item.id)}>
                          {t("mu.send")}
                        </TFButton>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
            {data.items.length === 0 && !data.locked ? (
              <TFEmptyState
                icon={<MessageCircle size={26} />}
                title={t("mu.emptyTitle")}
                description={t("mu.emptyDesc")}
              />
            ) : null}

            <TFButton href="/moments" variant="secondary" fullWidth className="mt-6">
              {t("mu.backToFeed")}
            </TFButton>
          </>
        ) : null}
      </div>
      <ProfilePreviewCard userId={previewUserId} onClose={() => setPreviewUserId(null)} />
      <TabBar active="/moments" />
    </PhoneShell>
  );
}

/**
 * The platform filter. Kept as a local wrapper over `TFChip` rather than replaced
 * outright: the label can be long (`@handle · 12`), so it needs `max-w` and
 * `truncate`, which `TFChip` does not impose — and the binding count is not part
 * of the chip primitive.
 */
function FilterPill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <TFChip selected={active} onClick={onClick} className="max-w-[220px] shrink-0">
      <span className="truncate">{label}</span>
    </TFChip>
  );
}
