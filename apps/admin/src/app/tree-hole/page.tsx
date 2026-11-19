"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { apiFetch, apiSend } from "@/lib/api";
import { useAdminSession } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";

/**
 * 树洞管理（2026-11-13；编辑 / 删除留痕 / 恢复 2026-11-18）。
 *
 * ## 这一页能做什么
 *
 * - 看：按「正常 / 已删除 / 全部」筛，按「有举报」筛；
 * - 改：直接改帖子和评论的正文（旧版本进修改记录，不是丢掉）；
 * - 删：软删 —— 行留在库里，可以按「已删除」翻出来、也能恢复；
 * - 处置举报：标成已处理，内容不动。
 *
 * ## 为什么删除不真删、编辑要留痕
 *
 * 匿名板的审核必须能回答两个问题：**谁在什么时候把什么拿掉了**、**他原来写的是什么**。
 * 硬删和「改完就当没改过」都回答不了。所以：
 * - 删除 = `deletedAt` + `deletedBy`，列表默认不显示、但能筛出来；
 * - 编辑 = 旧内容进 `TreeHoleRevision`，界面上标「已编辑」。
 *
 * ## 为什么看得到作者
 *
 * 树洞对会员匿名，对管理员不匿名：看不到作者，「删帖」就只是把问题挪走 ——
 * 同一个人可以再发一条。这里的邮箱只用于定位账号，别在别处复用这个形状。
 */
type Post = {
  id: string;
  alias: string;
  content: string;
  commentCount: number;
  createdAt: string;
  deletedAt: string | null;
  editedAt: string | null;
  reportCount: number;
  reportReasons: string[];
  user: { id: string; email: string; nickname: string | null; status: string };
};

type Comment = {
  id: string;
  alias: string;
  content: string;
  createdAt: string;
  userId: string;
  deletedAt: string | null;
  editedAt: string | null;
  reportCount: number;
};

type Revision = { id: string; content: string; editorId: string | null; createdAt: string };
type Status = "active" | "deleted" | "all";

/** 举报理由的服务端代码 → 给人看的标签。 */
const REASON_LABELS: Record<string, string> = {
  HARASSMENT: "辱骂攻击",
  SEXUAL: "色情低俗",
  SPAM: "广告引流",
  ILLEGAL: "违法内容",
  OTHER: "其他",
};
const REASON_ORDER = ["HARASSMENT", "SEXUAL", "SPAM", "ILLEGAL", "OTHER"];

function reasonsText(codes: string[]): string {
  const sorted = [...codes].sort(
    (a, b) => (REASON_ORDER.indexOf(a) + 1 || 99) - (REASON_ORDER.indexOf(b) + 1 || 99),
  );
  return sorted.map((code) => REASON_LABELS[code] ?? code).join("、");
}

const STATUS_TABS: Array<{ key: Status; label: string }> = [
  { key: "active", label: "正常" },
  { key: "deleted", label: "已删除" },
  { key: "all", label: "全部" },
];

export default function TreeHoleAdminPage() {
  return (
    <Shell>
      <Screen />
    </Shell>
  );
}

function Screen() {
  const { identity } = useAdminSession();
  const canRead = Boolean(identity && hasPermission(identity.role, "moderation:read"));
  const canWrite = Boolean(identity && hasPermission(identity.role, "moderation:write"));

  const [items, setItems] = useState<Post[]>([]);
  const [reportedTotal, setReportedTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [reportedOnly, setReportedOnly] = useState(false);
  const [status, setStatus] = useState<Status>("active");
  const [acting, setActing] = useState<string | null>(null);
  /** 正在编辑的目标：`post:<id>` 或 `comment:<id>`。 */
  const [editing, setEditing] = useState<{ key: string; kind: "post" | "comment"; id: string; text: string } | null>(
    null,
  );
  /** 修改记录，按目标缓存：`post:<id>` / `comment:<id>`。 */
  const [revisions, setRevisions] = useState<{ key: string; items: Revision[] } | null>(null);

  const load = useCallback(async () => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const query = `?pageSize=50${reportedOnly ? "&reported=1" : ""}${
        status === "active" ? "" : `&status=${status}`
      }`;
      const data = await apiFetch<{ items: Post[]; reportedTotal: number }>(
        `/admin/tree-hole/posts${query}`,
      );
      setItems(data.items);
      setReportedTotal(data.reportedTotal ?? 0);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [canRead, reportedOnly, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const reloadComments = useCallback(async (postId: string) => {
    const data = await apiFetch<{ items: Comment[] }>(`/admin/tree-hole/posts/${postId}/comments`);
    setComments(data.items);
  }, []);

  async function openComments(post: Post) {
    if (opened === post.id) {
      setOpened(null);
      return;
    }
    setOpened(post.id);
    setComments([]);
    setCommentsLoading(true);
    try {
      await reloadComments(post.id);
    } catch {
      setError("评论加载失败");
    } finally {
      setCommentsLoading(false);
    }
  }

  async function removePost(post: Post) {
    if (!canWrite) return;
    if (!window.confirm(`删除这条树洞？\n\n${post.content.slice(0, 60)}\n\n（软删：记录保留，可恢复）`)) return;
    setActing(post.id);
    try {
      await apiSend(`/admin/tree-hole/posts/${post.id}`, "DELETE");
      await load();
      if (opened === post.id) setOpened(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "删除失败");
    } finally {
      setActing(null);
    }
  }

  async function restorePost(post: Post) {
    if (!canWrite) return;
    setActing(post.id);
    try {
      await apiSend(`/admin/tree-hole/posts/${post.id}/restore`, "POST");
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "恢复失败");
    } finally {
      setActing(null);
    }
  }

  async function removeComment(comment: Comment) {
    if (!canWrite) return;
    if (!window.confirm("删除这条评论？（软删，可恢复）")) return;
    setActing(comment.id);
    try {
      await apiSend(`/admin/tree-hole/comments/${comment.id}`, "DELETE");
      await load();
      if (opened) await reloadComments(opened);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "删除失败");
    } finally {
      setActing(null);
    }
  }

  async function restoreComment(comment: Comment) {
    if (!canWrite) return;
    setActing(comment.id);
    try {
      await apiSend(`/admin/tree-hole/comments/${comment.id}/restore`, "POST");
      await load();
      if (opened) await reloadComments(opened);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "恢复失败");
    } finally {
      setActing(null);
    }
  }

  async function resolveReports(target: { postId?: string; commentId?: string }, key: string) {
    if (!canWrite) return;
    setActing(key);
    try {
      await apiSend(`/admin/tree-hole/reports/resolve`, "POST", target);
      await load();
      if (target.postId && opened === target.postId) await reloadComments(target.postId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "处置失败");
    } finally {
      setActing(null);
    }
  }

  async function saveEdit() {
    if (!canWrite || !editing) return;
    const text = editing.text.trim();
    if (!text) {
      setError("内容不能为空");
      return;
    }
    setActing(editing.key);
    try {
      const path =
        editing.kind === "post"
          ? `/admin/tree-hole/posts/${editing.id}`
          : `/admin/tree-hole/comments/${editing.id}`;
      await apiSend(path, "PATCH", { content: text });
      setEditing(null);
      await load();
      if (opened) await reloadComments(opened);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存失败");
    } finally {
      setActing(null);
    }
  }

  async function toggleRevisions(kind: "post" | "comment", id: string) {
    const key = `${kind}:${id}`;
    if (revisions?.key === key) {
      setRevisions(null);
      return;
    }
    try {
      const query = kind === "post" ? `postId=${id}` : `commentId=${id}`;
      const data = await apiFetch<{ items: Revision[] }>(`/admin/tree-hole/revisions?${query}`);
      setRevisions({ key, items: data.items });
    } catch {
      setError("修改记录加载失败");
    }
  }

  if (!canRead) {
    return <p className="mx-auto max-w-4xl text-sm text-neutral-500">没有内容审核权限。</p>;
  }

  const editBox = (kind: "post" | "comment", id: string) => {
    if (editing?.key !== `${kind}:${id}`) return null;
    return (
      <div className="mt-2">
        <textarea
          value={editing.text}
          onChange={(event) => setEditing({ ...editing, text: event.target.value })}
          rows={4}
          maxLength={kind === "post" ? 500 : 300}
          className="w-full rounded-md border border-neutral-300 p-2 text-sm"
        />
        <div className="mt-1 flex items-center gap-3 text-xs">
          <button
            type="button"
            disabled={acting === editing.key}
            onClick={() => void saveEdit()}
            className="rounded bg-neutral-900 px-3 py-1 text-white disabled:opacity-50"
          >
            保存
          </button>
          <button type="button" onClick={() => setEditing(null)} className="underline">
            取消
          </button>
          <span className="text-neutral-500">
            {editing.text.length} / {kind === "post" ? 500 : 300}
          </span>
        </div>
      </div>
    );
  };

  const revisionList = (kind: "post" | "comment", id: string) => {
    if (revisions?.key !== `${kind}:${id}`) return null;
    if (revisions.items.length === 0) {
      return <p className="mt-2 text-xs text-neutral-500">没有修改记录。</p>;
    }
    return (
      <ul className="mt-2 space-y-1 border-l-2 border-amber-200 pl-3 text-xs text-neutral-600">
        {revisions.items.map((revision) => (
          <li key={revision.id}>
            <span className="text-neutral-400">{new Date(revision.createdAt).toLocaleString()}</span>
            <span className="ml-2 whitespace-pre-wrap">{revision.content}</span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">树洞管理</h1>
          <p className="mt-1 text-xs text-neutral-500">
            共 {items.length} 条
            {reportedTotal > 0 ? `，其中 ${reportedTotal} 条有举报待处置` : "，没有待处置的举报"}。
            删除是软删：记录保留，可在「已删除」里找到并恢复。
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-neutral-300 text-xs">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                aria-pressed={status === tab.key}
                onClick={() => setStatus(tab.key)}
                className={`px-2.5 py-1.5 ${
                  status === tab.key ? "bg-neutral-900 text-white" : "hover:bg-neutral-50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={reportedOnly}
            onClick={() => setReportedOnly((value) => !value)}
            className={`rounded-md border px-3 py-1.5 text-xs ${
              reportedOnly
                ? "border-amber-500 bg-amber-50 text-amber-800"
                : "border-neutral-300 hover:bg-neutral-50"
            }`}
          >
            {reportedOnly ? "只看有举报 ✓" : "只看有举报"}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
          >
            刷新
          </button>
        </div>
      </div>

      {error ? <p className="mb-3 text-xs text-red-600">{error}</p> : null}
      {loading ? <p className="text-sm text-neutral-500">加载中…</p> : null}
      {!loading && items.length === 0 ? (
        <p className="text-sm text-neutral-500">
          {status === "deleted" ? "没有被删除的内容。" : reportedOnly ? "没有待处置的举报。" : "还没有人发言。"}
        </p>
      ) : null}

      <ul className="space-y-3">
        {items.map((post) => {
          const reported = post.reportCount > 0;
          const deleted = Boolean(post.deletedAt);
          return (
            <li
              key={post.id}
              className={`rounded-lg border bg-white p-4 ${
                deleted
                  ? "border-neutral-200 bg-neutral-50 opacity-80"
                  : reported
                    ? "border-amber-300"
                    : "border-neutral-200"
              }`}
            >
              <div className="flex items-center justify-between text-xs text-neutral-500">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-neutral-700">{post.alias}</span>
                  {deleted ? (
                    <span className="rounded-full bg-neutral-200 px-2 py-0.5 font-medium text-neutral-700">
                      已删除 {new Date(post.deletedAt as string).toLocaleString()}
                    </span>
                  ) : null}
                  {post.editedAt ? (
                    <span className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-800">
                      已编辑
                    </span>
                  ) : null}
                  {reported ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                      举报 {post.reportCount}
                      {post.reportReasons.length > 0 ? ` · ${reasonsText(post.reportReasons)}` : ""}
                    </span>
                  ) : null}
                </span>
                <span>{new Date(post.createdAt).toLocaleString()}</span>
              </div>

              <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-900">{post.content}</p>
              {editBox("post", post.id)}
              {revisionList("post", post.id)}

              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
                <button type="button" onClick={() => void openComments(post)} className="underline">
                  {post.commentCount} 条评论 · {opened === post.id ? "收起" : "展开"}
                </button>
                <span>
                  作者：{post.user.nickname ?? "（未设昵称）"} · {post.user.email} · {post.user.status}
                </span>
                {canWrite && !deleted ? (
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({ key: `post:${post.id}`, kind: "post", id: post.id, text: post.content })
                    }
                    className="text-neutral-700 underline"
                  >
                    编辑
                  </button>
                ) : null}
                {post.editedAt ? (
                  <button
                    type="button"
                    onClick={() => void toggleRevisions("post", post.id)}
                    className="text-sky-700 underline"
                  >
                    修改记录
                  </button>
                ) : null}
                {canWrite && reported ? (
                  <button
                    type="button"
                    disabled={acting === post.id}
                    onClick={() => void resolveReports({ postId: post.id }, post.id)}
                    className="text-amber-700 underline disabled:opacity-50"
                  >
                    举报已处置
                  </button>
                ) : null}
                {canWrite && !deleted ? (
                  <button
                    type="button"
                    disabled={acting === post.id}
                    onClick={() => void removePost(post)}
                    className="text-red-600 underline disabled:opacity-50"
                  >
                    删除
                  </button>
                ) : null}
                {canWrite && deleted ? (
                  <button
                    type="button"
                    disabled={acting === post.id}
                    onClick={() => void restorePost(post)}
                    className="text-emerald-700 underline disabled:opacity-50"
                  >
                    恢复
                  </button>
                ) : null}
              </div>

              {opened === post.id ? (
                <div className="mt-3 space-y-2 border-l-2 border-neutral-200 pl-3">
                  {commentsLoading ? <p className="text-xs text-neutral-500">加载评论…</p> : null}
                  {!commentsLoading && comments.length === 0 ? (
                    <p className="text-xs text-neutral-500">还没有评论。</p>
                  ) : null}
                  {comments.map((comment) => {
                    const commentDeleted = Boolean(comment.deletedAt);
                    return (
                      <div
                        key={comment.id}
                        className={`text-xs ${commentDeleted ? "opacity-60" : ""}`}
                      >
                        <div className="flex items-center justify-between text-neutral-500">
                          <span className="flex items-center gap-2 font-medium text-neutral-700">
                            {comment.alias}
                            {commentDeleted ? (
                              <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-neutral-700">
                                已删除
                              </span>
                            ) : null}
                            {comment.editedAt ? (
                              <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-800">
                                已编辑
                              </span>
                            ) : null}
                            {comment.reportCount > 0 ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
                                举报 {comment.reportCount}
                              </span>
                            ) : null}
                          </span>
                          <span>{new Date(comment.createdAt).toLocaleString()}</span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-900">
                          {comment.content}
                        </p>
                        {editBox("comment", comment.id)}
                        {revisionList("comment", comment.id)}
                        <p className="mt-1 text-neutral-500">作者 userId：{comment.userId}</p>
                        <div className="mt-1 flex flex-wrap gap-3">
                          {canWrite && !commentDeleted ? (
                            <button
                              type="button"
                              onClick={() =>
                                setEditing({
                                  key: `comment:${comment.id}`,
                                  kind: "comment",
                                  id: comment.id,
                                  text: comment.content,
                                })
                              }
                              className="text-neutral-700 underline"
                            >
                              编辑
                            </button>
                          ) : null}
                          {comment.editedAt ? (
                            <button
                              type="button"
                              onClick={() => void toggleRevisions("comment", comment.id)}
                              className="text-sky-700 underline"
                            >
                              修改记录
                            </button>
                          ) : null}
                          {canWrite && comment.reportCount > 0 ? (
                            <button
                              type="button"
                              disabled={acting === comment.id}
                              onClick={() => void resolveReports({ commentId: comment.id }, comment.id)}
                              className="text-amber-700 underline disabled:opacity-50"
                            >
                              举报已处置
                            </button>
                          ) : null}
                          {canWrite && !commentDeleted ? (
                            <button
                              type="button"
                              disabled={acting === comment.id}
                              onClick={() => void removeComment(comment)}
                              className="text-red-600 underline disabled:opacity-50"
                            >
                              删除评论
                            </button>
                          ) : null}
                          {canWrite && commentDeleted ? (
                            <button
                              type="button"
                              disabled={acting === comment.id}
                              onClick={() => void restoreComment(comment)}
                              className="text-emerald-700 underline disabled:opacity-50"
                            >
                              恢复评论
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
