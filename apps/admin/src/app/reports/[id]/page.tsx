"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmDialog, type ConfirmPayload } from "@/components/confirm-dialog";
import { ApiRequestError, apiFetch, apiSend } from "@/lib/api";
import { REPORT_TARGET_BADGE_CLASS, REPORT_TARGET_LABELS } from "@/lib/report-target";
import { useAdminSession } from "@/lib/session";

type Party = { id: string; nickname: string | null; email: string; status?: string };

type MessageSummary =
  | {
      available: true;
      id: string;
      content: string;
      type: string;
      createdAt: string;
      sender: { id: string; nickname: string | null; email: string };
    }
  | { available: false; reason: "NO_MESSAGE" | "DELETED" };

/**
 * PC-2.5.4 — the reported moment, in the same two-state shape as a message.
 *
 * `Report.momentId` carries no foreign key either, so a report can outlive the
 * moment it points at: `available: false` is an ordinary state the screen
 * renders rather than an error it fails on.
 */
type MomentSummary =
  | {
      available: true;
      id: string;
      content: string;
      platform: string;
      source: string;
      createdAt: string;
      author: { id: string; nickname: string | null; email: string };
    }
  | { available: false; reason: "NO_MOMENT" | "DELETED" };

type HistoryEntry = {
  id: string;
  action: string;
  actorType: string;
  adminId: string | null;
  reason: string | null;
  detail: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
};

type Detail = {
  report: {
    id: string;
    reason: string;
    description: string | null;
    status: string;
    messageId: string | null;
    momentId: string | null;
    createdAt: string;
  };
  reporter: Party;
  reportedUser: Party;
  // The API states the target type outright, so this screen never re-derives it
  // and cannot disagree with the queue about the same row.
  target: {
    targetType: "USER" | "MESSAGE" | "MOMENT";
    messageId: string | null;
    momentId: string | null;
  };
  message: MessageSummary;
  moment: MomentSummary;
  history: HistoryEntry[];
};

type ReviewAction = "reviewing" | "resolved" | "rejected";

const ACTION_LABELS: Record<ReviewAction, { label: string; title: string; description: string }> = {
  reviewing: {
    label: "受理",
    title: "受理举报",
    description: "将这条举报标记为「审核中」，表示已有人跟进。",
  },
  resolved: {
    label: "处理",
    title: "处理举报",
    description: "将这条举报标记为「已处理」。请说明处理结论。",
  },
  rejected: {
    label: "驳回",
    title: "驳回举报",
    description: "将这条举报标记为「已驳回」。请说明驳回理由。",
  },
};


/**
 * Phase B4 — one report, with its target and its full review history.
 *
 * ## Why this page exists at all
 *
 * `reports/page.tsx` links every row to `/reports/<id>` — the reporter's name
 * and 「查看详情」 both point here. Without this route every one of those links
 * 404s, which is worse than not offering them: an operator reading a queue of
 * reports has no way to act on any individual one.
 *
 * ## The three states this screen must keep apart
 *
 *   1. **Not found** — the id is unknown or the report was deleted. A distinct
 *      screen, not a spinner and not a generic error; retrying will never help.
 *   2. **Message unavailable** — `Report.messageId` carries no foreign key, so a
 *      report can outlive the message it points at. The two reasons
 *      (`NO_MESSAGE` / `DELETED`) read differently because they mean different
 *      things to someone deciding whether to act. PC-2.5.4 adds the identical
 *      pair for `momentId` (`NO_MOMENT` / `DELETED`).
 *   3. **Load failed** — transient. Offers a retry.
 *
 * ## History is the audit log, not a report field
 *
 * `Report` has no `reviewedAt`/`reviewedBy`/resolution columns. The only record
 * of what happened to a report is `AdminAuditLog` rows with
 * `targetType='REPORT' AND targetId=<id>`, which is exactly what the API returns.
 * Rendering an empty history as "never reviewed" would be wrong the moment a
 * report predates the audit log — hence the explicit copy for zero entries.
 */
export default function ReportDetailPage() {
  return (
    <Shell>
      <ReportDetailScreen />
    </Shell>
  );
}

function ReportDetailScreen() {
  const router = useRouter();
  const { identity } = useAdminSession();
  const [reportId, setReportId] = useState<string | null>(null);
  const [data, setData] = useState<Detail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<ReviewAction | null>(null);
  const [acting, setActing] = useState(false);

  const canWrite = Boolean(identity?.permissions?.includes("reports:write"));

  // Next 15 hands `params` to a client component as a promise. `useParams()`
  // returns it synchronously, so it is unwrapped here rather than reaching into
  // the pathname.
  const routeParams = useParams<{ id: string }>();

  useEffect(() => {
    if (typeof routeParams?.id === "string") setReportId(routeParams.id);
  }, [routeParams]);

  const load = useCallback(async () => {
    if (!reportId) return;
    setError("");
    try {
      setData(await apiFetch<Detail>(`/admin/reports/${reportId}`));
    } catch (requestError) {
      const code = requestError instanceof ApiRequestError ? requestError.code : "";
      if (code === "ADMIN_REQUIRED" || code === "ADMIN_INACTIVE" || code === "UNAUTHORIZED") {
        router.replace("/login");
        return;
      }
      // An unknown id is a permanent state. Rendering it as a retryable error
      // would invite an operator to keep pressing a button that cannot work.
      if (code === "REPORT_NOT_FOUND") {
        setNotFound(true);
        return;
      }
      setError(requestError instanceof Error ? requestError.message : "加载失败");
    }
  }, [reportId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runReview(payload: ConfirmPayload) {
    if (!pending || !reportId) return;
    setActing(true);
    try {
      await apiSend(`/admin/reports/${reportId}/review`, "POST", {
        action: pending,
        reason: payload.reason,
      });
      setPending(null);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "操作失败");
    } finally {
      setActing(false);
    }
  }

  if (notFound) {
    return (
      <>
        <Link href="/reports" className="text-[13px] text-muted underline">
          ← 返回举报列表
        </Link>
        <h1 className="mt-2 text-[20px] font-semibold">举报不存在</h1>
        <p className="mt-2 text-[13px] text-muted">
          找不到 ID 为 <span className="font-mono">{reportId}</span> 的举报。该记录可能已被删除。
        </p>
        <Link
          href="/reports"
          className="mt-4 tf-btn"
        >
          返回举报列表
        </Link>
      </>
    );
  }

  return (
    <>
      <Link href="/reports" className="text-[13px] text-muted underline">
        ← 返回举报列表
      </Link>
      <h1 className="mt-2 text-[20px] font-semibold">举报详情</h1>
      {error ? <p className="mt-3 text-[13px] text-red-500">{error}</p> : null}
      {!data && !error ? <p className="mt-3 text-[13px] text-muted">加载中…</p> : null}

      {data ? (
        <div className="mt-4 space-y-4">
          {/* 举报内容 */}
          <section data-testid="report-summary" className="rounded-2xl border border-line bg-card shadow-card p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={data.report.status} domain="REPORT" testId="status-badge" />
              <span
                data-testid="report-target-badge"
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  REPORT_TARGET_BADGE_CLASS[data.target.targetType]
                }`}
              >
                {REPORT_TARGET_LABELS[data.target.targetType]}
              </span>
              <span className="text-[12px] text-muted">{data.report.reason}</span>
              <span className="text-[12px] text-muted">·</span>
              <span className="text-[12px] text-muted">{formatTime(data.report.createdAt)}</span>
            </div>

            <p className="mt-2 text-[13px]">
              <Link href={`/users/${data.reporter.id}`} className="underline">
                {data.reporter.nickname ?? data.reporter.email}
              </Link>{" "}
              →{" "}
              <Link href={`/users/${data.reportedUser.id}`} className="underline">
                {data.reportedUser.nickname ?? data.reportedUser.email}
              </Link>
            </p>

            {data.report.description ? (
              <p data-testid="report-description" className="mt-2 text-[13px]">
                {data.report.description}
              </p>
            ) : (
              // An absent description is a legitimate state — the reporter chose
              // not to elaborate. Saying so beats an empty gap that reads as a
              // rendering failure.
              <p className="mt-2 text-[12px] text-muted">举报人没有填写补充说明。</p>
            )}
          </section>

          {/* 被举报的消息 */}
          {data.target.targetType === "MESSAGE" ? (
            <section data-testid="report-message" className="rounded-2xl border border-line bg-card shadow-card p-4">
              <p className="text-[14px] font-medium">被举报的消息</p>
              {data.message.available ? (
                <>
                  <p className="mt-2 whitespace-pre-wrap text-[13px]">{data.message.content}</p>
                  <p className="mt-2 text-[12px] text-muted">
                    {data.message.type} ·{" "}
                    {data.message.sender.nickname ?? data.message.sender.email} ·{" "}
                    {formatTime(data.message.createdAt)}
                  </p>
                </>
              ) : (
                // No FK backs `messageId`, so "gone" is normal rather than
                // exceptional. Both branches stay visible; an operator should
                // know the evidence was unavailable, not think it was blank.
                <p data-testid="report-message-unavailable" className="mt-2 text-[12px] text-muted">
                  {data.message.reason === "DELETED"
                    ? "该消息已被删除，内容无法查看。"
                    : "这条举报没有关联消息。"}
                </p>
              )}
            </section>
          ) : null}

          {/* 被举报的动态 */}
          {data.target.targetType === "MOMENT" ? (
            <section data-testid="report-moment" className="rounded-2xl border border-line bg-card shadow-card p-4">
              <p className="text-[14px] font-medium">被举报的动态</p>
              {data.moment.available ? (
                <>
                  <p className="mt-2 whitespace-pre-wrap text-[13px]">{data.moment.content}</p>
                  <p className="mt-2 text-[12px] text-muted">
                    {data.moment.platform} · {data.moment.source} ·{" "}
                    <Link href={`/users/${data.moment.author.id}`} className="underline">
                      {data.moment.author.nickname ?? data.moment.author.email}
                    </Link>{" "}
                    · {formatTime(data.moment.createdAt)}
                  </p>
                </>
              ) : (
                // No FK backs `momentId` either, so "gone" is normal rather than
                // exceptional — same contract as the message block above.
                <p data-testid="report-moment-unavailable" className="mt-2 text-[12px] text-muted">
                  {data.moment.reason === "DELETED"
                    ? "该动态已被删除，内容无法查看。"
                    : "这条举报没有关联动态。"}
                </p>
              )}
            </section>
          ) : null}

          {/* 被举报人现状 */}
          <section className="rounded-2xl border border-line bg-card shadow-card p-4">
            <p className="text-[14px] font-medium">被举报人</p>
            <p className="mt-2 text-[13px]">
              <Link href={`/users/${data.reportedUser.id}`} className="underline">
                {data.reportedUser.nickname ?? data.reportedUser.email}
              </Link>
            </p>
            <p className="mt-1 text-[12px] text-muted">
              {data.reportedUser.email} · 账号状态 {data.reportedUser.status ?? "-"}
            </p>
          </section>

          {/* 审核历史 */}
          <section data-testid="report-history" className="rounded-2xl border border-line bg-card shadow-card p-4">
            <p className="text-[14px] font-medium">审核历史</p>
            {data.history.length === 0 ? (
              <p className="mt-2 text-[12px] text-muted">
                还没有审核记录。这条举报自提交后未被处理过。
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {data.history.map((entry) => (
                  <li key={entry.id} className="rounded-xl border border-line bg-surface p-3">
                    <p className="flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="font-mono">{entry.action}</span>
                      <span className="text-muted">
                        {entry.actorType === "SYSTEM"
                          ? "系统 · 自动"
                          : entry.adminId
                            ? `admin ${entry.adminId.slice(0, 8)}`
                            : "-"}
                      </span>
                      <span className="text-muted">{formatTime(entry.createdAt)}</span>
                    </p>
                    {entry.reason ? (
                      <p className="mt-1 text-[12px]">{entry.reason}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 审核操作 */}
          {canWrite ? (
            <section className="flex flex-wrap items-center gap-2">
              {(["reviewing", "resolved", "rejected"] as const).map((action) => (
                <button
                  key={action}
                  onClick={() => setPending(action)}
                  disabled={acting}
                  className="tf-btn"
                >
                  {ACTION_LABELS[action].label}
                </button>
              ))}
            </section>
          ) : (
            <p className="rounded-xl bg-accent px-3 py-2 text-[12px] text-muted">
              你的角色（{identity?.role}）对举报只有查看权限，无法审核。
            </p>
          )}
        </div>
      ) : null}

      {/* The reason is mandatory — the API rejects an empty one, so the dialog
          is the single place that can supply it. */}
      {pending ? (
        <ConfirmDialog
          open
          busy={acting}
          title={ACTION_LABELS[pending].title}
          description={ACTION_LABELS[pending].description}
          confirmLabel={ACTION_LABELS[pending].label}
          onCancel={() => setPending(null)}
          onConfirm={runReview}
        />
      ) : null}
    </>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}
