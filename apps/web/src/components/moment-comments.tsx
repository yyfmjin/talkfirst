"use client";

import { useState } from "react";
import { ApiRequestError } from "@/lib/api";
import { relativeTime } from "@/lib/moments";

/**
 * PC-2.2 — the comment block, shared by the Moments feed card and Post Detail.
 *
 * The list is `GET /moments/:id/comments` and writing is `POST` on the same
 * route, so both surfaces read and write the same real rows. Authorization is
 * entirely server-side: a private / connections-only / blocked moment answers
 * `403 MOMENT_LOCKED` for the thread exactly like it does for the moment, which
 * is why this component never has to decide who may see what — it renders what
 * the API handed it.
 *
 * Comment avatars and nicknames call `onProfile`, so tapping one opens the one
 * shared `ProfilePreviewCard` and the author's fields keep obeying
 * `ProfileFieldVisibility` instead of being re-rendered from this response.
 *
 * PC-2.3.3 — replies. The thread is one level deep: `GET` returns top-level
 * comments with their `replies` nested, so only a top-level comment offers the
 * affordance and a reply can never grow one of its own. `onReply` is optional
 * and the feed card does not pass it, which is what keeps a read-only surface
 * from ever posting a "reply" as a top-level comment. Submission resolves only
 * once the server stored the row, so there is no optimistic fake reply.
 *
 * PC-2.4 adds the two controls that need their own data: "load more" walks the
 * paginated thread (top-level comments only, so a page never splits a thread),
 * and the owner of a comment can delete it. Both are opt-in through props, which
 * is what keeps the feed card the read-only surface it has been since PC-2.3.3.
 * Nothing is removed locally before the API confirms it.
 */

export type MomentComment = {
  id: string;
  content: string;
  createdAt: string;
  /** Null on a top-level comment; absent inside a nested reply. */
  parentCommentId?: string | null;
  user: { id: string; nickname: string | null; avatarUrl: string | null };
  /** PC-2.3.3 — present on top-level comments only, and never nested further. */
  replies?: MomentComment[];
};

const AVATAR_CLASS = {
  sm: "grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full bg-[#E4E8FF] text-[10px] font-semibold text-[#6572D8]",
  md: "grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-[#E4E8FF] text-[11px] font-semibold text-[#6572D8]",
} as const;

/**
 * Rejections already carry a stable code, so this is a translation and not a
 * second rule set. Anything unmapped falls through to the API message.
 */
const REPLY_ERROR_TEXT: Record<string, string> = {
  COMMENT_PARENT_INVALID: "无法回复这条评论，请刷新后重试",
  COMMENT_BLOCKED: "回复包含不适当内容，已被拦截",
  EMPTY_COMMENT: "回复不能为空",
  MOMENT_LOCKED: "你没有权限回复这条动态",
};

/**
 * The delete path answers the same way as the write path: a stable code plus a
 * message, translated here and nowhere else.
 */
const DELETE_ERROR_TEXT: Record<string, string> = {
  COMMENT_FORBIDDEN: "只能删除自己的评论",
  COMMENT_NOT_FOUND: "这条评论已经不存在了",
  MOMENT_LOCKED: "你没有权限删除这条动态下的评论",
};

function deleteErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return DELETE_ERROR_TEXT[error.code] ?? error.message;
  return error instanceof Error ? error.message : "删除失败，请稍后重试";
}

function replyErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return REPLY_ERROR_TEXT[error.code] ?? error.message;
  return error instanceof Error ? error.message : "回复发送失败";
}

type Author = MomentComment["user"];

function CommentAvatar({
  user,
  size,
  onProfile,
}: {
  user: Author;
  size: keyof typeof AVATAR_CLASS;
  onProfile: (userId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onProfile(user.id)}
      aria-label={`查看 ${user.nickname ?? "用户"} 的资料卡`}
      className={AVATAR_CLASS[size]}
    >
      {user.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        (user.nickname ?? "?").slice(0, 1).toUpperCase()
      )}
    </button>
  );
}

function CommentAuthor({ user, onProfile }: { user: Author; onProfile: (userId: string) => void }) {
  return (
    <button type="button" onClick={() => onProfile(user.id)} className="font-semibold">
      {user.nickname ?? "用户"}
    </button>
  );
}

export function MomentComments({
  comments,
  draft,
  onDraft,
  onSend,
  onReply,
  onDelete,
  currentUserId,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onProfile,
  title,
  count,
  max,
  loading = false,
  sending = false,
  error = "",
  testId,
  avatarSize = "sm",
}: {
  comments: MomentComment[];
  draft: string;
  onDraft: (value: string) => void;
  onSend: () => void;
  /** Omit it and the thread stays read-only, as the feed card does. */
  onReply?: (parent: MomentComment, content: string) => Promise<void>;
  /**
   * PC-2.4 — omit it and no comment offers a delete affordance at all. A reply
   * also passes its parent's id so the caller knows which thread to update; the
   * server's response is still what decides whether it was a top-level delete.
   */
  onDelete?: (comment: MomentComment, parentId?: string) => Promise<void>;
  /** The signed-in user: only their own comments get the menu. */
  currentUserId?: string | null;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onProfile: (userId: string) => void;
  title?: string;
  count?: number;
  /** Feed cards keep the thread short; the detail screen shows the whole list. */
  max?: number;
  loading?: boolean;
  sending?: boolean;
  error?: string;
  testId?: string;
  avatarSize?: keyof typeof AVATAR_CLASS;
}) {
  const visible = typeof max === "number" ? comments.slice(-max) : comments;
  const canSend = draft.trim().length > 0 && !sending;

  // Reply state lives here so neither surface has to carry it: one composer is
  // open at a time, and closing it always drops the draft.
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [replyError, setReplyError] = useState("");

  // PC-2.4 — the menu, the confirmation and the in-flight delete are separate
  // so the dialog can stay open on a rejection and report why.
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  function openReply(comment: MomentComment) {
    setReplyingToId(comment.id);
    setReplyDraft("");
    setReplyError("");
  }

  function cancelReply() {
    setReplyingToId(null);
    setReplyDraft("");
    setReplyError("");
  }

  async function sendReply(comment: MomentComment) {
    const content = replyDraft.trim();
    // The same guard covers the disabled button and a double Enter press.
    if (!onReply || !content || replySending) return;
    setReplySending(true);
    setReplyError("");
    try {
      await onReply(comment, content);
      cancelReply();
    } catch (requestError) {
      // The draft is kept on failure so the text is not lost to a retry.
      setReplyError(replyErrorMessage(requestError));
    } finally {
      setReplySending(false);
    }
  }

  /** Locates a comment in the full list, so a reply knows its thread. */
  function findTarget(commentId: string): { comment: MomentComment; parentId?: string } | null {
    for (const comment of comments) {
      if (comment.id === commentId) return { comment };
      for (const reply of comment.replies ?? []) {
        if (reply.id === commentId) return { comment: reply, parentId: comment.id };
      }
    }
    return null;
  }

  function askDelete(commentId: string) {
    setMenuOpenId(null);
    setConfirmingId(commentId);
    setDeleteError("");
  }

  function cancelDelete() {
    setConfirmingId(null);
    setDeleteError("");
  }

  async function confirmDelete(comment: MomentComment, parentId?: string) {
    // The same guard covers the disabled button and a double click.
    if (!onDelete || deletingId) return;
    setDeletingId(comment.id);
    setDeleteError("");
    try {
      await onDelete(comment, parentId);
      // Only a server-confirmed delete closes the dialog: nothing disappears
      // from the thread before the API answered.
      setConfirmingId(null);
    } catch (requestError) {
      setDeleteError(deleteErrorMessage(requestError));
    } finally {
      setDeletingId(null);
    }
  }

  /**
   * A single action menu, used by top-level comments and replies alike. Nothing
   * renders unless the surface opted in *and* the comment is the viewer's own,
   * so a read-only surface cannot show an affordance it has no handler for.
   */
  function renderActions(comment: MomentComment, level: "comment" | "reply" = "comment") {
    if (!onDelete || !currentUserId || comment.user.id !== currentUserId) return null;
    const open = menuOpenId === comment.id;
    return (
      <span className="relative inline-block align-middle">
        <button
          type="button"
          data-testid={`${level}-menu`}
          aria-label="评论菜单"
          onClick={() => setMenuOpenId(open ? null : comment.id)}
          className="ml-1.5 whitespace-nowrap align-middle text-[12px] leading-none text-muted"
        >
          ⋯
        </button>
        {open ? (
          <button
            type="button"
            data-testid={`${level}-delete`}
            onClick={() => askDelete(comment.id)}
            className="absolute right-0 top-4 z-20 whitespace-nowrap rounded-xl border border-line bg-white px-3 py-1.5 text-[11px] text-red-600 shadow-xl"
          >
            删除
          </button>
        ) : null}
      </span>
    );
  }

  return (
    <section data-testid={testId} className="min-w-0">
      {title ? (
        <p data-testid="comment-count" className="mb-2.5 text-[12px] font-semibold text-[#3D4663]">
          {title}
          {typeof count === "number" ? ` · ${count}` : ""}
        </p>
      ) : null}

      {loading ? (
        <div className="mb-2.5 animate-pulse space-y-2">
          <div className="h-4 w-2/3 rounded-full bg-indigo-50" />
          <div className="h-4 w-1/2 rounded-full bg-indigo-50" />
        </div>
      ) : null}

      {!loading && visible.length > 0 ? (
        <div data-testid="comment-list">
          {visible.map((comment) => {
            const replies = comment.replies ?? [];
            const replying = replyingToId === comment.id;
            return (
              <div key={comment.id} data-testid="comment-item" className="mb-2.5">
                <div className="flex items-start gap-2">
                  <CommentAvatar user={comment.user} size={avatarSize} onProfile={onProfile} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] leading-5">
                      <CommentAuthor user={comment.user} onProfile={onProfile} />{" "}
                      <span className="break-words">{comment.content}</span>
                      <span className="ml-2 whitespace-nowrap text-[10px] text-muted">
                        {relativeTime(comment.createdAt)}
                      </span>
                      {onReply ? (
                        <>
                          {" "}
                          <button
                            type="button"
                            data-testid="reply-toggle"
                            onClick={() => (replying ? cancelReply() : openReply(comment))}
                            className="whitespace-nowrap text-[10px] font-medium text-[#6572D8]"
                          >
                            回复
                          </button>
                        </>
                      ) : null}
                      {renderActions(comment)}
                    </p>

                    {/* An empty reply container is never rendered, so a thread
                        without replies looks exactly as it did before. */}
                    {replies.length > 0 ? (
                      <div data-testid="reply-list" className="mt-1.5 space-y-1.5 border-l border-line pl-2.5">
                        {replies.map((reply) => (
                          <div key={reply.id} data-testid="reply-item" className="flex items-start gap-2">
                            <CommentAvatar user={reply.user} size={avatarSize} onProfile={onProfile} />
                            <p className="min-w-0 flex-1 text-[12px] leading-5">
                              <CommentAuthor user={reply.user} onProfile={onProfile} />{" "}
                              <span className="break-words">{reply.content}</span>
                              <span className="ml-2 whitespace-nowrap text-[10px] text-muted">
                                {relativeTime(reply.createdAt)}
                              </span>
                              {renderActions(reply, "reply")}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {replying ? (
                      <div data-testid="reply-composer" className="mt-2">
                        <p className="mb-1 break-words text-[11px] text-muted">
                          回复 {comment.user.nickname ?? "用户"}
                        </p>
                        <div className="flex items-center gap-2">
                          <input
                            value={replyDraft}
                            onChange={(event) => setReplyDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") void sendReply(comment);
                              if (event.key === "Escape") cancelReply();
                            }}
                            placeholder={`回复 ${comment.user.nickname ?? "用户"}…`}
                            maxLength={500}
                            aria-label={`回复 ${comment.user.nickname ?? "用户"}`}
                            className="h-9 min-w-0 flex-1 rounded-full border border-line bg-white px-3 text-[12px] outline-none focus:ring-2 focus:ring-indigo-200"
                          />
                          <button
                            type="button"
                            onClick={cancelReply}
                            data-testid="reply-cancel"
                            className="h-9 shrink-0 rounded-full border border-line px-3 text-[12px] text-[#3D4663]"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={() => void sendReply(comment)}
                            disabled={replyDraft.trim().length === 0 || replySending}
                            data-testid="reply-send"
                            className="h-9 shrink-0 rounded-full bg-[#6572D8] px-4 text-[12px] text-white disabled:opacity-50"
                          >
                            {replySending ? "发送中…" : "发送"}
                          </button>
                        </div>
                        {replyError ? (
                          <p data-testid="reply-error" role="alert" className="mt-1 break-words text-[11px] text-red-600">
                            {replyError}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* PC-2.4 — only the paginated surface passes `onLoadMore`; the feed
          keeps its short thread and therefore never shows this control. */}
      {!loading && onLoadMore && visible.length > 0 ? (
        <div className="mb-2.5">
          {hasMore ? (
            <button
              type="button"
              data-testid="comment-load-more"
              onClick={onLoadMore}
              disabled={loadingMore}
              className="mx-auto block rounded-full border border-line bg-white px-4 py-1.5 text-[11px] text-[#3D4663] disabled:opacity-60"
            >
              {loadingMore ? "正在加载…" : "加载更多"}
            </button>
          ) : (
            <p data-testid="comment-no-more" className="text-center text-[11px] text-muted">
              不再有更多评论
            </p>
          )}
        </div>
      ) : null}

      {!loading && visible.length === 0 ? (
        <p data-testid="comment-empty" className="mb-2 text-[11px] text-muted">
          还没有评论，成为第一个留言的人吧。
        </p>
      ) : null}

      {error ? (
        <p data-testid="comment-error" role="alert" className="mb-2 break-words text-[11px] text-red-600">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSend();
          }}
          placeholder="说点什么…"
          maxLength={500}
          aria-label="写评论"
          className="h-9 min-w-0 flex-1 rounded-full border border-line bg-white px-3 text-[12px] outline-none focus:ring-2 focus:ring-indigo-200"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          data-testid="comment-send"
          className="h-9 shrink-0 rounded-full bg-[#6572D8] px-4 text-[12px] text-white disabled:opacity-50"
        >
          {sending ? "发送中…" : "发送"}
        </button>
      </div>

      {/* The confirmation lives outside the list so it is not clipped by the
          scroller; the overlay is the phone screen, never a scaled-down desktop
          dialog. Nothing is removed until the API confirms it. */}
      {confirmingId ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-5">
          <div className="w-full max-w-[320px] rounded-3xl bg-white p-5 text-center shadow-xl">
            <p className="text-[13px] font-semibold">删除这条评论？</p>
            <p className="mt-1 text-[11px] text-muted">如果这是一级评论，其回复也会一并删除。</p>
            {deleteError ? (
              <p data-testid="comment-delete-error" role="alert" className="mt-2 break-words text-[11px] text-red-600">
                {deleteError}
              </p>
            ) : null}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                data-testid="comment-delete-cancel"
                onClick={cancelDelete}
                className="h-9 min-w-0 flex-1 rounded-full border border-line text-[12px] text-[#3D4663]"
              >
                取消
              </button>
              <button
                type="button"
                data-testid="comment-delete-confirm"
                disabled={deletingId !== null}
                onClick={() => {
                  const target = findTarget(confirmingId);
                  if (target) void confirmDelete(target.comment, target.parentId);
                }}
                className="h-9 min-w-0 flex-1 rounded-full bg-red-600 text-[12px] text-white disabled:opacity-60"
              >
                {deletingId ? "删除中…" : "删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
