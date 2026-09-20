"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertCircle, ArrowLeft, Heart, MessageCircle } from "lucide-react";
import { PhoneShell } from "@/components/phone-shell";
import { TabBar } from "@/components/tab-bar";
import { GradientButton, OutlineButton } from "@/components/ui";
import { ProfilePreviewCard } from "@/components/profile-preview-card";
import { MomentComments, type MomentComment } from "@/components/moment-comments";
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

  const locked = errorCode === "MOMENT_LOCKED";
  const missing = errorCode === "MOMENT_NOT_FOUND" || errorCode === "USER_NOT_FOUND";

  return (
    <PhoneShell>
      <div className="z-10 grid shrink-0 grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-line/70 bg-white/95 px-3 py-2">
        <Link href="/moments" aria-label="返回动态" className="grid h-9 w-9 place-items-center rounded-full bg-[#F1F3FF]">
          <ArrowLeft size={16} />
        </Link>
        <p className="min-w-0 truncate text-center text-[15px] font-semibold">动态详情</p>
        {/* PC-2.5.4 — one item, and it only exists once there is a moment to
            report. Whether the report is allowed is the API's answer, not this
            menu's: hiding the control would not make it a boundary. */}
        {moment ? (
          <span className="relative inline-block h-9 w-9">
            <button
              type="button"
              data-testid="moment-menu"
              aria-label="动态操作菜单"
              onClick={() => setMenuOpen((open) => !open)}
              className="grid h-9 w-9 place-items-center rounded-full bg-[#F1F3FF] text-[16px] leading-none"
            >
              ⋯
            </button>
            {menuOpen ? (
              <button
                type="button"
                data-testid="moment-report-open"
                onClick={() => {
                  setMenuOpen(false);
                  setReportNotice("");
                  setReportOpen(true);
                }}
                className="absolute right-0 top-11 z-20 whitespace-nowrap rounded-xl border border-line bg-white px-3 py-2 text-[12px] text-[#3D4663] shadow-xl"
              >
                举报这条动态
              </button>
            ) : null}
          </span>
        ) : (
          <span aria-hidden className="h-9 w-9" />
        )}
      </div>

      <div className="tf-scroll min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4">
        {loading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-16 rounded-3xl bg-indigo-50" />
            <div className="h-64 rounded-3xl bg-indigo-50" />
          </div>
        ) : null}

        {!loading && locked ? (
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-center">
            <p className="text-[13px] font-medium text-amber-800">这条动态暂时无法查看</p>
            <p className="mt-1 text-[12px] text-amber-700">对方设置了动态可见范围，成为连接后才能查看。</p>
            <GradientButton href="/moments" className="mt-4 min-h-[2.75rem] text-[12px]">
              回动态广场
            </GradientButton>
          </div>
        ) : null}

        {!loading && missing ? (
          <div className="rounded-3xl border border-dashed border-indigo-200 bg-[#F7F9FF] p-6 text-center">
            <p className="text-[13px] font-medium">这条动态不存在或已被删除</p>
            <GradientButton href="/moments" className="mt-4 min-h-[2.75rem] text-[12px]">
              回动态广场
            </GradientButton>
          </div>
        ) : null}

        {!loading && error && !locked && !missing ? (
          <div className="rounded-2xl bg-red-50 p-4 text-[12px] text-red-600">
            <p className="flex items-start gap-2">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span className="break-words">{error}</span>
            </p>
            <OutlineButton className="mt-3 min-h-[2.5rem] w-full text-[12px]" onClick={() => void load()}>
              重试
            </OutlineButton>
          </div>
        ) : null}

        {!loading && moment ? (
          <article data-testid="moment-detail" className="overflow-hidden rounded-3xl border border-line bg-white">
            <header className="flex items-center gap-3 px-4 pt-4">
              <button
                type="button"
                onClick={() => setPreviewUserId(moment.userId)}
                aria-label={`查看 ${moment.author.nickname ?? "用户"} 的资料卡`}
                className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#7B86FF] to-[#A47BFF] text-[13px] font-semibold text-white"
              >
                {moment.author.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={moment.author.avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  (moment.author.nickname ?? "?").slice(0, 1).toUpperCase()
                )}
              </button>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setPreviewUserId(moment.userId)}
                  className="block max-w-full truncate text-left text-[13px] font-semibold"
                >
                  {moment.author.nickname ?? "TalkFirst 用户"}
                </button>
                <p className="truncate text-[11px] text-muted">
                  {moment.author.countryCode ?? "全球"} · {moment.platformName ?? moment.platform} · {relativeTime(moment.createdAt)}
                </p>
              </div>
              {moment.isDemo ? (
                <span
                  className="shrink-0 rounded-full bg-[#FFF4E5] px-2 py-0.5 text-[10px] text-[#B26A00]"
                  title="示例内容，并非来自该平台的真实同步"
                >
                  示例
                </span>
              ) : null}
            </header>

            <p className="whitespace-pre-line break-words px-4 pt-3 text-[14px] leading-6">{moment.content}</p>

            {moment.tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 px-4 pt-2">
                {moment.tags.map((tag) => (
                  <span key={tag} className="break-all text-[11px] text-[#6572D8]">
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
                  <p className="px-4 pt-1 text-[11px] text-muted">时长 {formatDuration(moment.durationSec)}</p>
                ) : null}
              </div>
            ) : moment.images.length === 1 ? (
              <div className="relative mt-3 aspect-[4/3] overflow-hidden bg-[#F1F3FF]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={moment.images[0]} alt="动态图片" className="absolute inset-0 h-full w-full object-cover" />
              </div>
            ) : moment.images.length > 1 ? (
              <div className="tf-scroll-x mt-3 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1">
                {moment.images.map((src, index) => (
                  <div
                    key={`${src}-${index}`}
                    className="relative aspect-[4/3] w-[76%] shrink-0 snap-center overflow-hidden rounded-2xl bg-[#F1F3FF]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`动态图片${index + 1}`} className="absolute inset-0 h-full w-full object-cover" />
                    <span className="absolute right-2 top-2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">
                      {index + 1}/{moment.images.length}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="flex items-center gap-4 border-t border-line px-4 py-3 text-[12px] text-muted">
              <button
                type="button"
                onClick={() => void toggleLike()}
                disabled={liking}
                aria-label="点赞"
                className={`flex items-center gap-1 disabled:opacity-60 ${moment.liked ? "text-red-500" : ""}`}
              >
                <Heart size={16} fill={moment.liked ? "currentColor" : "none"} />
                {formatCount(moment.likeCount)}
              </button>
              <span className="flex items-center gap-1" aria-label="评论数">
                <MessageCircle size={16} />
                {formatCount(moment.commentCount)}
              </span>
            </div>
          </article>
        ) : null}

        {reportNotice ? (
          <p
            data-testid="moment-report-notice"
            role="status"
            className="mt-4 rounded-2xl border border-[#C7CCFF] bg-[#F1F3FF] px-4 py-3 text-[12px] text-[#3D4663]"
          >
            {reportNotice}
          </p>
        ) : null}

        {!loading && moment ? (
          <section className="mt-4 rounded-3xl border border-line bg-white px-4 py-3">
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
