"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Shell } from "@/components/shell";
import { apiFetch } from "@/lib/api";
import { useAdminSession } from "@/lib/session";

type ReportItem = {
  id: string;
  reason: string;
  status: string;
  description: string | null;
  messageId: string | null;
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
 * Phase B5 — the moderation workbench queue.
 *
 * ## Same data as `/reports`, a different job
 *
 * This screen reads `GET /admin/reports` — the *same* endpoint the reports
 * console uses. B5 deliberately adds no `/admin/moderation` backend: that would
 * be two URLs over one implementation, and gating it on `moderation:read` would
 * take Reports access away from SUPPORT and ANALYST, who hold `reports:read`
 * today. So the read gate here is `reports:read`, exactly as on `/reports`.
 *
 * What differs is the *framing*. `/reports` is report administration — every
 * report, every status, full filters. This is a workbench: the pending work
 * first, the evidence inline, and the disposition one click away. Both read the
 * same rows; neither is a screenshot of the other.
 *
 * ## Why the default queue is a single status, not "OPEN + REVIEWING"
 *
 * The brief asks the default queue to be OPEN + REVIEWING. The API cannot
 * express that: `AdminReportListQuery.status` is a single value
 * (`buildReportWhere` builds `{ status: normalizedStatus }`), and an
 * unrecognised value is **silently ignored** rather than rejected — so sending
 * `status=OPEN,REVIEWING` would not error, it would quietly return *every*
 * report including RESOLVED and REJECTED. A queue that silently lies about what
 * it is showing is worse than one with an explicit toggle.
 *
 * Extending the API to accept a multi-value status is out of scope for a UI
 * change (B5 §八/§二十七: report first, do not extend the filter for a page).
 * So the workbench offers the two pending statuses as an explicit switch, one
 * request at a time, reusing the existing single-value contract. `OPEN` is the
 * landing state because it is the untriaged backlog; REVIEWING is one click
 * away and its count is shown.
 *
 * ## Conventions this file follows from `/reports`
 *
 *   - draft / applied filter state, so typing does not re-query
 *   - a request ticket, so a slow response cannot overwrite a newer one
 *   - `totalPages` comes from the API and is `0` for no rows — 「第 1 / 0 页」
 *     must never render
 *   - the two empty states have different copy: a filtered miss is fixable, an
 *     empty backlog is not
 */
export default function ModerationPage() {
  return (
    <Shell>
      <ModerationQueueScreen />
    </Shell>
  );
}

/** Mirrors the API's derivation. Never read a `targetType` field — there is none. */
function targetTypeOf(item: Pick<ReportItem, "messageId">): "USER" | "MESSAGE" {
  return item.messageId ? "MESSAGE" : "USER";
}

/** The two statuses that represent outstanding moderation work. */
type QueueStatus = "OPEN" | "REVIEWING";

const QUEUE_TABS: ReadonlyArray<{ value: QueueStatus; label: string; hint: string }> = [
  { value: "OPEN", label: "待处理", hint: "尚未有人受理的举报" },
  { value: "REVIEWING", label: "审核中", hint: "已受理、等待结论的举报" },
];

/**
 * Reuses the B4 reports filters. `status` is fixed by the tab above, so it is
 * not part of this state — two controls writing the same parameter would let
 * the tab and the dropdown disagree about what is on screen.
 */
type Filters = {
  reason: string;
  targetType: string;
  reporter: string;
  reportedUser: string;
  createdFrom: string;
  createdTo: string;
};

const DEFAULT_FILTERS: Filters = {
  reason: "ALL",
  targetType: "ALL",
  reporter: "",
  reportedUser: "",
  createdFrom: "",
  createdTo: "",
};

/** The reason values the API can actually match — mirrors the B4 options list. */
const REASON_OPTIONS = [
  { value: "ALL", label: "全部原因" },
  { value: "Harassment", label: "Harassment" },
  { value: "Spam", label: "Spam" },
  { value: "Scam", label: "Scam" },
  { value: "Sexual content", label: "Sexual content" },
  { value: "Hate speech", label: "Hate speech" },
  { value: "Fake profile", label: "Fake profile" },
  { value: "Other", label: "Other" },
];

const TARGET_OPTIONS = [
  { value: "ALL", label: "全部对象" },
  { value: "USER", label: "用户" },
  { value: "MESSAGE", label: "消息" },
];

const STATUS_BADGE: Record<string, string> = {
  OPEN: "bg-[#FEF3C7] text-[#92400E]",
  REVIEWING: "bg-[#DBEAFE] text-[#1E40AF]",
  RESOLVED: "bg-[#DCFCE7] text-[#166534]",
  REJECTED: "bg-[#EDEFF3] text-[#5A6472]",
};

function hasAnyFilter(filters: Filters): boolean {
  return (
    filters.reason !== "ALL" ||
    filters.targetType !== "ALL" ||
    filters.reporter.trim() !== "" ||
    filters.reportedUser.trim() !== "" ||
    filters.createdFrom !== "" ||
    filters.createdTo !== ""
  );
}

/**
 * `ALL` is the absence of a parameter, not a sent value. An unknown value would
 * be ignored by the API anyway, but relying on that makes a typo look like a
 * filter that matched everything.
 */
function buildQuery(status: QueueStatus, filters: Filters, page: number): string {
  const params = new URLSearchParams();
  params.set("status", status);
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

function ModerationQueueScreen() {
  const router = useRouter();
  const { identity } = useAdminSession();
  const [tab, setTab] = useState<QueueStatus>("OPEN");
  const [draft, setDraft] = useState<Filters>(DEFAULT_FILTERS);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<ReportItem> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /** Ticket for the newest in-flight request; stale responses are dropped. */
  const ticket = useRef(0);

  const load = useCallback(
    async (status: QueueStatus, nextPage: number, effective: Filters) => {
      const mine = ++ticket.current;
      setLoading(true);
      setError("");
      try {
        const data = await apiFetch<Page<ReportItem>>(buildQuery(status, effective, nextPage));
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

  /** Re-runs the query that is currently applied (paging, retry). */
  const reload = useCallback(
    (nextPage: number) => load(tab, nextPage, filters),
    [filters, load, tab],
  );

  const switchTab = useCallback(
    (next: QueueStatus) => {
      setTab(next);
      void load(next, 1, filters);
    },
    [filters, load],
  );

  const applyDraft = useCallback(
    (next: Filters) => {
      setDraft(next);
      setFilters(next);
      void load(tab, 1, next);
    },
    [load, tab],
  );

  useEffect(() => {
    void load("OPEN", 1, DEFAULT_FILTERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submitOnEnter(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") applyDraft(draft);
  }

  function patchDraft(patch: Partial<Filters>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  const appliedHasFilters = hasAnyFilter(filters);
  const showClear = appliedHasFilters || hasAnyFilter(draft);
  // The API's own ceiling, `0` for an empty result set. Never recomputed here —
  // that would let the screen and the server disagree about how many pages exist.
  const totalPages = result?.totalPages ?? 0;

  return (
    <>
      <h1 className="text-[20px] font-semibold">审核工作台</h1>
      <p className="mt-1 text-[13px] text-muted">
        集中处理待办举报。数据来自举报队列（同一份数据，处理入口在这里）。
      </p>

      {/* The pending-status switch. Both values are real statuses and each is
          sent on its own — see the note on `buildQuery`. */}
      <div className="mt-4 flex flex-wrap items-center gap-2" role="tablist" aria-label="审核队列状态">
        {QUEUE_TABS.map((option) => (
          <button
            key={option.value}
            role="tab"
            aria-selected={tab === option.value}
            data-testid={`moderation-tab-${option.value}`}
            onClick={() => switchTab(option.value)}
            title={option.hint}
            className={`h-10 rounded-xl border px-4 text-[13px] ${
              tab === option.value
                ? "border-[#16213A] bg-[#16213A] font-medium text-white"
                : "border-line text-ink"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* The toolbar renders unconditionally, so a reload keeps the page
          structure instead of collapsing to a blank screen. */}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">原因</span>
          <select
            value={draft.reason}
            onChange={(event) => patchDraft({ reason: event.target.value })}
            aria-label="审核原因"
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
            aria-label="审核对象类型"
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
            placeholder="email / nickname / 用户 ID"
            aria-label="审核举报人筛选"
            className="h-10 w-56 rounded-xl border border-line px-3 text-[13px] outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">被举报人</span>
          <input
            value={draft.reportedUser}
            onChange={(event) => patchDraft({ reportedUser: event.target.value })}
            onKeyDown={submitOnEnter}
            placeholder="email / nickname / 用户 ID"
            aria-label="审核被举报人筛选"
            className="h-10 w-56 rounded-xl border border-line px-3 text-[13px] outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">举报时间从</span>
          <input
            type="date"
            value={draft.createdFrom}
            onChange={(event) => patchDraft({ createdFrom: event.target.value })}
            aria-label="审核举报时间从"
            className="h-10 rounded-xl border border-line px-3 text-[13px]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">举报时间到</span>
          <input
            type="date"
            value={draft.createdTo}
            onChange={(event) => patchDraft({ createdTo: event.target.value })}
            aria-label="审核举报时间到"
            className="h-10 rounded-xl border border-line px-3 text-[13px]"
          />
        </label>

        <button
          onClick={() => applyDraft(draft)}
          className="h-10 rounded-xl bg-[#16213A] px-4 text-[13px] text-white"
        >
          应用筛选
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

      {error ? (
        <div className="mt-3 rounded-2xl border border-line p-4">
          <p className="text-[13px] text-red-500">{error}</p>
          <button
            onClick={() => void reload(page)}
            className="mt-3 h-9 rounded-xl border border-line px-4 text-[13px]"
          >
            重试
          </button>
        </div>
      ) : null}

      {loading ? <p className="mt-3 text-[12px] text-muted">加载中…</p> : null}

      {result && result.total > 0 ? (
        <p data-testid="moderation-summary" className="mt-3 text-[12px] text-muted">
          共 {result.total} 条待办 · 第 {page} / {totalPages} 页
        </p>
      ) : null}

      {result && result.total === 0 ? (
        <div data-testid="moderation-empty" className="mt-3 rounded-2xl border border-line p-4">
          <p className="text-[13px] font-medium">
            {appliedHasFilters
              ? "没有符合当前筛选条件的举报"
              : tab === "OPEN"
                ? "暂无待处理举报"
                : "暂无审核中的举报"}
          </p>
          {/* The two cases are different problems: an empty backlog is not
              something a filter change can fix. */}
          <p className="mt-1 text-[12px] text-muted">
            {appliedHasFilters
              ? "试试放宽原因、对象或时间范围。"
              : tab === "OPEN"
                ? "所有举报都已被受理或处理完毕。"
                : "受理一条举报后，它会出现在这里。"}
          </p>
          {appliedHasFilters ? (
            <button
              onClick={() => applyDraft(DEFAULT_FILTERS)}
              className="mt-3 h-9 rounded-xl border border-line px-4 text-[13px]"
            >
              清空筛选
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 space-y-3">
        {result?.items.map((item) => {
          const target = targetTypeOf(item);
          return (
            <div
              key={item.id}
              data-testid="moderation-row"
              data-target-type={target}
              className="rounded-2xl border border-line p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[14px] font-medium">
                  <Link href={`/users/${item.reporter.id}`} className="underline">
                    {item.reporter.nickname ?? item.reporter.email}
                  </Link>{" "}
                  →{" "}
                  <Link href={`/users/${item.reportedUser.id}`} className="underline">
                    {item.reportedUser.nickname ?? item.reportedUser.email}
                  </Link>
                </p>
                <span
                  data-testid="moderation-target-badge"
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    target === "MESSAGE"
                      ? "bg-[#EDE9FE] text-[#5B21B6]"
                      : "bg-[#DBEAFE] text-[#1E40AF]"
                  }`}
                >
                  {target === "MESSAGE" ? "消息举报" : "用户举报"}
                </span>
              </div>

              <p className="mt-1 flex flex-wrap items-center gap-1 text-[12px] text-muted">
                <span>{item.reason}</span>
                <span>·</span>
                <span
                  data-testid="status-badge"
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    STATUS_BADGE[item.status] ?? "bg-[#EDEFF3] text-[#5A6472]"
                  }`}
                >
                  {item.status}
                </span>
                <span>·</span>
                <span>被举报人 {item.reportedUser.status}</span>
                <span>·</span>
                <span>{formatTime(item.createdAt)}</span>
              </p>

              {/* The report id is shown because this is a workbench: an operator
                  coordinating with someone else needs to name the exact row. */}
              <p className="mt-1 text-[11px] text-muted">
                举报 ID <span data-testid="moderation-report-id" className="font-mono">{item.id}</span>
              </p>

              {item.description ? <p className="mt-1 text-[12px]">{item.description}</p> : null}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {/* No mutation here on purpose: the queue is for triage. Acting
                    requires the evidence on the detail screen, and a second
                    mutation path would be a second place for the rules to drift. */}
                <Link
                  href={`/moderation/${item.id}`}
                  data-testid="moderation-detail-link"
                  className="h-9 rounded-xl border border-line px-3 text-[12px] leading-9"
                >
                  处理
                </Link>
                <Link
                  href={`/users/${item.reportedUser.id}`}
                  className="h-9 rounded-xl border border-line px-3 text-[12px] leading-9"
                >
                  查看被举报人
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {/* `totalPages > 1` and not `>= 1`: with no rows the pager is meaningless,
          and 「第 1 / 0 页」 must never be rendered. */}
      {result && totalPages > 1 ? (
        <div data-testid="moderation-pager" className="mt-4 flex items-center gap-2">
          <button
            disabled={page <= 1 || loading}
            onClick={() => void reload(page - 1)}
            className="h-9 rounded-xl border border-line px-4 text-[13px] disabled:opacity-40"
          >
            上一页
          </button>
          <span className="text-[12px] text-muted">
            第 {page} / {totalPages} 页
          </span>
          <button
            disabled={page >= totalPages || loading}
            onClick={() => void reload(page + 1)}
            className="h-9 rounded-xl border border-line px-4 text-[13px] disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      ) : null}

      <p className="mt-4 text-[11px] text-muted">
        当前身份：{identity?.role ?? "-"}。队列可读范围与举报控制台一致（reports:read）。
      </p>
    </>
  );
}

function friendlyError(error: unknown): string {
  const code = (error as { code?: string }).code;
  if (code === "VALIDATION_ERROR") return "筛选条件无效，请检查日期格式。";
  if (code === "PERMISSION_DENIED") return "你的角色没有查看举报的权限。";
  return error instanceof Error ? error.message : "加载失败，请稍后重试";
}
