"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Heart, MessageCircle } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { TabBar } from "@/components/tab-bar";
import {
  TFAvatar,
  TFBadge,
  TFButton,
  TFCard,
  TFDialog,
  TFEmptyState,
  TFErrorState,
  TFLoadingRegion,
  TFRowSkeleton,
  TFSkeleton,
  useToast,
} from "@/components/tf";
import { ProfilePreviewCard } from "@/components/profile-preview-card";
import { MomentComments, type MomentComment } from "@/components/moment-comments";
import { MomentEditDialog, type MomentEditable } from "@/components/moment-edit-dialog";
import { MomentReportDialog } from "@/components/moment-report-dialog";
import { ApiRequestError, apiFetch } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatCount, formatDuration, relativeTime } from "@/lib/moments";

/**
 * PC-2.1 — Post Detail.
 *
 * The feed card is a summary, so this screen re-reads the single moment from
 * `GET /moments/:id` instead of hand-assembling a "detail" out of whatever the
 * list happened to hold: the database is the only source of the author, body,
 * media and timestamps shown here.
 *
 * Authorization is entirely server-side. A moment the viewer may not read
 * answers `403 MOMENT_LOCKED` (private, connections-only and blocked all land
 * there) and a missing one answers `404 MOMENT_NOT_FOUND`; this page only maps
 * those codes onto friendly states, because a hidden control is not a boundary.
 *
 * Avatars and nicknames open the one shared `ProfilePreviewCard`, so the
 * author's profile keeps obeying `ProfileFieldVisibility` instead of being
 * re-rendered from this response.
 *
 * PC-2.2 adds the comment thread. It is read from `GET /moments/:id/comments`
 * and written through `POST` on the same route, and it is only requested after
 * the moment itself came back readable - a locked or missing moment therefore
 * never leaks its comments through a second call.
 *
 * PC-2.3.3 adds replies. They go through the same route with a
 * `parentCommentId`, and they are inserted under the comment the server
 * accepted them for - the reply level is one deep, so a reply never gets an
 * affordance of its own. `commentCount` is deliberately untouched by a reply:
 * it has always counted top-level comments.
 *
 * PC-2.4 paginates the thread and lets the owner delete their own comment. The
 * list is read a page at a time and appended, never replaced, and a row leaves
 * the screen only after the API answered - so what is on screen is what
 * PostgreSQL holds. `commentCount` moves with a top-level delete and stays put
 * for a reply, which is still the only thing the counter has ever meant.
 *
 * PC-2.5.4 adds one way out of the screen: reporting the moment itself. The
 * overflow menu only opens the dialog; `POST /reports` decides everything that
 * matters, including whether this viewer may see the moment at all
 * (`resolveMomentAccess`) and whether the report would be a self-report. A
 * refusal leaves the dialog open with the draft intact, and a success is
 * acknowledged in text only — the moment, its comment thread and `commentCount`
 * are all left exactly as they were.
 */

/**
 * PC-2.4 — the list shape the console already uses for paginated collections,
 * reused here so the web client has one pagination contract rather than a
 * second, comment-only one. `hasMore` is derived from `page < totalPages`.
 */
type CommentPage = {
  items: MomentComment[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

type MomentDetail = {
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
  syncedAt?: string | null;
  createdAt: string;
};

export default function MomentDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [moment, setMoment] = useState<MomentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [liking, setLiking] = useState(false);
  const [previewUserId, setPreviewUserId] = useState<string | null>(null);
  const [comments, setComments] = useState<MomentComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // PC-2.4 — which page of top-level comments is on screen, and whether the
  // paginated surface still has another one behind it.
  const [commentsPage, setCommentsPage] = useState(1);
  const [commentsTotalPages, setCommentsTotalPages] = useState(0);
  const [commentsLoadingMore, setCommentsLoadingMore] = useState(false);
  // PC-2.5.4 — the report surface. Nothing about the moment changes when a
  // report is accepted, so the only state it needs is whether the menu and the
  // dialog are open plus the acknowledgement line.
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportNotice, setReportNotice] = useState("");
  /**
   * The owner's half of the menu. Editing and deleting a post are the two
   * actions the member who wrote it expects to find here, and both were missing
   * from the member-facing app: `PATCH /moments/:id` and `DELETE /moments/:id`
   * existed and were exercised only by the API specs, while
   * `MomentEditDialog` was imported and never rendered.
   */
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  /** `useToast()` returns `{ show }` — aliased so call sites read as a sentence. */
  const { show: toast } = useToast();
  // The viewer's own id is only used to decide whether a delete affordance is
  // shown; every write is authorized server-side regardless.
  const { user } = useSession();

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    setErrorCode("");
    try {
      const detail = await apiFetch<MomentDetail>(`/moments/${id}`);
      setMoment(detail);
      // Only reached when the moment itself was readable, so the thread cannot
      // become a side channel around the visibility rules of the moment.
      setCommentsLoading(true);
      setCommentsError("");
      try {
        const thread = await apiFetch<CommentPage>(`/moments/${id}/comments`);
        setComments(thread.items);
        setCommentsPage(thread.page);
        setCommentsTotalPages(thread.totalPages);
      } catch {
        setComments([]);
        setCommentsPage(1);
        setCommentsTotalPages(0);
      } finally {
        setCommentsLoading(false);
      }
    } catch (requestError) {
      setMoment(null);
      setComments([]);
      setCommentsPage(1);
      setCommentsTotalPages(0);
      if (requestError instanceof ApiRequestError) {
        setErrorCode(requestError.code);
        setError(requestError.message);
      } else {
        setError(requestError instanceof Error ? requestError.message : "动态加载失败");
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleLike() {
    if (!moment || liking) return;
    setLiking(true);
    try {
      const result = await apiFetch<{ liked: boolean }>(`/moments/${moment.id}/like`, { method: "POST" });
      setMoment((current) =>
        current && current.id === moment.id
          ? {
              ...current,
              liked: result.liked,
              likeCount: Math.max(
                0,
                current.likeCount + (result.liked === current.liked ? 0 : result.liked ? 1 : -1),
              ),
            }
          : current,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "点赞失败");
    } finally {
      setLiking(false);
    }
  }

  async function submitComment() {
    if (!moment || sending) return;
    const content = draft.trim();
    if (!content) return;
    setSending(true);
    setCommentsError("");
    try {
      const comment = await apiFetch<MomentComment>(`/moments/${moment.id}/comments`, {
        method: "POST",
        body: { content },
      });
      // The row the API returned is the row PostgreSQL now holds, so it is
      // appended as-is rather than being rebuilt from the draft.
      setComments((current) => [...current, comment]);
      setMoment((current) => (current ? { ...current, commentCount: current.commentCount + 1 } : current));
      setDraft("");
    } catch (requestError) {
      setCommentsError(requestError instanceof Error ? requestError.message : "评论发送失败");
    } finally {
      setSending(false);
    }
  }

  /**
   * PC-2.3.3 — a reply is the same write with a parent id. The row the API
   * returned is the row PostgreSQL now holds, so it is appended to the parent
   * it belongs to rather than being rebuilt from the draft.
   *
   * A rejection is re-thrown on purpose: the composer still holds the draft and
   * maps the error code onto its own copy, and nothing is inserted locally.
   * `commentCount` is not bumped here - only top-level comments are counted.
   */
  async function submitReply(parent: MomentComment, content: string) {
    if (!moment) return;
    const reply = await apiFetch<MomentComment>(`/moments/${moment.id}/comments`, {
      method: "POST",
      body: { content, parentCommentId: parent.id },
    });
    setComments((current) =>
      current.map((item) =>
        item.id === parent.id ? { ...item, replies: [...(item.replies ?? []), reply] } : item,
      ),
    );
  }

  /**
   * PC-2.4 — the next page is appended to the comments already on screen. The
   * order is the server's (oldest first), so a page boundary can only ever fall
   * between whole threads: replies travel nested with their parent.
   */
  async function loadMoreComments() {
    if (!moment || commentsLoadingMore) return;
    setCommentsLoadingMore(true);
    setCommentsError("");
    try {
      const next = await apiFetch<CommentPage>(`/moments/${moment.id}/comments?page=${commentsPage + 1}`);
      setComments((current) => [...current, ...next.items]);
      setCommentsPage(next.page);
      setCommentsTotalPages(next.totalPages);
    } catch (requestError) {
      // The page already on screen is left untouched, so a failed "load more"
      // costs the reader nothing.
      setCommentsError(requestError instanceof Error ? requestError.message : "评论加载失败");
    } finally {
      setCommentsLoadingMore(false);
    }
  }

  /**
   * PC-2.4 — deletion is the server's answer applied locally. Nothing leaves the
   * screen before `DELETE` succeeded, and a rejection is re-thrown so the
   * confirmation can keep itself open and say why. Only a top-level delete moves
   * the counter: it is still the number of top-level comments, and its replies
   * went with it through the database cascade.
   */
  async function deleteComment(comment: MomentComment, parentId?: string) {
    if (!moment) return;
    const result = await apiFetch<{ deleted: boolean; parentCommentId: string | null }>(
      `/moments/${moment.id}/comments/${comment.id}`,
      { method: "DELETE" },
    );
    if (result.parentCommentId === null) {
      setComments((current) => current.filter((item) => item.id !== comment.id));
      setMoment((current) =>
        current ? { ...current, commentCount: Math.max(0, current.commentCount - 1) } : current,
      );
      return;
    }
    if (!parentId) return;
    setComments((current) =>
      current.map((item) =>
        item.id === parentId
          ? { ...item, replies: (item.replies ?? []).filter((reply) => reply.id !== comment.id) }
          : item,
      ),
    );
  }

  /**
   * PC-2.4 — the owner of a comment rewrites it in place. The row the API
   * answered with is merged into the copy already on screen rather than being
   * rebuilt from the draft, so what is displayed is PostgreSQL's value —
   * including the server's own trimming.
   *
   * The rejection is re-thrown on purpose: the editor still holds the draft and
   * maps the error code onto its own copy, and the old text is never replaced
   * locally.
   */
  async function updateComment(comment: MomentComment, newContent: string, parentId?: string) {
    if (!moment) return;
    const updated = await apiFetch<MomentComment>(`/moments/${moment.id}/comments/${comment.id}`, {
      method: "PATCH",
      body: { content: newContent },
    });
    setComments((current) =>
      current.map((item) => {
        if (item.id === comment.id) return { ...item, content: updated.content };
        if (parentId && item.id === parentId) {
          return {
            ...item,
            replies: (item.replies ?? []).map((reply) =>
              reply.id === comment.id ? { ...reply, content: updated.content } : reply,
            ),
          };
        }
        return item;
      }),
    );
  }

  /**
   * The owner's own post: `PATCH` returns the stored row, so the screen shows
   * exactly what the database holds instead of the local draft. `commentCount`,
   * `liked` and the author are not part of that response and are left alone.
   */
  function applyMomentEdit(updated: MomentEditable) {
    setMoment((current) =>
      current && current.id === updated.id
        ? {
            ...current,
            content: updated.content,
            images: updated.images,
            videoUrl: updated.videoUrl,
            tags: updated.tags,
          }
        : current,
    );
  }

  function askDeleteMoment() {
    setMenuOpen(false);
    setDeleteError("");
    setDeleteOpen(true);
  }

  /**
   * Deletion is the server's answer applied to the screen: the row leaves only
   * after `DELETE` succeeded, and a refusal keeps the dialog open with its
   * reason so a retry is one tap. The moment no longer exists, so the member is
   * returned to the feed with the same toast the feed's own delete shows.
   */
  async function confirmDeleteMoment() {
    if (!moment || deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await apiFetch(`/moments/${moment.id}`, { method: "DELETE" });
      setDeleteOpen(false);
      toast({ message: "动态已删除" });
      router.replace("/moments");
    } catch (requestError) {
      setDeleteError(requestError instanceof Error ? requestError.message : "删除失败，请稍后重试");
    } finally {
      setDeleting(false);
    }
  }

  const locked = errorCode === "MOMENT_LOCKED";
  const missing = errorCode === "MOMENT_NOT_FOUND" || errorCode === "USER_NOT_FOUND";
  /**
   * Ownership decides which menu items this screen offers. Until the session has
   * resolved there is no id, so nothing owner-only is offered — the moment is
   * still fully readable, and the menu never shows a control that would then
   * disappear.
   */
  const isMine = Boolean(user?.id) && moment?.userId === user?.id;

  return (
    <PhoneShell>
      {/*
        A bespoke header rather than `ScreenHeader`, because it carries a menu
        button whose open/closed state lives in this component. `moment-menu` is
        asserted by `moment-detail.spec.ts`, and it must stay a real `<button>`
        that toggles on click.

        What changed: the back control grows to 44px (it was 36), the title moves
        to the `heading` step, and the colours come from tokens. The menu itself is
        a `⋯` glyph rather than an icon because the previous icon was not
        `aria-hidden` and its accessible name came from the glyph.
      */}
      <div className="z-10 grid shrink-0 grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-border bg-surface/95 px-2 py-1 backdrop-blur">
        <Link
          href="/moments"
          aria-label="返回动态"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-content transition-colors duration-instant hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <ArrowLeft size={22} aria-hidden="true" />
        </Link>
        <p className="min-w-0 truncate text-center text-heading font-semibold text-content">动态详情</p>
        {/* The menu holds whatever this viewer may do with the moment: the
            owner gets 修改 / 删除, everyone else gets 举报. Which of them appear
            is decided by ownership for layout only — every route re-checks it
            server-side, so a hidden control is never the boundary. */}
        {moment ? (
          <span className="relative inline-block h-11 w-11">
            <button
              type="button"
              data-testid="moment-menu"
              aria-label="动态操作菜单"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="grid h-11 w-11 place-items-center rounded-full text-content-muted transition-colors duration-instant hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              <span aria-hidden="true" className="text-heading leading-none">⋯</span>
            </button>
            {menuOpen ? (
              <span className="absolute right-0 top-12 z-20 flex flex-col overflow-hidden rounded-row border border-border bg-surface shadow-raised animate-fade-in motion-reduce:animate-none">
                {isMine ? (
                  <>
                    <button
                      type="button"
                      data-testid="moment-edit-open"
                      onClick={() => {
                        setMenuOpen(false);
                        setEditOpen(true);
                      }}
                      className="whitespace-nowrap px-3 py-2.5 text-left text-ui text-content hover:bg-surface-sunken"
                    >
                      修改这条动态
                    </button>
                    <button
                      type="button"
                      data-testid="moment-delete-open"
                      onClick={askDeleteMoment}
                      className="whitespace-nowrap px-3 py-2.5 text-left text-ui text-danger-600 hover:bg-surface-sunken"
                    >
                      删除这条动态
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  data-testid="moment-report-open"
                  onClick={() => {
                    setMenuOpen(false);
                    setReportNotice("");
                    setReportOpen(true);
                  }}
                  className="whitespace-nowrap px-3 py-2.5 text-left text-ui text-content hover:bg-surface-sunken"
                >
                  举报这条动态
                </button>
              </span>
            ) : null}
          </span>
        ) : (
          <span aria-hidden="true" className="h-11 w-11" />
        )}
      </div>

      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        {loading ? (
          <TFLoadingRegion label="正在加载动态">
            <div className="space-y-3">
              <TFRowSkeleton />
              <TFSkeleton shape="block" className="h-64 w-full" />
            </div>
          </TFLoadingRegion>
        ) : null}

        {/* `MOMENT_LOCKED` is not an error — it is a visibility rule the member
            agreed to, so it reads as a neutral notice rather than a failure. */}
        {!loading && locked ? (
          <TFCard tone="quiet" className="text-center">
            <p className="text-ui font-medium text-content">这条动态暂时无法查看</p>
            <p className="mt-1 text-caption leading-5 text-content-muted">
              对方设置了动态可见范围，成为连接后才能查看。
            </p>
            <TFButton href="/moments" variant="secondary" className="mt-4" fullWidth>
              回动态广场
            </TFButton>
          </TFCard>
        ) : null}

        {!loading && missing ? (
          <TFEmptyState
            title="这条动态不存在或已被删除"
            description="它可能已被作者删除，或者链接不完整。"
            action={
              <TFButton href="/moments" variant="secondary" fullWidth>
                回动态广场
              </TFButton>
            }
          />
        ) : null}

        {!loading && error && !locked && !missing ? (
          <div className="space-y-3">
            <TFErrorState description={error} onRetry={() => void load()} />
          </div>
        ) : null}

        {!loading && moment ? (
          <article data-testid="moment-detail" className="overflow-hidden rounded-card border border-border bg-surface">
            <header className="flex items-center gap-3 px-4 pt-4">
              <button
                type="button"
                onClick={() => setPreviewUserId(moment.userId)}
                aria-label={`查看 ${moment.author.nickname ?? "用户"} 的资料卡`}
                className="shrink-0"
              >
                <TFAvatar name={moment.author.nickname} src={moment.author.avatarUrl} size="md" />
              </button>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setPreviewUserId(moment.userId)}
                  className="block max-w-full truncate text-left text-ui font-semibold text-content"
                >
                  {moment.author.nickname ?? "TalkFirst 用户"}
                </button>
                <p className="truncate text-caption text-content-muted">
                  {moment.author.countryCode ?? "全球"} · {moment.platformName ?? moment.platform} · {relativeTime(moment.createdAt)}
                </p>
              </div>
              {moment.isDemo ? (
                <TFBadge tone="warning" className="shrink-0" title="示例内容，并非来自该平台的真实同步">
                  示例
                </TFBadge>
              ) : null}
            </header>

            <p className="whitespace-pre-line break-words px-4 pt-3 text-body text-content">{moment.content}</p>

            {moment.tags.length > 0 ? (
              <div className="flex flex-wrap gap-x-2 gap-y-1 px-4 pt-2">
                {moment.tags.map((tag) => (
                  <span key={tag} className="break-all text-caption text-brand-500">
                    #{tag}
                  </span>
                ))}
              </div>
            ) : null}

            {moment.videoUrl ? (
              <div className="mt-3">
                <video
                  src={moment.videoUrl}
                  poster={moment.images[0]}
                  controls
                  preload="metadata"
                  playsInline
                  className="aspect-video max-h-[420px] w-full bg-black"
                />
                {moment.durationSec ? (
                  <p className="px-4 pt-1 text-caption text-content-muted">时长 {formatDuration(moment.durationSec)}</p>
                ) : null}
              </div>
            ) : moment.images.length === 1 ? (
              <div className="relative mt-3 aspect-[4/3] overflow-hidden bg-surface-sunken">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={moment.images[0]} alt="动态图片" className="absolute inset-0 h-full w-full object-cover" />
              </div>
            ) : moment.images.length > 1 ? (
              <div className="tf-scroll-x mt-3 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1">
                {moment.images.map((src, index) => (
                  <div
                    key={`${src}-${index}`}
                    className="relative aspect-[4/3] w-[76%] shrink-0 snap-center overflow-hidden rounded-card bg-surface-sunken"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`动态图片${index + 1}`} className="absolute inset-0 h-full w-full object-cover" />
                    <span className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-overline text-white">
                      {index + 1}/{moment.images.length}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex items-center gap-1 border-t border-border px-4 py-2 text-caption text-content-muted">
              {/* `aria-pressed` is new: like is a toggle, and a screen reader had no
                  way to know whether it was already on. The hit target also grows
                  to 36px, which is the minimum for a control that sits in a row. */}
              <button
                type="button"
                onClick={() => void toggleLike()}
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
              {/* The comment count is a read-out here, not a control — the comment
                  section is directly below it, so making this a button would give
                  two ways to do nothing. */}
              <span className="flex items-center gap-1.5 px-2.5" aria-label="评论数">
                <MessageCircle size={17} aria-hidden="true" />
                {formatCount(moment.commentCount)}
              </span>
            </div>
          </article>
        ) : null}

        {reportNotice ? (
          <p
            data-testid="moment-report-notice"
            role="status"
            className="mt-4 break-words rounded-row border border-brand-200 bg-brand-50 px-4 py-3 text-caption leading-5 text-content"
          >
            {reportNotice}
          </p>
        ) : null}

        {!loading && moment ? (
          <section className="mt-4 rounded-card border border-border bg-surface px-4 py-3">
            <MomentComments
              testId="moment-comments"
              title="评论"
              count={moment.commentCount}
              avatarSize="md"
              comments={comments}
              loading={commentsLoading}
              sending={sending}
              error={commentsError}
              draft={draft}
              onDraft={setDraft}
              onSend={() => void submitComment()}
              onReply={submitReply}
              onDelete={deleteComment}
              onEdit={updateComment}
              currentUserId={user?.id ?? null}
              hasMore={commentsPage < commentsTotalPages}
              loadingMore={commentsLoadingMore}
              // 只有服务端报告不止一页时才给出「加载更多」：一页装得下的线程
              // 不该看到任何分页控件（组件只负责渲染交给它的东西）。
              onLoadMore={commentsTotalPages > 1 ? () => void loadMoreComments() : undefined}
              onProfile={setPreviewUserId}
            />
          </section>
        ) : null}
      </div>
      <ProfilePreviewCard userId={previewUserId} onClose={() => setPreviewUserId(null)} />
      {/* `key` remounts the editor for each moment, so the draft state inside it
          can never carry over from one row to the next. */}
      {editOpen && moment ? (
        <MomentEditDialog
          key={moment.id}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          moment={{
            id: moment.id,
            content: moment.content,
            images: moment.images,
            videoUrl: moment.videoUrl,
            tags: moment.tags,
          }}
          onSaved={applyMomentEdit}
        />
      ) : null}
      {/* The same two-button dialog the feed uses for the same irreversible
          action, with the failure kept inside it so a retry is one tap. */}
      <TFDialog
        open={deleteOpen}
        onClose={() => {
          if (deleting) return;
          setDeleteOpen(false);
          setDeleteError("");
        }}
        title="删除这条动态？"
        description="删除后无法恢复，评论也会一并消失。"
        footer={
          <>
            <TFButton
              variant="secondary"
              className="flex-1"
              disabled={deleting}
              onClick={() => {
                setDeleteOpen(false);
                setDeleteError("");
              }}
            >
              取消
            </TFButton>
            <TFButton
              variant="danger"
              className="flex-1"
              loading={deleting}
              loadingLabel="删除中…"
              onClick={() => void confirmDeleteMoment()}
              data-testid="moment-delete-confirm"
            >
              确认删除
            </TFButton>
          </>
        }
      >
        {moment ? (
          <p className="line-clamp-3 break-words rounded-row bg-surface-sunken px-3.5 py-2.5 text-caption leading-5 text-content-muted">
            {moment.content.trim() || "（这条动态只有图片）"}
          </p>
        ) : null}
        {deleteError ? (
          <p role="alert" className="mt-2 break-words text-caption text-danger-600">
            {deleteError}
          </p>
        ) : null}
      </TFDialog>
      {/* Rendered outside the scroller so the overlay is never clipped, and only
          for a moment the server actually returned a readable body for. */}
      {reportOpen && moment ? (
        <MomentReportDialog
          momentId={moment.id}
          onCancel={() => setReportOpen(false)}
          onSubmitted={() => {
            setReportOpen(false);
            setReportNotice("举报已提交，我们会尽快审核。");
          }}
        />
      ) : null}
      <TabBar active="/moments" />
    </PhoneShell>
  );
}
