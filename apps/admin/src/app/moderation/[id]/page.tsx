"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { ConfirmDialog, type ConfirmPayload } from "@/components/confirm-dialog";
import { ApiRequestError, apiFetch, apiSend } from "@/lib/api";
import { useAdminSession } from "@/lib/session";
import { canSetUserStatus } from "@/lib/permissions";
import { ACTION_META, type StatusAction } from "@/lib/status-actions";

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
    createdAt: string;
  };
  reporter: Party;
  reportedUser: Party;
  target: { targetType: "USER" | "MESSAGE"; messageId: string | null };
  message: MessageSummary;
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

const STATUS_BADGE: Record<string, string> = {
  OPEN: "bg-[#FEF3C7] text-[#92400E]",
  REVIEWING: "bg-[#DBEAFE] text-[#1E40AF]",
  RESOLVED: "bg-[#DCFCE7] text-[#166534]",
  REJECTED: "bg-[#EDEFF3] text-[#5A6472]",
};

/**
 * The status actions this workbench offers on the reported user. Deliberately a
 * subset of `STATUS_ACTION_ORDER`: `activate` / `disable` / `unban` are account
 * administration and live on the user screens. What belongs next to a report is
 * the two enforcement actions.
 */
const WORKBENCH_STATUS_ACTIONS: readonly StatusAction[] = ["suspend", "ban"];

/**
 * Phase B5 — one report, framed as a moderation decision.
 *
 * ## It reads the same endpoint as `/reports/[id]`
 *
 * `GET /admin/reports/:id` already returns everything a moderator needs: the
 * report, both parties, the derived target, the message (or an explicit
 * "unavailable"), and the audit-backed history. There is no
 * `/admin/moderation/:id` and there should not be — two URLs over one
 * implementation is exactly the duplication B5 exists to avoid.
 *
 * ## Three kinds of state this screen keeps apart
 *
 *   1. **Not found** (`REPORT_NOT_FOUND`) — permanent. Retrying cannot help, so
 *      it gets its own screen rather than a retry button that never works.
 *   2. **Message unavailable** — `Report.messageId` has no foreign key, so a
 *      report outlives its message. `NO_MESSAGE` and `DELETED` are different
 *      facts and get different copy. Neither is an error and neither may 500.
 *   3. **Load failed** — transient, offers a retry.
 *
 * ## Every action reuses an existing endpoint
 *
 *   - review  → `POST /admin/reports/:id/review`   (gated by `reports:write`)
 *   - suspend → `POST /admin/users/:id/status`     (gated by `users:write` +
 *               `ROLE_ALLOWED_STATUS_ACTIONS`)
 *   - ban     → `POST /admin/users/:id/status`     (same gate)
 *
 * There is no `ModerationService`. Nothing here updates a `User` or writes an
 * `AdminAuditLog` directly — `setStatus()` and `reviewReport()` already own
 * those rules, including "exactly one audit row per successful action, none on
 * failure". A second write path would be a second set of rules.
 *
 * ## Button visibility is not the boundary
 *
 * `reports:write` and `canSetUserStatus` decide what is rendered, so an operator
 * is not shown an action that will fail. The API re-checks both: a hand-made
 * request that skips this file still gets `403 PERMISSION_DENIED`. This is why a
 * SUPPORT or CONTENT_MANAGER session sees no review buttons *and* would be
 * rejected if it tried.
 */
export default function ModerationDetailPage() {
  return (
    <Shell>
      <ModerationDetailScreen />
    </Shell>
  );
}

function ModerationDetailScreen() {
  const router = useRouter();
  const { identity, can } = useAdminSession();
  const [reportId, setReportId] = useState<string | null>(null);
  const [data, setData] = useState<Detail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [pendingReview, setPendingReview] = useState<ReviewAction | null>(null);
  const [pendingStatus, setPendingStatus] = useState<StatusAction | null>(null);
  const [acting, setActing] = useState(false);

  // Next 15 hands `params` to a client component as a promise. `useParams()`
  // returns it synchronously, so it is unwrapped here rather than reaching into
  // the pathname.
  const routeParams = useParams<{ id: string }>();

  useEffect(() => {
    if (typeof routeParams?.id === "string") setReportId(routeParams.id);
  }, [routeParams]);

  const canReview = can("reports:write");
  // `users:write` is the coarse gate; which statuses a role may set is the
  // orthogonal axis the backend enforces in `canSetUserStatus`.
  const canSetStatus = can("users:write");

  /**
   * Which enforcement actions this session may offer.
   *
   * Mirrors `ROLE_ALLOWED_STATUS_ACTIONS`: ANALYST and CONTENT_MANAGER hold
   * neither, SUPPORT holds neither, MODERATOR may `suspend` only, SUPER_ADMIN
   * may do both. Derived from the session's own role so the console and the API
   * cannot disagree about what is on offer.
   */
  const statusActions = WORKBENCH_STATUS_ACTIONS.filter(
    (action) => canSetStatus && canSetUserStatus(identity?.role, action),
  );

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
      // An unknown id is permanent. Rendering it as a retryable error would
      // invite an operator to keep pressing a button that cannot work.
      if (code === "REPORT_NOT_FOUND") {
        setNotFound(true);
        return;
      }
      setError(friendlyError(requestError));
    }
  }, [reportId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The reason is mandatory — the API rejects an empty one with 400. */
  async function runReview(payload: ConfirmPayload) {
    if (!pendingReview || !reportId) return;
    setActing(true);
    try {
      await apiSend(`/admin/reports/${reportId}/review`, "POST", {
        action: pendingReview,
        reason: payload.reason,
      });
      setPendingReview(null);
      await load();
    } catch (requestError) {
      setError(friendlyError(requestError));
    } finally {
      setActing(false);
    }
  }

  /**
   * Routes through the *existing* user-status endpoint. `setStatus()` owns the
   * role check, the expiry rule, the self-/admin-protection and the audit row —
   * all of which this call inherits by construction.
   */
  async function runStatusChange(payload: ConfirmPayload) {
    if (!pendingStatus || !data) return;
    setActing(true);
    try {
      await apiSend(`/admin/users/${data.reportedUser.id}/status`, "POST", {
        action: pendingStatus,
        reason: payload.reason,
        ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
      });
      setPendingStatus(null);
      // The reported user's status is rendered, so the report is reloaded to
      // reflect it — the report row itself did not change.
      await load();
    } catch (requestError) {
      setError(friendlyError(requestError));
    } finally {
      setActing(false);
    }
  }

  if (notFound) {
    return (
      <>
        <Link href="/moderation" className="text-[13px] text-muted underline">
          ← 返回审核队列
        </Link>
        <h1 className="mt-2 text-[20px] font-semibold">举报不存在或已被删除</h1>
        <p className="mt-2 text-[13px] text-muted">
          找不到 ID 为 <span className="font-mono">{reportId}</span> 的举报。该记录可能已被删除。
        </p>
        <Link
          href="/moderation"
          className="mt-4 inline-block h-9 rounded-xl border border-line px-4 text-[13px] leading-9"
        >
          返回审核队列
        </Link>
      </>
    );
  }

  return (
    <>
      <Link href="/moderation" className="text-[13px] text-muted underline">
        ← 返回审核队列
      </Link>
      <h1 className="mt-2 text-[20px] font-semibold">举报处理</h1>

      {error ? (
        <div className="mt-3 rounded-2xl border border-line p-4">
          <p className="text-[13px] text-red-500">{error}</p>
          <button
            onClick={() => void load()}
            className="mt-3 h-9 rounded-xl border border-line px-4 text-[13px]"
          >
            重试
          </button>
        </div>
      ) : null}
      {!data && !error ? <p className="mt-3 text-[13px] text-muted">加载中…</p> : null}

      {data ? (
        <div className="mt-4 space-y-4">
          {/* 举报概要 */}
          <section data-testid="moderation-summary-card" className="rounded-2xl border border-line p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-testid="status-badge"
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  STATUS_BADGE[data.report.status] ?? "bg-[#EDEFF3] text-[#5A6472]"
                }`}
              >
                {data.report.status}
              </span>
              <span
                data-testid="moderation-target-badge"
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  data.target.targetType === "MESSAGE"
                    ? "bg-[#EDE9FE] text-[#5B21B6]"
                    : "bg-[#DBEAFE] text-[#1E40AF]"
                }`}
              >
                {data.target.targetType === "MESSAGE" ? "消息举报" : "用户举报"}
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

            <p className="mt-1 text-[11px] text-muted">
              举报 ID <span className="font-mono">{data.report.id}</span>
            </p>

            {data.report.description ? (
              <p data-testid="moderation-description" className="mt-2 text-[13px]">
                {data.report.description}
              </p>
            ) : (
              <p className="mt-2 text-[12px] text-muted">举报人没有填写补充说明。</p>
            )}
          </section>

          {/* 被举报的消息 */}
          {data.target.targetType === "MESSAGE" ? (
            <section data-testid="moderation-message" className="rounded-2xl border border-line p-4">
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
                // No FK backs `messageId`, so "gone" is a normal state rather
                // than an error. Both reasons stay visible — a moderator should
                // know the evidence was unavailable, not think it was blank.
                <p data-testid="moderation-message-unavailable" className="mt-2 text-[12px] text-muted">
                  {data.message.reason === "DELETED"
                    ? "该消息已被删除，内容无法查看。"
                    : "这条举报没有关联消息。"}
                </p>
              )}
            </section>
          ) : null}

          {/* 被举报人 */}
          <section className="rounded-2xl border border-line p-4">
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

          {/* 处理历史（审计日志） */}
          <section data-testid="moderation-history" className="rounded-2xl border border-line p-4">
            <p className="text-[14px] font-medium">处理历史</p>
            {data.history.length === 0 ? (
              <p className="mt-2 text-[12px] text-muted">
                还没有处理记录。这条举报自提交后未被处理过。
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {data.history.map((entry) => (
                  <li key={entry.id} className="rounded-xl border border-line p-3">
                    <p className="flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="font-mono">{entry.action}</span>
                      <span className="text-muted">
                        {/* `actorType` is read before `adminId`: a SYSTEM row has
                            a NULL adminId by construction, and slicing it would
                            render "admin " with nothing after it — implying a
                            human action that no human performed. */}
                        {entry.actorType === "SYSTEM"
                          ? "系统 · 自动"
                          : entry.adminId
                            ? `admin ${entry.adminId.slice(0, 8)}`
                            : "-"}
                      </span>
                      <span className="text-muted">{formatTime(entry.createdAt)}</span>
                    </p>
                    {entry.reason ? <p className="mt-1 text-[12px]">{entry.reason}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 可用操作 */}
          <section data-testid="moderation-actions" className="rounded-2xl border border-line p-4">
            <p className="text-[14px] font-medium">可执行操作</p>

            {canReview ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {(["reviewing", "resolved", "rejected"] as const).map((action) => (
                  <button
                    key={action}
                    data-testid={`moderation-review-${action}`}
                    onClick={() => setPendingReview(action)}
                    disabled={acting}
                    className="h-9 rounded-xl border border-line px-4 text-[13px] disabled:opacity-40"
                  >
                    {ACTION_LABELS[action].label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 rounded-xl bg-[#F7F9FF] px-3 py-2 text-[12px] text-muted">
                你的角色（{identity?.role}）没有审核举报的权限（reports:write），只能查看。
              </p>
            )}

            {/* Enforcement on the reported user. Separate from the review above:
                closing a report and restricting an account are different
                decisions, and a role may hold one without the other. */}
            {statusActions.length > 0 ? (
              <div className="mt-3 border-t border-line pt-3">
                <p className="text-[12px] text-muted">对被举报人执行：</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {statusActions.map((action) => (
                    <button
                      key={action}
                      data-testid={`moderation-status-${action}`}
                      onClick={() => setPendingStatus(action)}
                      disabled={acting}
                      className="h-9 rounded-xl border border-line px-4 text-[13px] disabled:opacity-40"
                    >
                      {ACTION_META[action].label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-3 border-t border-line pt-3 text-[12px] text-muted">
                你的角色（{identity?.role}）不能对被举报人执行封禁操作。
              </p>
            )}
          </section>
        </div>
      ) : null}

      {pendingReview ? (
        <ConfirmDialog
          open
          busy={acting}
          title={ACTION_LABELS[pendingReview].title}
          description={ACTION_LABELS[pendingReview].description}
          confirmLabel={ACTION_LABELS[pendingReview].label}
          onCancel={() => setPendingReview(null)}
          onConfirm={runReview}
        />
      ) : null}

      {pendingStatus && data ? (
        <ConfirmDialog
          open
          busy={acting}
          title={ACTION_META[pendingStatus].title}
          description={ACTION_META[pendingStatus].describe(data.reportedUser)}
          danger={ACTION_META[pendingStatus].danger}
          requirePhrase={ACTION_META[pendingStatus].phrase}
          withExpiry={Boolean(ACTION_META[pendingStatus].withExpiry)}
          confirmLabel={ACTION_META[pendingStatus].label}
          onCancel={() => setPendingStatus(null)}
          onConfirm={runStatusChange}
        />
      ) : null}
    </>
  );
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function friendlyError(error: unknown): string {
  const code = (error as { code?: string }).code;
  if (code === "REASON_REQUIRED") return "请填写处理原因。";
  if (code === "EXPIRES_AT_REQUIRED") return "临时封禁必须填写解封时间。";
  if (code === "INVALID_EXPIRES_AT") return "解封时间必须是晚于当前时间的有效时间。";
  if (code === "REPORT_NOT_FOUND") return "举报不存在或已被删除。";
  if (code === "USER_NOT_FOUND") return "被举报人不存在或已被删除。";
  if (code === "PERMISSION_DENIED") return "你的角色没有执行该操作的权限。";
  if (code === "ACTION_NOT_ALLOWED_FOR_ROLE") return "你的角色不能执行这个操作。";
  if (code === "CANNOT_MODIFY_SELF") return "不能修改自己的账号状态。";
  if (code === "CANNOT_MODIFY_ADMIN") return "该用户是管理员，只有超级管理员可以处理。";
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}
