"use client";

import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { apiFetch, apiSend } from "@/lib/api";
import { useAdminSession } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";

/**
 * 树洞管理（2026-11-13）。
 *
 * ## 与「内容审核」的区别
 *
 * 那边是**队列**：有人举报、或扫描器拦下了，等你去判断。树洞没有队列 —— 它是
 * 「大家最近都说了什么」，按时间倒序看，看到不该有的就删。所以这里没有状态筛选，
 * 也没有「通过/驳回」，只有一个删除。
 *
 * ## 为什么看得到作者
 *
 * 树洞对会员匿名，对管理员不匿名：看不到作者，「删帖」就只是把问题挪走 ——
 * 同一个人可以再发一条。这里露出的邮箱是给运营定位账号用的，别在别处复用这个形状。
 */
type Post = {
  id: string;
  alias: string;
  content: string;
  commentCount: number;
  createdAt: string;
  user: { id: string; email: string; nickname: string | null; status: string };
};

type Comment = { id: string; alias: string; content: string; createdAt: string; userId: string };

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState<string | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);

  const load = useCallback(async () => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    setError("");
    try {
      const data = await apiFetch<{ items: Post[] }>("/admin/tree-hole/posts?pageSize=50");
      setItems(data.items);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [canRead]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openComments(post: Post) {
    if (opened === post.id) {
      setOpened(null);
      return;
    }
    setOpened(post.id);
    setComments([]);
    setCommentsLoading(true);
    try {
      const data = await apiFetch<{ items: Comment[] }>(`/admin/tree-hole/posts/${post.id}/comments`);
      setComments(data.items);
    } catch {
      setError("评论加载失败");
    } finally {
      setCommentsLoading(false);
    }
  }

  async function removePost(post: Post) {
    if (!canWrite) return;
    if (!window.confirm(`删除这条树洞？\n\n${post.content.slice(0, 60)}`)) return;
    try {
      await apiSend(`/admin/tree-hole/posts/${post.id}`, "DELETE");
      setItems((current) => current.filter((item) => item.id !== post.id));
      if (opened === post.id) setOpened(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "删除失败");
    }
  }

  async function removeComment(comment: Comment) {
    if (!canWrite) return;
    if (!window.confirm("删除这条评论？")) return;
    try {
      await apiSend(`/admin/tree-hole/comments/${comment.id}`, "DELETE");
      setComments((current) => current.filter((item) => item.id !== comment.id));
      setItems((current) =>
        current.map((item) =>
          item.id === opened ? { ...item, commentCount: Math.max(0, item.commentCount - 1) } : item,
        ),
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "删除失败");
    }
  }

  if (!canRead) {
    return <p className="mx-auto max-w-4xl text-sm text-neutral-500">没有内容审核权限。</p>;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-lg font-semibold">树洞管理</h1>
          <p className="mt-1 text-xs text-neutral-500">
            匿名版，共 {items.length} 条。会员看到的是「树友·XXXX」，这里的邮箱只用于定位账号。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
        >
          刷新
        </button>
      </div>

      {error ? <p className="mb-3 text-xs text-red-600">{error}</p> : null}
      {loading ? <p className="text-sm text-neutral-500">加载中…</p> : null}
      {!loading && items.length === 0 ? (
        <p className="text-sm text-neutral-500">还没有人发言。</p>
      ) : null}

      <ul className="space-y-3">
        {items.map((post) => (
          <li key={post.id} className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex items-center justify-between text-xs text-neutral-500">
              <span className="font-medium text-neutral-700">{post.alias}</span>
              <span>{new Date(post.createdAt).toLocaleString()}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-900">{post.content}</p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-neutral-500">
              <button type="button" onClick={() => void openComments(post)} className="underline">
                {post.commentCount} 条评论 · {opened === post.id ? "收起" : "展开"}
              </button>
              <span>
                作者：{post.user.nickname ?? "（未设昵称）"} · {post.user.email} · {post.user.status}
              </span>
              {canWrite ? (
                <button
                  type="button"
                  onClick={() => void removePost(post)}
                  className="text-red-600 underline"
                >
                  删除
                </button>
              ) : null}
            </div>

            {opened === post.id ? (
              <div className="mt-3 space-y-2 border-l-2 border-neutral-200 pl-3">
                {commentsLoading ? <p className="text-xs text-neutral-500">加载评论…</p> : null}
                {!commentsLoading && comments.length === 0 ? (
                  <p className="text-xs text-neutral-500">还没有评论。</p>
                ) : null}
                {comments.map((comment) => (
                  <div key={comment.id} className="text-xs">
                    <div className="flex items-center justify-between text-neutral-500">
                      <span className="font-medium text-neutral-700">{comment.alias}</span>
                      <span>{new Date(comment.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-900">{comment.content}</p>
                    <p className="mt-1 text-neutral-500">作者 userId：{comment.userId}</p>
                    {canWrite ? (
                      <button
                        type="button"
                        onClick={() => void removeComment(comment)}
                        className="mt-1 text-red-600 underline"
                      >
                        删除评论
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
