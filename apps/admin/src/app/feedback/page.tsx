"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Shell } from "@/components/shell";
import { ApiRequestError, apiFetch, apiSend } from "@/lib/api";
import { useAdminSession } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";

/**
 * 意见反馈 — the member feedback queue, and the address members are shown.
 *
 * ## Why the queue and the setting share a screen
 *
 * They answer one question between them: "where does member feedback go, and what have we
 * done with it". The address is the destination, the queue is the traffic. Splitting them
 * across two sections of the console would mean an operator editing the address has to
 * remember where the replies are.
 *
 * ## Why the reply is a textarea on the row, not a detail page
 *
 * A queue of short messages is read and answered in one pass. A detail page per message
 * is the right shape when a message has context to load — a user history, a ticket
 * timeline — and none of that exists here. The row already carries everything the
 * decision needs.
 *
 * ## Gates
 *
 * The list is `moderation:read` and the reply is `moderation:write`, matching the API.
 * The address is `settings:read` / `settings:write`, so a role that may answer members is
 * not automatically able to change what the product advertises. Each section checks its
 * own permission rather than the screen assuming one covers both.
 */

type FeedbackKind = "SUGGESTION" | "BUG" | "COMPLAINT" | "OTHER";
type FeedbackStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

type Item = {
  id: string;
  kind: FeedbackKind;
  body: string;
  contactEmail: string | null;
  source: string | null;
  status: FeedbackStatus;
  replyBody: string | null;
  repliedAt: string | null;
  createdAt: string;
  userId: string | null;
  user: { id: string; nickname: string | null; email: string } | null;
};

type ListResponse = {
  items: Item[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const KIND_LABEL: Record<FeedbackKind, string> = {
  SUGGESTION: "建议",
  BUG: "问题",
  COMPLAINT: "投诉",
  OTHER: "其他",
};

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  OPEN: "待处理",
  IN_PROGRESS: "处理中",
  RESOLVED: "已回复",
  CLOSED: "已关闭",
};

const STATUS_CLASS: Record<FeedbackStatus, string> = {
  OPEN: "bg-warning-wash text-warning-ink",
  IN_PROGRESS: "bg-info-wash text-info-ink",
  RESOLVED: "bg-success-wash text-success-ink",
  CLOSED: "bg-neutral-wash text-neutral-ink",
};

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "全部" },
  { value: "OPEN", label: "待处理" },
  { value: "IN_PROGRESS", label: "处理中" },
  { value: "RESOLVED", label: "已回复" },
  { value: "CLOSED", label: "已关闭" },
];

export default function FeedbackAdminPage() {
  return (
    <Shell>
      <FeedbackScreen />
    </Shell>
  );
}

function FeedbackScreen() {
  const { identity } = useAdminSession();
  const canRead = Boolean(identity && hasPermission(identity.role, "moderation:read"));
  const canWrite = Boolean(identity && hasPermission(identity.role, "moderation:write"));
  const canReadSettings = Boolean(identity && hasPermission(identity.role, "settings:read"));
  const canWriteSettings = Boolean(identity && hasPermission(identity.role, "settings:write"));

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState("");

  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const [supportEmail, setSupportEmail] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState("");

  const load = useCallback(async () => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const query = status ? `?status=${status}` : "";
      const data = await apiFetch<ListResponse>(`/admin/feedback${query}`);
      setItems(data.items);
    } catch (requestError) {
      setError(friendlyError(requestError));
    } finally {
      setLoading(false);
    }
  }, [canRead, status]);

  const loadEmail = useCallback(async () => {
    if (!canReadSettings) return;
    try {
      const data = await apiFetch<{ supportEmail: string }>("/admin/settings/support-email");
      setSupportEmail(data.supportEmail);
      setEmailDraft(data.supportEmail);
    } catch {
      // A failed read leaves the field holding the last known value; the write is what
      // matters and it re-validates server-side.
      setEmailError("无法读取当前邮箱");
    }
  }, [canReadSettings]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadEmail();
  }, [loadEmail]);

  async function review(item: Item, nextStatus?: FeedbackStatus) {
    setBusyId(item.id);
    setError("");
    setNotice("");
    try {
      const replyBody = (replyDraft[item.id] ?? "").trim();
      await apiSend(`/admin/feedback/${item.id}/review`, "POST", {
        ...(nextStatus ? { status: nextStatus } : {}),
        ...(replyBody ? { replyBody } : {}),
      });
      setReplyDraft((current) => ({ ...current, [item.id]: "" }));
      setNotice(replyBody ? "已回复" : "已更新状态");
      await load();
    } catch (requestError) {
      setError(friendlyError(requestError));
    } finally {
      setBusyId(null);
    }
  }

  async function saveEmail(event: React.FormEvent) {
    event.preventDefault();
    setEmailError("");
    setNotice("");
    setSavingEmail(true);
    try {
      const data = await apiSend<{ supportEmail: string }>("/admin/settings/support-email", "PATCH", {
        supportEmail: emailDraft.trim(),
      });
      setSupportEmail(data.supportEmail);
      setEmailDraft(data.supportEmail);
      setNotice("已更新反馈邮箱");
    } catch (requestError) {
      setEmailError(friendlyError(requestError));
    } finally {
      setSavingEmail(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-[20px] font-semibold">意见反馈</h1>
      <p className="mt-1 text-[13px] text-muted">
        成员提交的问题与建议。回复后成员可在「我的 → 意见反馈」中看到答复。
      </p>

      {notice ? (
        <p data-testid="feedback-admin-notice" className="mt-3 text-[13px] text-success-ink">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p data-testid="feedback-admin-error" className="mt-3 text-[13px] text-red-500">
          {error}
        </p>
      ) : null}

      {/* Settings section. Rendered only for a role that may read it, so the screen does
          not show a form the API will refuse. */}
      {canReadSettings ? (
        <form
          onSubmit={saveEmail}
          data-testid="support-email-form"
          className="mt-5 rounded-2xl border border-line bg-card p-4 shadow-card"
        >
          <h2 className="text-[14px] font-medium">反馈邮箱</h2>
          <p className="mt-1 text-[12px] text-muted">
            显示在成员的反馈页面上，作为可以直接发邮件的地址。留空表示恢复默认地址。
          </p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="text-[12px] text-muted">当前邮箱</span>
              <input
                data-testid="support-email-input"
                value={emailDraft}
                onChange={(event) => setEmailDraft(event.target.value)}
                disabled={!canWriteSettings}
                className="mt-1 h-10 w-72 rounded-xl border border-line px-3 text-[13px] outline-none disabled:bg-surface"
              />
            </label>
            {canWriteSettings ? (
              <button
                type="submit"
                data-testid="support-email-save"
                disabled={savingEmail}
                className="h-10 rounded-xl bg-primary-ink px-4 text-[13px] font-medium text-white disabled:opacity-50"
              >
                保存
              </button>
            ) : (
              <span className="text-[12px] text-muted">只读</span>
            )}
            {supportEmail ? (
              <span className="text-[12px] text-muted">
                生效中：<span className="font-mono">{supportEmail}</span>
              </span>
            ) : null}
          </div>
          {emailError ? (
            <p data-testid="support-email-error" className="mt-2 text-[13px] text-red-500">
              {emailError}
            </p>
          ) : null}
        </form>
      ) : null}

      {!canRead ? (
        <p data-testid="feedback-admin-forbidden" className="mt-5 text-[13px] text-muted">
          你的角色没有查看反馈的权限。
        </p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="反馈状态筛选">
            {STATUS_FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                data-testid={`feedback-filter-${option.value || "all"}`}
                aria-pressed={status === option.value}
                onClick={() => setStatus(option.value)}
                className={
                  status === option.value
                    ? "h-9 rounded-xl bg-primary-ink px-3 text-[13px] font-medium text-white"
                    : "h-9 rounded-xl border border-line px-3 text-[13px] text-muted"
                }
              >
                {option.label}
              </button>
            ))}
          </div>

          {loading ? (
            <p data-testid="feedback-admin-loading" className="mt-6 text-[13px] text-muted">
              加载中…
            </p>
          ) : items.length === 0 ? (
            <p data-testid="feedback-admin-empty" className="mt-6 text-[13px] text-muted">
              当前筛选下没有反馈。
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {items.map((item) => (
                <li
                  key={item.id}
                  data-testid={`feedback-admin-item-${item.id}`}
                  className="rounded-2xl border border-line bg-card p-4 shadow-card"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        STATUS_CLASS[item.status]
                      }`}
                    >
                      {STATUS_LABEL[item.status]}
                    </span>
                    <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] text-muted">
                      {KIND_LABEL[item.kind]}
                    </span>
                    <span className="text-[12px] text-muted">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                    {item.user ? (
                      <Link href={`/users/${item.user.id}`} className="text-[12px] text-blue-600 underline">
                        {item.user.nickname ?? item.user.email}
                      </Link>
                    ) : (
                      <span className="text-[12px] text-muted">账号已删除</span>
                    )}
                    {item.source ? (
                      <span className="font-mono text-[11px] text-muted">{item.source}</span>
                    ) : null}
                  </div>

                  <p className="mt-2 whitespace-pre-wrap break-words text-[13px]">{item.body}</p>

                  <p className="mt-2 text-[12px] text-muted">
                    回复地址：
                    {item.contactEmail ? (
                      <a href={`mailto:${item.contactEmail}`} className="text-blue-600 underline">
                        {item.contactEmail}
                      </a>
                    ) : (
                      <span>未提供（可在站内回复）</span>
                    )}
                  </p>

                  {item.replyBody ? (
                    <div className="mt-3 rounded-xl bg-subtle p-3">
                      <p className="text-[11px] font-medium text-muted">已回复</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-[13px]">{item.replyBody}</p>
                    </div>
                  ) : null}

                  {canWrite ? (
                    <div className="mt-3">
                      <textarea
                        data-testid={`feedback-reply-input-${item.id}`}
                        rows={2}
                        value={replyDraft[item.id] ?? ""}
                        onChange={(event) =>
                          setReplyDraft((current) => ({ ...current, [item.id]: event.target.value }))
                        }
                        placeholder="回复成员…（留空则只改状态）"
                        className="w-full rounded-xl border border-line px-3 py-2 text-[13px] outline-none"
                      />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          data-testid={`feedback-reply-send-${item.id}`}
                          disabled={busyId === item.id}
                          onClick={() => void review(item)}
                          className="h-9 rounded-xl bg-primary-ink px-3 text-[12px] text-white disabled:opacity-50"
                        >
                          回复并标记已解决
                        </button>
                        <button
                          type="button"
                          data-testid={`feedback-mark-progress-${item.id}`}
                          disabled={busyId === item.id}
                          onClick={() => void review(item, "IN_PROGRESS")}
                          className="h-9 rounded-xl border border-line px-3 text-[12px] text-muted disabled:opacity-50"
                        >
                          标记处理中
                        </button>
                        <button
                          type="button"
                          data-testid={`feedback-mark-closed-${item.id}`}
                          disabled={busyId === item.id}
                          onClick={() => void review(item, "CLOSED")}
                          className="h-9 rounded-xl border border-line px-3 text-[12px] text-muted disabled:opacity-50"
                        >
                          关闭
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
