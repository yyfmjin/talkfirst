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
 * and the owner of a comment can edit or delete it. Both are opt-in through
 * props, which is what keeps the feed card the read-only surface it has been
 * since PC-2.3.3 — the E2E suite pins that, and a control with no handler is
 * worse than no control at all. Nothing is removed or rewritten locally before
 * the API confirms it.
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
  sm: "grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-100 text-overline font-semibold text-brand-600",
  md: "grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-brand-100 text-caption font-semibold text-brand-600",
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

/**
 * Editing answers with the same codes as writing, plus the ownership refusal —
 * the one a member can actually hit, because the menu is the only thing that
 * knows whose comment this is and a hidden control is not a boundary.
 */
const EDIT_ERROR_TEXT: Record<string, string> = {
  COMMENT_FORBIDDEN: "只能修改自己的评论",
  COMMENT_NOT_FOUND: "这条评论已经不存在了",
  MOMENT_LOCKED: "你没有权限修改这条动态下的评论",
  EMPTY_COMMENT: "评论不能为空",
  CONTENT_BLOCKED: "评论包含不适当内容，已被拦截",
};

function deleteErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return DELETE_ERROR_TEXT[error.code] ?? error.message;
  return error instanceof Error ? error.message : "删除失败，请稍后重试";
}

function editErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return EDIT_ERROR_TEXT[error.code] ?? error.message;
  return error instanceof Error ? error.message : "修改失败，请稍后重试";
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

/**
 * PC-2.4 — the inline editor, shared by a top-level comment and a reply.
 *
 * Both levels used to carry their own copy of this markup with the same
 * classes, the same max length and the same two buttons; only the `submitEdit`
 * argument differed. One implementation means a member editing either level
 * gets the same Enter / Escape handling, and the testids below address both
 * without the caller having to know which level it is looking at.
 */
function CommentEditor({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string;
}) {
  return (
    <div data-testid="comment-edit-form" className="mt-1 flex flex-col gap-1.5 rounded-control border border-border bg-surface p-2 shadow-card">
      <input
        type="text"
        data-testid="comment-edit-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onSave();
          if (event.key === "Escape") onCancel();
        }}
        aria-label="修改评论"
        className="w-full rounded-control border border-border px-2.5 py-1 text-caption text-content focus:border-brand-500 focus:outline-none"
        maxLength={500}
        autoFocus
      />
      {error ? (
        <span data-testid="comment-edit-error" role="alert" className="break-words text-overline text-danger-600">
          {error}
        </span>
      ) : null}
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          data-testid="comment-edit-cancel"
          onClick={onCancel}
          disabled={saving}
          className="rounded-control px-2 py-0.5 text-overline text-content-muted hover:bg-surface-sunken disabled:opacity-50"
        >
          取消
        </button>
        <button
          type="button"
          data-testid="comment-edit-save"
          onClick={onSave}
          disabled={saving || !value.trim()}
          className="rounded-control bg-brand-500 px-2.5 py-0.5 text-overline font-medium text-white disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  );
}

export function MomentComments({
  comments,
  draft,
  onDraft,
  onSend,
  onReply,
  onDelete,
  onEdit,
  onReport,
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
  /** Optional handler to update comment content. */
  onEdit?: (comment: MomentComment, newContent: string, parentId?: string) => Promise<void>;
  /**
   * C2 — 举报**别人**的评论。
   *
   * 省略它则别人的评论不出现任何菜单；动态卡片（只读表面）就是这样传的。
   */
  onReport?: (comment: MomentComment) => void;
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

  // Edit comment state
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // PC-2.4 — the menu, the confirmation and the in-flight delete are separate
  // so the dialog can stay open on a rejection and report why.
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");

  function startEdit(comment: MomentComment) {
    setMenuOpenId(null);
    setEditingCommentId(comment.id);
    setEditDraft(comment.content);
    setEditError("");
  }

  function cancelEdit() {
    setEditingCommentId(null);
    setEditDraft("");
    setEditError("");
  }

  async function submitEdit(comment: MomentComment, parentId?: string) {
    const trimmed = editDraft.trim();
    if (!onEdit || !trimmed || editSaving) return;
    setEditSaving(true);
    setEditError("");
    try {
      // The caller owns the write and the state it updates, so a rejection
      // arrives here as a thrown error and the editor stays open with the draft
      // intact — nothing is changed locally before the API answered.
      await onEdit(comment, trimmed, parentId);
      setEditingCommentId(null);
    } catch (requestError) {
      setEditError(editErrorMessage(requestError));
    } finally {
      setEditSaving(false);
    }
  }

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
   * 一个动作菜单，一级评论与回复共用。
   *
   * C2 之后它服务两种**互斥**的情形：
   *   · 自己的评论 → 编辑 / 删除（需要 `onDelete` / `onEdit`）
   *   · 别人的评论 → 举报（需要 `onReport`）
   * 两者都不满足时什么都不渲染，所以只读表面（动态卡片）仍然不会出现
   * 没有处理函数的入口 —— 原始的克制在这里保住了。
   */
  function renderActions(comment: MomentComment, level: "comment" | "reply" = "comment") {
    if (!currentUserId) return null;
    const isMine = comment.user.id === currentUserId;
    const canManage = isMine && Boolean(onDelete || onEdit);
    const canReport = !isMine && Boolean(onReport);
    if (!canManage && !canReport) return null;
    const open = menuOpenId === comment.id;
    return (
      <span className="relative inline-block align-middle">
        <button
          type="button"
          data-testid={`${level}-menu`}
          aria-label="评论菜单"
          onClick={() => setMenuOpenId(open ? null : comment.id)}
          className="ml-1.5 whitespace-nowrap rounded-control px-1 align-middle text-caption leading-none text-content-muted transition-colors duration-instant hover:bg-surface-sunken"
        >
          ⋯
        </button>
        {open ? (
          <span className="absolute right-0 top-4 z-20 flex flex-col overflow-hidden rounded-control border border-border bg-surface shadow-overlay">
            {canReport ? (
              <button
                type="button"
                data-testid={`${level}-report`}
                onClick={() => {
                  // 先关菜单再抛出去：弹窗是另一层遮罩，留着一个展开的菜单在下面
                  // 只会让两种浮层叠在一起。
                  setMenuOpenId(null);
                  onReport?.(comment);
                }}
                className="whitespace-nowrap px-3 py-1.5 text-left text-caption text-content hover:bg-surface-sunken"
              >
                举报
              </button>
            ) : null}
            {canManage && onEdit ? (
              <button
                type="button"
                data-testid={`${level}-edit`}
                onClick={() => startEdit(comment)}
                className="whitespace-nowrap px-3 py-1.5 text-left text-caption text-content hover:bg-surface-sunken"
              >
                编辑
              </button>
            ) : null}
            {canManage && onDelete ? (
              <button
                type="button"
                data-testid={`${level}-delete`}
                onClick={() => askDelete(comment.id)}
                className="whitespace-nowrap px-3 py-1.5 text-left text-caption text-danger-600 hover:bg-surface-sunken"
              >
                删除
              </button>
            ) : null}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <section data-testid={testId} className="min-w-0">
      {title ? (
        <p data-testid="comment-count" className="mb-2.5 text-caption font-semibold text-content-muted">
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
            const isEditing = editingCommentId === comment.id;
            return (
              <div key={comment.id} data-testid="comment-item" className="mb-2.5">
                <div className="flex items-start gap-2">
                  <CommentAvatar user={comment.user} size={avatarSize} onProfile={onProfile} />
                  <div className="min-w-0 flex-1">
                    <p className="text-caption leading-5 text-content">
                      <CommentAuthor user={comment.user} onProfile={onProfile} />{" "}
                      {!isEditing ? (
                        <span className="break-words">{comment.content}</span>
                      ) : null}
                      <span className="ml-2 whitespace-nowrap text-overline text-content-subtle">
                        {relativeTime(comment.createdAt)}
                      </span>
                      {onReply ? (
                        <>
                          {" "}
                          <button
                            type="button"
                            data-testid="reply-toggle"
                            onClick={() => (replying ? cancelReply() : openReply(comment))}
                            className="whitespace-nowrap text-overline font-medium text-brand-600"
                          >
                            回复
                          </button>
                        </>
                      ) : null}
                      {renderActions(comment)}
                    </p>

                    {isEditing ? (
                      <CommentEditor
                        value={editDraft}
                        onChange={setEditDraft}
                        onSave={() => void submitEdit(comment)}
                        onCancel={cancelEdit}
                        saving={editSaving}
                        error={editError}
                      />
                    ) : null}

                    {/* An empty reply container is never rendered, so a thread
                        without replies looks exactly as it did before. */}
                    {replies.length > 0 ? (
                      <div data-testid="reply-list" className="mt-1.5 space-y-1.5 border-l border-border pl-2.5">
                        {replies.map((reply) => {
                          const isReplyEditing = editingCommentId === reply.id;
                          return (
                            <div key={reply.id} data-testid="reply-item" className="flex items-start gap-2">
                              <CommentAvatar user={reply.user} size={avatarSize} onProfile={onProfile} />
                              <div className="min-w-0 flex-1">
                                <p className="text-caption leading-5 text-content">
                                  <CommentAuthor user={reply.user} onProfile={onProfile} />{" "}
                                  {!isReplyEditing ? (
                                    <span className="break-words">{reply.content}</span>
                                  ) : null}
                                  <span className="ml-2 whitespace-nowrap text-overline text-content-subtle">
                                    {relativeTime(reply.createdAt)}
                                  </span>
                                  {renderActions(reply, "reply")}
                                </p>

                                {isReplyEditing ? (
                                  <CommentEditor
                                    value={editDraft}
                                    onChange={setEditDraft}
                                    onSave={() => void submitEdit(reply, comment.id)}
                                    onCancel={cancelEdit}
                                    saving={editSaving}
                                    error={editError}
                                  />
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    {replying ? (
                      <div data-testid="reply-composer" className="mt-2">
                        <p className="mb-1 break-words text-overline text-content-muted">
                          回复 {comment.user.nickname ?? "用户"}
                        </p>
                        <div className="flex items-center gap-2">
                          {/* Geometry deliberately unchanged: `chat-composer.spec`-style
                              measurements and `moment-detail.spec`'s reply-composer
                              bounding-box assertions both read this row. */}
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
                            className="h-9 min-w-0 flex-1 rounded-control border border-border bg-surface px-3 text-caption text-content outline-none transition-colors duration-instant focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
                          />
                          <button
                            type="button"
                            onClick={cancelReply}
                            data-testid="reply-cancel"
                            className="h-9 shrink-0 rounded-control border border-border px-3 text-caption text-content-muted transition-colors duration-instant hover:bg-surface-sunken"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={() => void sendReply(comment)}
                            disabled={replyDraft.trim().length === 0 || replySending}
                            data-testid="reply-send"
                            className="h-9 shrink-0 rounded-control bg-brand-500 px-4 text-caption font-medium text-white transition-colors duration-instant hover:bg-brand-600 disabled:opacity-50"
                          >
                            {replySending ? "发送中…" : "发送"}
                          </button>
                        </div>
                        {replyError ? (
                          <p data-testid="reply-error" role="alert" className="mt-1 break-words text-overline text-danger-600">
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
              className="mx-auto block rounded-control border border-border bg-surface px-4 py-1.5 text-overline text-content-muted transition-colors duration-instant hover:bg-surface-sunken disabled:opacity-60"
            >
              {loadingMore ? "正在加载…" : "加载更多"}
            </button>
          ) : (
            <p data-testid="comment-no-more" className="text-center text-overline text-content-subtle">
              不再有更多评论
            </p>
          )}
        </div>
      ) : null}

      {!loading && visible.length === 0 ? (
        <p data-testid="comment-empty" className="mb-2 text-overline text-content-muted">
          还没有评论，成为第一个留言的人吧。
        </p>
      ) : null}

      {error ? (
        <p data-testid="comment-error" role="alert" className="mb-2 break-words text-overline text-danger-600">
          {error}
        </p>
      ) : null}

      {/* The `aria-label="写评论"` is the accessible name `moment-detail.spec.ts`
          uses to address this composer, so it stays. */}
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
          className="h-9 min-w-0 flex-1 rounded-control border border-border bg-surface px-3 text-caption text-content outline-none transition-colors duration-instant focus:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200"
        />
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          data-testid="comment-send"
          className="h-9 shrink-0 rounded-control bg-brand-500 px-4 text-caption font-medium text-white transition-colors duration-instant hover:bg-brand-600 disabled:opacity-50"
        >
          {sending ? "发送中…" : "发送"}
        </button>
      </div>

      {/* The confirmation lives outside the list so it is not clipped by the
          scroller; the overlay is the phone screen, never a scaled-down desktop
          dialog. Nothing is removed until the API confirms it.

          Phase B: `absolute`, not `fixed`. `fixed` positions against the viewport,
          so on a desktop width this 320px confirmation was centred on the whole
          monitor and detached from the device frame (the six sibling overlays in
          this app already used `absolute`). The scrim colour comes from the
          `surface-scrim` token so every overlay in the product dims the same
          amount. */}
      {confirmingId ? (
        <div className="absolute inset-0 z-50 grid place-items-center bg-surface-scrim p-5">
          <div className="w-full max-w-[320px] rounded-sheet bg-surface p-5 text-center shadow-overlay">
            <p className="text-heading font-semibold text-content">删除这条评论？</p>
            <p className="mt-1 text-caption text-content-muted">如果这是一级评论，其回复也会一并删除。</p>
            {deleteError ? (
              <p data-testid="comment-delete-error" role="alert" className="mt-2 break-words text-caption text-danger-600">
                {deleteError}
              </p>
            ) : null}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                data-testid="comment-delete-cancel"
                onClick={cancelDelete}
                className="h-9 min-w-0 flex-1 rounded-control border border-border text-caption text-content-muted transition-colors duration-instant hover:bg-surface-sunken"
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
