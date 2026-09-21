"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Shell } from "@/components/shell";
import { StatusBadge, statusLabel } from "@/components/status-badge";
import { REPORT_REASONS, reportReasonLabel } from "@/lib/report-reasons";
import { ConfirmDialog, type ConfirmPayload } from "@/components/confirm-dialog";
import { apiFetch, apiSend } from "@/lib/api";
import {
  REPORT_TARGET_BADGE_CLASS,
  REPORT_TARGET_LABELS,
  deriveReportTargetType,
} from "@/lib/report-target";
import { useAdminSession } from "@/lib/session";

type ReportItem = {
  id: string;
  reason: string;
  status: string;
  description: string | null;
  messageId: string | null;
  momentId: string | null;
  createdAt: string;
  reporter: { id: string; nickname: string | null; email: string };
  reportedUser: { id: string; nickname: string | null; email: string; status: string };
};

type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  /** The API's own ceiling: `0` when there are no rows. Never recomputed here. */
  totalPages: number;
};

/**
 * Phase B4 — the reports queue.
 *
 * ## Why the default status is "all"
 *
 * Before B4 this screen opened on `status=OPEN`. In the real dataset every
 * report had already been picked up, so the first thing an administrator saw
 * was an empty screen that looked identical to "there are no reports". The
 * filter is still there and still functional — it is simply no longer the
 * landing state. `ALL` is a UI-level concept and is never sent to the API;
 * omitting `status` is what "all" means on the wire.
 *
 * ## The two empty states are different
 *
 * 「没有符合当前筛选条件的举报」 is a filter problem and offers a way out.
 * 「系统中还没有任何举报」 is not. Rendering the same copy for both would tell
 * an operator their filter was too narrow when the queue genuinely is empty.
 *
 * ## `targetType` is derived, and the UI mirrors the API
 *
 * There is no `targetType` column. A row with a `momentId` targets a moment,
 * otherwise one with a `messageId` targets a message, otherwise it targets a
 * user. `deriveReportTargetType` from `@/lib/report-target` is the single place
 * the console decides this, so the badge, the filter and the moderation queue
 * cannot disagree about the same row.
 *
 * See the note in `users/page.tsx`: `AdminSessionProvider` is rendered by
 * `<Shell>`, so the consumer must sit below it.
 */
export default function ReportsPage() {
  return (
    <Shell>
      <ReportsScreen />
    </Shell>
  );
}

const STATUS_OPTIONS = [
  { value: "ALL", label: "全部状态" },
  { value: "OPEN", label: "待处理" },
  { value: "REVIEWING", label: "审核中" },
  { value: "RESOLVED", label: "已处理" },
  { value: "REJECTED", label: "已驳回" },
];

/**
 * The reason values the report endpoint accepts, so the dropdown offers only
 * things that can actually match. `Report.reason` is a free-form column, not an
 * enum — this list mirrors the allow-list in `social-safety.controller.ts`
 * rather than a schema definition, because none exists.
 */
const REASON_OPTIONS = [
  { value: "ALL", label: "全部原因" },
  ...REPORT_REASONS.map((reason) => ({ value: reason, label: reportReasonLabel(reason) })),
];

const TARGET_OPTIONS = [
  { value: "ALL", label: "全部对象" },
  { value: "USER", label: "用户" },
  { value: "MESSAGE", label: "消息" },
  { value: "MOMENT", label: "动态" },
];


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

type Filters = {
  status: string;
  reason: string;
  targetType: string;
  reporter: string;
  reportedUser: string;
  createdFrom: string;
  createdTo: string;
};

/**
 * `ALL` is the absence of a parameter, not a sent value — the API treats an
 * unknown status or targetType as "no filter", but sending the literal string
 * `ALL` would rely on that behaviour rather than simply not asking.
 */
const DEFAULT_FILTERS: Filters = {
  status: "ALL",
  reason: "ALL",
  targetType: "ALL",
  reporter: "",
  reportedUser: "",
  createdFrom: "",
  createdTo: "",
};

function hasAnyFilter(filters: Filters): boolean {
  return (
    filters.status !== "ALL" ||
    filters.reason !== "ALL" ||
    filters.targetType !== "ALL" ||
    filters.reporter.trim() !== "" ||
    filters.reportedUser.trim() !== "" ||
    filters.createdFrom !== "" ||
    filters.createdTo !== ""
  );
}

/** `createdTo` is a date input, so the day is completed to its last instant. */
function buildQuery(filters: Filters, page: number): string {
  const params = new URLSearchParams();
  if (filters.status !== "ALL") params.set("status", filters.status);
  if (filters.reason !== "ALL") params.set("reason", filters.reason);
  if (filters.targetType !== "ALL") params.set("targetType", filters.targetType);
  if (filters.reporter.trim()) params.set("reporter", filters.reporter.trim());
  if (filters.reportedUser.trim()) params.set("reportedUser", filters.reportedUser.trim());
  if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
  // A bare `YYYY-MM-DD` is midnight; the operator means the whole day.
  if (filters.createdTo) params.set("createdTo", `${filters.createdTo}T23:59:59.999Z`);
  params.set("page", String(page));
  params.set("pageSize", "20");
  return `/admin/reports?${params.toString()}`;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function ReportsScreen() {
  const router = useRouter();
  const { identity } = useAdminSession();
  const [draft, setDraft] = useState<Filters>(DEFAULT_FILTERS);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<ReportItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  const [pending, setPending] = useState<{ item: ReportItem; action: ReviewAction } | null>(null);

  /** Ticket for the newest in-flight request; stale responses are dropped. */
  const ticket = useRef(0);

  const canWrite = Boolean(identity?.permissions?.includes("reports:write"));

  const load = useCallback(
    async (nextPage: number, effective: Filters) => {
      const mine = ++ticket.current;
      setLoading(true);
      setError("");
      try {
        const data = await apiFetch<Page<ReportItem>>(buildQuery(effective, nextPage));
        if (mine !== ticket.current) return;
        setResult(data);
        setPage(data.page);
      } catch (requestError) {
        if (mine !== ticket.current) return;
        const code = (requestError as { code?: string }).code;
        if (code === "ADMIN_REQUIRED" || code === "ADMIN_INACTIVE" || code === "UNAUTHORIZED") {
          router.replace("/login");
          return;
        }
        setError(friendlyError(requestError));
      } finally {
        if (mine === ticket.current) setLoading(false);
      }
    },
    [router],
  );

  /** Re-runs the query that is currently applied (paging, retry, after a write). */
  const reload = useCallback((nextPage: number) => load(nextPage, filters), [filters, load]);

  const applyDraft = useCallback(
    (next: Filters) => {
      setDraft(next);
      setFilters(next);
      void load(1, next);
    },
    [load],
  );

  useEffect(() => {
    void load(1, DEFAULT_FILTERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Reason is mandatory — the backend returns 400 if it is missing. */
  async function submitReview(payload: ConfirmPayload) {
    if (!pending) return;
    setActing(pending.item.id);
    try {
      await apiSend(`/admin/reports/${pending.item.id}/review`, "POST", {
        action: pending.action,
        reason: payload.reason,
      });
      setPending(null);
      await reload(page);
    } catch (requestError) {
      setError(friendlyError(requestError));
    } finally {
      setActing(null);
    }
  }

  function submitOnEnter(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") applyDraft(draft);
  }

  function patchDraft(patch: Partial<Filters>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  const appliedHasFilters = hasAnyFilter(filters);
  const showClear = appliedHasFilters || hasAnyFilter(draft);
  // `totalPages` is the API's ceiling and is 0 for an empty result set, so the
  // pager is only rendered when there is at least one row. It is never
  // recomputed here — that would let the screen and the server disagree.
  const totalPages = result?.totalPages ?? 0;

  return (
    <>
      <h1 className="text-[20px] font-semibold">举报审核</h1>
      <p className="mt-1 text-[13px] text-muted">
        共 {result?.total ?? 0} 条举报。筛选与分页都由后端执行。
      </p>

      {/* The toolbar renders unconditionally, so a reload keeps the page
          structure instead of collapsing to a blank screen. */}
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">状态</span>
          <select
            value={draft.status}
            onChange={(event) => patchDraft({ status: event.target.value })}
            aria-label="举报状态"
            className="h-10 rounded-xl border border-line px-3 text-[13px]"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">原因</span>
          <select
            value={draft.reason}
            onChange={(event) => patchDraft({ reason: event.target.value })}
            aria-label="举报原因"
            className="h-10 rounded-xl border border-line px-3 text-[13px]"
          >
            {REASON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">举报对象</span>
          <select
            value={draft.targetType}
            onChange={(event) => patchDraft({ targetType: event.target.value })}
            aria-label="举报对象类型"
            className="h-10 rounded-xl border border-line px-3 text-[13px]"
          >
            {TARGET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">举报人</span>
          <input
            value={draft.reporter}
            onChange={(event) => patchDraft({ reporter: event.target.value })}
            onKeyDown={submitOnEnter}
            placeholder="邮箱 / 昵称 / 用户 ID"
            aria-label="举报人筛选"
            className="h-10 w-56 rounded-xl border border-line px-3 text-[13px] outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">被举报人</span>
          <input
            value={draft.reportedUser}
            onChange={(event) => patchDraft({ reportedUser: event.target.value })}
            onKeyDown={submitOnEnter}
            placeholder="邮箱 / 昵称 / 用户 ID"
            aria-label="被举报人筛选"
            className="h-10 w-56 rounded-xl border border-line px-3 text-[13px] outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">举报时间从</span>
          <input
            type="date"
            value={draft.createdFrom}
            onChange={(event) => patchDraft({ createdFrom: event.target.value })}
            aria-label="举报时间从"
            className="h-10 rounded-xl border border-line px-3 text-[13px]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">举报时间到</span>
          <input
            type="date"
            value={draft.createdTo}
            onChange={(event) => patchDraft({ createdTo: event.target.value })}
            aria-label="举报时间到"
            className="h-10 rounded-xl border border-line px-3 text-[13px]"
          />
        </label>

        <button
          onClick={() => applyDraft(draft)}
          className="h-10 rounded-xl bg-[#16213A] px-4 text-[13px] text-white"
        >
          搜索
        </button>
        {showClear ? (
          <button
            onClick={() => applyDraft(DEFAULT_FILTERS)}
            className="h-10 rounded-xl border border-line px-4 text-[13px]"
          >
            清空筛选
          </button>
        ) : null}
      </div>

      {!canWrite ? (
        <p className="mt-3 rounded-xl bg-[#F7F9FF] px-3 py-2 text-[12px] text-muted">
          你的角色（{identity?.role}）对举报只有查看权限，无法审核。
        </p>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-2xl border border-line bg-card shadow-card p-4">
          <p className="text-[13px] text-red-500">{error}</p>
          <button
            onClick={() => void reload(page)}
            className="mt-3 tf-btn"
          >
            重试
          </button>
        </div>
      ) : null}

      {loading ? <p className="mt-3 text-[12px] text-muted">加载中…</p> : null}

      {result && result.total > 0 ? (
        <p data-testid="reports-summary" className="mt-3 text-[12px] text-muted">
          共 {result.total} 条 · 第 {page} / {totalPages} 页
        </p>
      ) : null}

      {result && result.total === 0 ? (
        <div data-testid="reports-empty" className="mt-3 rounded-2xl border border-line bg-card shadow-card p-4">
          <p className="text-[13px] font-medium">
            {appliedHasFilters ? "没有符合当前筛选条件的举报" : "系统中还没有任何举报"}
          </p>
          {/* The two empty cases are different problems: an empty queue is not
              something a filter change can fix. */}
          <p className="mt-1 text-[12px] text-muted">
            {appliedHasFilters
              ? "试试放宽状态、原因或时间范围。"
              : "有用户提交举报后，会出现在这里。"}
          </p>
          {appliedHasFilters ? (
            <button
              onClick={() => applyDraft(DEFAULT_FILTERS)}
              className="mt-3 tf-btn"
            >
              清空筛选
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 space-y-3">
        {result?.items.map((item) => {
          const target = deriveReportTargetType(item);
          return (
            <div
              key={item.id}
              data-testid="report-row"
              data-target-type={target}
              className="rounded-2xl border border-line bg-card shadow-card p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[14px] font-medium">
                  <Link href={`/reports/${item.id}`} className="underline">
                    {item.reporter.nickname ?? item.reporter.email}
                  </Link>{" "}
                  →{" "}
                  <Link href={`/users/${item.reportedUser.id}`} className="underline">
                    {item.reportedUser.nickname ?? item.reportedUser.email}
                  </Link>
                </p>
                <span
                  data-testid="report-target-badge"
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${REPORT_TARGET_BADGE_CLASS[target]}`}
                >
                  {REPORT_TARGET_LABELS[target]}
                </span>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-1 text-[12px] text-muted">
                <span>{reportReasonLabel(item.reason)}</span>
                <span>·</span>
                <StatusBadge status={item.status} domain="REPORT" testId="status-badge" />
                <span>·</span>
                <span>被举报人 {statusLabel(item.reportedUser.status, "USER")}</span>
                <span>·</span>
                <span>{formatTime(item.createdAt)}</span>
              </p>
              {item.description ? <p className="mt-1 text-[12px]">{item.description}</p> : null}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link
                  href={`/reports/${item.id}`}
                  data-testid="report-detail-link"
                  className="tf-btn tf-btn-sm"
                >
                  查看详情
                </Link>
                {canWrite
                  ? (["reviewing", "resolved", "rejected"] as const).map((action) => (
                      <button
                        key={action}
                        onClick={() => setPending({ item, action })}
                        disabled={acting === item.id}
                        className={`h-9 rounded-xl px-3 text-[12px] disabled:opacity-40 ${
                          action === "rejected" ? "border border-line" : "border border-line"
                        }`}
                      >
                        {acting === item.id ? "…" : ACTION_LABELS[action].label}
                      </button>
                    ))
                  : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* `totalPages > 1` and not `>= 1`: with no rows the pager is meaningless,
          and 「第 1 / 0 页」 must never be rendered. */}
      {result && totalPages > 1 ? (
        <div className="mt-4 flex items-center gap-2">
          <button
            disabled={page <= 1 || loading}
            onClick={() => void reload(page - 1)}
            className="tf-btn"
          >
            上一页
          </button>
          <span className="text-[12px] text-muted">
            第 {page} / {totalPages} 页
          </span>
          <button
            disabled={page >= totalPages || loading}
            onClick={() => void reload(page + 1)}
            className="tf-btn"
          >
            下一页
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        busy={acting !== null}
        title={pending ? ACTION_LABELS[pending.action].title : ""}
        description={pending ? ACTION_LABELS[pending.action].description : ""}
        confirmLabel={pending ? ACTION_LABELS[pending.action].label : "确认"}
        onCancel={() => setPending(null)}
        onConfirm={(payload) => void submitReview(payload)}
      />
    </>
  );
}

function friendlyError(error: unknown): string {
  const code = (error as { code?: string }).code;
  if (code === "VALIDATION_ERROR") return "筛选条件无效，请检查日期格式。";
  if (code === "REASON_REQUIRED") return "请填写处理原因。";
  if (code === "REPORT_NOT_FOUND") return "这条举报已不存在。";
  if (code === "PERMISSION_DENIED") return "你的角色没有审核举报的权限。";
  return error instanceof Error ? error.message : "加载失败，请稍后重试";
}
