"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "@/components/shell";
import { ApiRequestError, apiFetch, apiSend } from "@/lib/api";
import { useAdminSession } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";

/**
 * 内容审核 — the moment moderation queue.
 *
 * ## Why this is a separate screen from 审核工作台
 *
 * 审核工作台 reads the *reports* endpoint: a member's claim that something is wrong.
 * This reads moments the **scanner** flagged, before any member has seen them. The two
 * have different sources, different urgency and different actions, and merging them would
 * mean an operator cannot tell "someone complained" from "we withheld this ourselves".
 *
 * ## Why the row shows the scanner's reasons
 *
 * Without them the reviewer sees only a flagged post and has to guess what tripped it,
 * which turns a twenty-second decision into a re-reading of the content. They are shown to
 * the reviewer only — `reviewReasons` is never part of a member-facing response.
 *
 * ## Why hide and reject are separate buttons
 *
 * Reject refuses content that was never public; hide withdraws content that was. The
 * distinction is what makes the audit trail readable later, and it is not inferable after
 * the fact — so the operator has to state it.
 */

type QueueItem = {
  id: string;
  userId: string;
  content: string;
  images: string[];
  videoUrl: string | null;
  tags: string[];
  source: string;
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED" | "HIDDEN";
  reviewReasons: string[];
  createdAt: string;
  user: { id: string; nickname: string | null; email: string; status: string } | null;
};

type ListResponse = {
  items: QueueItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  status: string;
};

const STATUS_TABS: Array<{ value: string; label: string }> = [
  { value: "PENDING", label: "待审核" },
  { value: "APPROVED", label: "已通过" },
  { value: "REJECTED", label: "已拒绝" },
  { value: "HIDDEN", label: "已下架" },
];

export default function MomentModerationPage() {
  return (
    <Shell>
      <MomentModerationScreen />
    </Shell>
  );
}

function MomentModerationScreen() {
  const { identity } = useAdminSession();
  const canRead = Boolean(identity && hasPermission(identity.role, "moderation:read"));
  const canWrite = Boolean(identity && hasPermission(identity.role, "moderation:write"));

  const [items, setItems] = useState<QueueItem[]>([]);
  const [status, setStatus] = useState("PENDING");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<ListResponse>(`/admin/moments/queue?status=${status}`);
      setItems(data.items);
    } catch (requestError) {
      setError(friendlyError(requestError));
    } finally {
      setLoading(false);
    }
  }, [canRead, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(item: QueueItem, action: "approve" | "reject" | "hide") {
    setBusyId(item.id);
    setError("");
    setNotice("");
    try {
      const reason = (reasons[item.id] ?? "").trim();
      await apiSend(`/admin/moments/${item.id}/review`, "POST", {
        action,
        ...(reason ? { reason } : {}),
      });
      setReasons((current) => ({ ...current, [item.id]: "" }));
      setNotice(action === "approve" ? "已通过" : action === "reject" ? "已拒绝" : "已下架");
      await load();
    } catch (requestError) {
      setError(friendlyError(requestError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-[20px] font-semibold">内容审核</h1>
      <p className="mt-1 text-[13px] text-muted">
        系统在发布时自动标记的内容。通过后立即对所有成员可见；拒绝表示从未公开过；下架用于撤回已经公开的动态。
      </p>

      {notice ? (
        <p data-testid="moment-moderation-notice" className="mt-3 text-[13px] text-success-ink">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p data-testid="moment-moderation-error" className="mt-3 text-[13px] text-red-500">
          {error}
        </p>
      ) : null}

      {!canRead ? (
        <p data-testid="moment-moderation-forbidden" className="mt-5 text-[13px] text-muted">
          你的角色没有查看内容审核队列的权限。
        </p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="审核状态">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                data-testid={`moment-queue-tab-${tab.value}`}
                aria-pressed={status === tab.value}
                onClick={() => setStatus(tab.value)}
                className={
                  status === tab.value
                    ? "h-9 rounded-xl bg-primary-ink px-3 text-[13px] font-medium text-white"
                    : "h-9 rounded-xl border border-line px-3 text-[13px] text-muted"
                }
              >
                {tab.label}
              </button>
            ))}
          </div>

          {loading ? (
            <p data-testid="moment-queue-loading" className="mt-6 text-[13px] text-muted">
              加载中…
            </p>
          ) : items.length === 0 ? (
            <p data-testid="moment-queue-empty" className="mt-6 text-[13px] text-muted">
              {status === "PENDING" ? "队列已清空，当前没有待审内容。" : "该状态下没有内容。"}
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {items.map((item) => (
                <li
                  key={item.id}
                  data-testid={`moment-queue-item-${item.id}`}
                  className="rounded-2xl border border-line bg-card p-4 shadow-card"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-warning-wash px-2 py-0.5 text-[10px] font-medium text-warning-ink">
                      {item.reviewStatus}
                    </span>
                    {item.user ? (
                      <Link href={`/users/${item.user.id}`} className="text-[12px] text-blue-600 underline">
                        {item.user.nickname ?? item.user.email}
                      </Link>
                    ) : (
                      <span className="text-[12px] text-muted">账号已删除</span>
                    )}
                    <span className="text-[12px] text-muted">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                    <span className="font-mono text-[11px] text-muted">{item.id}</span>
                  </div>

                  {/* The scanner's reasons, shown only here. Without them the reviewer has
                      to guess what tripped the filter. */}
                  {item.reviewReasons.length > 0 ? (
                    <p data-testid={`moment-queue-reasons-${item.id}`} className="mt-2 text-[12px] text-danger-ink">
                      命中规则：{item.reviewReasons.join("、")}
                    </p>
                  ) : null}

                  <p className="mt-2 whitespace-pre-wrap break-words text-[13px]">{item.content}</p>

                  {item.images.length > 0 ? (
                    <p className="mt-2 text-[12px] text-muted">附 {item.images.length} 张图片</p>
                  ) : null}
                  {item.videoUrl ? <p className="mt-1 text-[12px] text-muted">附视频</p> : null}
                  {item.tags.length > 0 ? (
                    <p className="mt-1 text-[12px] text-muted"># {item.tags.join(" #")}</p>
                  ) : null}

                  {canWrite ? (
                    <div className="mt-3">
                      <input
                        data-testid={`moment-queue-reason-${item.id}`}
                        value={reasons[item.id] ?? ""}
                        onChange={(event) =>
                          setReasons((current) => ({ ...current, [item.id]: event.target.value }))
                        }
                        placeholder="处理理由（可选，会记入审计）"
                        className="h-9 w-full rounded-xl border border-line px-3 text-[12px] outline-none"
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          data-testid={`moment-queue-approve-${item.id}`}
                          disabled={busyId === item.id}
                          onClick={() => void decide(item, "approve")}
                          className="h-9 rounded-xl bg-primary-ink px-3 text-[12px] text-white disabled:opacity-50"
                        >
                          通过
                        </button>
                        <button
                          type="button"
                          data-testid={`moment-queue-reject-${item.id}`}
                          disabled={busyId === item.id}
                          onClick={() => void decide(item, "reject")}
                          className="h-9 rounded-xl border border-danger text-[12px] text-danger disabled:opacity-50"
                        >
                          拒绝
                        </button>
                        <button
                          type="button"
                          data-testid={`moment-queue-hide-${item.id}`}
                          disabled={busyId === item.id}
                          onClick={() => void decide(item, "hide")}
                          className="h-9 rounded-xl border border-line px-3 text-[12px] text-muted disabled:opacity-50"
                        >
                          下架
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function friendlyError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "操作失败，请稍后重试";
  const message = error.message ?? "";
  if (!message || /prisma|stack|\bat \w|ECONNREFUSED|ETIMEDOUT|\bSQL\b|\b500\b/i.test(message)) {
    return "操作失败，请稍后重试";
  }
  return message;
}
