"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Shell } from "@/components/shell";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmDialog, type ConfirmPayload } from "@/components/confirm-dialog";
import { apiFetch, apiSend } from "@/lib/api";
import { canSetUserStatus } from "@/lib/permissions";
import { useAdminSession } from "@/lib/session";
import { ACTION_META, STATUS_ACTION_ORDER, type StatusAction } from "@/lib/status-actions";

/**
 * Phase B2 — the users list.
 *
 * Enhanced in place: the search box, the status filter, the per-row status
 * actions, the note composer and the confirmation dialog are the Phase A ones,
 * unchanged. What Phase B2 adds is the rest of the query surface — country,
 * creation date range, sort, real pagination — plus the three states every list
 * needs (loading / empty / error) and a status badge per row.
 *
 * ## Filtering never happens here
 *
 * Every filter is sent to the API as a query parameter. The page never fetches
 * a page of users and then hides some of them: that shape works at 168 rows and
 * silently lies at 100 000, because `total` and the page count would then
 * describe the unfiltered set.
 *
 * ## Draft vs applied
 *
 * The inputs hold a *draft*; clicking 搜索 applies it. Keeping the two apart is
 * what makes 「清空筛选」 correct — it can clear the inputs and re-query with the
 * cleared values in the same tick, instead of re-querying with the values it is
 * in the middle of discarding.
 *
 * ## A stale response must never win
 *
 * Filtering is deliberately interruptible — the search button stays enabled
 * while a request is in flight, because an operator who mistyped should be able
 * to correct it immediately rather than wait. Correctness therefore comes from
 * a request ticket rather than from disabling the control: a response is
 * discarded unless it belongs to the newest request. Without that, a slow first
 * response lands after a fast second one and the list shows results for a query
 * the operator has already replaced.
 *
 * ## Empty, loading and error are three different things
 *
 * 「暂无用户」 must never be shown for a failed request, and a spinner must never
 * be the permanent state. Zero results after filtering is the normal case here,
 * so it gets an explicit message and a way out.
 */

type AdminUser = {
  id: string;
  email: string;
  nickname: string | null;
  countryCode: string | null;
  status: string;
  isAdmin: boolean;
  bannedAt: string | null;
  banReason: string | null;
  suspendedUntil: string | null;
  createdAt: string;
  lastActiveAt: string | null;
};

/**
 * `totalPages` is the API's own ceiling, so it is `0` when there are no rows.
 * The page treats `0` as "no pages" rather than rendering 「第 1 / 0 页」.
 */
type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

/** Everything that goes into the query string. */
type Filters = {
  search: string;
  status: string;
  country: string;
  createdFrom: string;
  createdTo: string;
  sortField: string;
  sortDirection: string;
};

const PAGE_SIZE = 20;

/**
 * The default query. `createdAt_desc` is the order this list has always used,
 * so the default view is unchanged by Phase B2.
 */
const DEFAULT_FILTERS: Filters = {
  search: "",
  status: "ALL",
  country: "",
  createdFrom: "",
  createdTo: "",
  sortField: "createdAt",
  sortDirection: "desc",
};

/** `ALL` is the wire value the API has always understood for "no status filter". */
const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "ALL", label: "全部" },
  { value: "ACTIVE", label: "ACTIVE" },
  { value: "DISABLED", label: "DISABLED" },
  { value: "SUSPENDED", label: "SUSPENDED" },
  { value: "BANNED", label: "BANNED" },
];

/**
 * Sort is chosen as field + direction and composed into the API's whitelisted
 * key. The UI never shows the raw key: `createdAt_desc` is a wire format, not
 * something an operator should have to read.
 */
const SORT_FIELDS: Array<{ value: string; label: string }> = [
  { value: "createdAt", label: "创建时间" },
  { value: "lastActiveAt", label: "最近活跃" },
  { value: "nickname", label: "昵称" },
  { value: "status", label: "状态" },
];

const SORT_DIRECTIONS: Array<{ value: string; label: string }> = [
  { value: "desc", label: "倒序" },
  { value: "asc", label: "正序" },
];


/**
 * Builds the request path from an explicit filter set.
 *
 * Deliberately a module-level pure function: passing the filters in means a
 * caller can never accidentally re-query with a value it has just replaced.
 */
function buildPath(filters: Filters, nextPage: number) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  params.set("status", filters.status);
  if (filters.country.trim()) params.set("country", filters.country.trim());
  if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
  // `<input type="date">` yields a bare calendar date and `createdTo` is an
  // inclusive upper bound, so a bare date would cut the whole selected day off.
  // The end of that day is sent explicitly, leaving the API bound literal.
  if (filters.createdTo) params.set("createdTo", `${filters.createdTo}T23:59:59.999Z`);
  params.set("sort", `${filters.sortField}_${filters.sortDirection}`);
  params.set("page", String(nextPage));
  params.set("pageSize", String(PAGE_SIZE));
  return `/admin/users?${params.toString()}`;
}

function hasAnyFilter(filters: Filters) {
  return Boolean(
    filters.search.trim() ||
      filters.status !== "ALL" ||
      filters.country.trim() ||
      filters.createdFrom ||
      filters.createdTo ||
      filters.sortField !== DEFAULT_FILTERS.sortField ||
      filters.sortDirection !== DEFAULT_FILTERS.sortDirection,
  );
}

type PendingAction = {
  user: AdminUser;
  action: StatusAction;
};

/**
 * `AdminSessionProvider` lives *inside* `<Shell>`, so anything that calls
 * `useAdminSession()` must be a child of `<Shell>`.
 *
 * Phase A originally called `useAdminSession()` in this same component and
 * rendered `<Shell>` from it — so the hook read the default context
 * (`identity: null`, `can: () => false`) instead of the real session. The
 * visible effect was that `role` was always `null` and `canWrite` always false,
 * so `canSetUserStatus(null, …)` rejected every action and **no role ever saw a
 * single status button**, including SUPER_ADMIN. The backend was correct the
 * whole time, which is why the API-level tests passed; only a real browser test
 * could catch it.
 */
export default function UsersPage() {
  return (
    <Shell>
      <UsersScreen />
    </Shell>
  );
}

function UsersScreen() {
  const router = useRouter();
  const { identity } = useAdminSession();
  const [draft, setDraft] = useState<Filters>(DEFAULT_FILTERS);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<AdminUser> | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  /**
   * Ticket for the newest in-flight request. A response whose ticket is stale
   * is dropped, so the list always reflects the most recent query.
   */
  const ticket = useRef(0);

  const role = identity?.role ?? null;
  const canWrite = Boolean(identity?.permissions?.includes("users:write"));

  const load = useCallback(
    async (nextPage: number, effective: Filters) => {
      const mine = ++ticket.current;
      setLoading(true);
      setError("");
      try {
        const data = await apiFetch<Page<AdminUser>>(buildPath(effective, nextPage));
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

  /** Runs the confirmed status change. The reason is mandatory by design. */
  async function runStatusChange(payload: ConfirmPayload) {
    if (!pending) return;
    const { user, action } = pending;
    setActing(user.id);
    try {
      await apiSend(`/admin/users/${user.id}/status`, "POST", {
        action,
        reason: payload.reason,
        ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
      });
      setPending(null);
      await reload(page);
    } catch (requestError) {
      setError(friendlyError(requestError));
    } finally {
      setActing(null);
    }
  }

  async function addNote(userId: string) {
    const body = (note[userId] ?? "").trim();
    if (!body) {
      setError("备注不能为空");
      return;
    }
    setActing(userId);
    try {
      await apiSend(`/admin/users/${userId}/notes`, "POST", { body });
      setNote((current) => ({ ...current, [userId]: "" }));
      await reload(page);
    } catch (requestError) {
      setError(friendlyError(requestError));
    } finally {
      setActing(null);
    }
  }

  /** Enter submits, so a keyword does not require reaching for the mouse. */
  function submitOnEnter(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") applyDraft(draft);
  }

  function patchDraft(patch: Partial<Filters>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  const appliedHasFilters = hasAnyFilter(filters);
  const showClear = appliedHasFilters || hasAnyFilter(draft);
  // `totalPages` comes from the API and is 0 for an empty result set, so the
  // pager is only meaningful when there is at least one row.
  const totalPages = result?.totalPages ?? 0;
  const currentPage = result?.page ?? page;

  return (
    <>
      <h1 className="text-[20px] font-semibold">用户管理</h1>
      <p className="mt-1 text-[13px] text-muted">
        共 {result?.total ?? 0} 名用户。筛选、排序与分页都由后端执行。
      </p>

      {/* The toolbar renders unconditionally, so a reload keeps the page
          structure instead of collapsing to a blank screen. */}
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">搜索</span>
          {/* The placeholder is a superset of the Phase A one on purpose: the
              shared `openUserDetail()` browser helper locates this field by the
              substring 「搜索 email / nickname」, so extending it keeps every
              existing test working while the field also advertises id search. */}
          <input
            value={draft.search}
            onChange={(event) => patchDraft({ search: event.target.value })}
            onKeyDown={submitOnEnter}
            placeholder="搜索 email / nickname / 用户 ID"
            aria-label="搜索用户"
            className="h-10 w-72 rounded-xl border border-line px-3 text-[13px] outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">状态</span>
          <select
            value={draft.status}
            onChange={(event) => patchDraft({ status: event.target.value })}
            aria-label="状态筛选"
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
          <span className="text-[11px] text-muted">国家</span>
          {/* A plain two-letter code rather than a country picker: the project
              has no shared country list, and inventing one (or a Country table)
              for a single filter would be the tail wagging the dog. */}
          <input
            value={draft.country}
            onChange={(event) => patchDraft({ country: event.target.value.toUpperCase() })}
            onKeyDown={submitOnEnter}
            placeholder="如 US"
            aria-label="国家筛选"
            maxLength={2}
            className="h-10 w-24 rounded-xl border border-line px-3 text-[13px] uppercase outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">创建时间从</span>
          <input
            type="date"
            value={draft.createdFrom}
            onChange={(event) => patchDraft({ createdFrom: event.target.value })}
            aria-label="创建时间从"
            className="h-10 rounded-xl border border-line px-3 text-[13px]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">创建时间到</span>
          <input
            type="date"
            value={draft.createdTo}
            onChange={(event) => patchDraft({ createdTo: event.target.value })}
            aria-label="创建时间到"
            className="h-10 rounded-xl border border-line px-3 text-[13px]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">排序</span>
          <select
            value={draft.sortField}
            onChange={(event) => patchDraft({ sortField: event.target.value })}
            aria-label="排序字段"
            className="h-10 rounded-xl border border-line px-3 text-[13px]"
          >
            {SORT_FIELDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">方向</span>
          <select
            value={draft.sortDirection}
            onChange={(event) => patchDraft({ sortDirection: event.target.value })}
            aria-label="排序方向"
            className="h-10 rounded-xl border border-line px-3 text-[13px]"
          >
            {SORT_DIRECTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
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
          你的角色（{role}）为只读，无法修改用户状态。
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
        <p data-testid="users-summary" className="mt-3 text-[12px] text-muted">
          共 {result.total} 人 · 第 {currentPage} / {totalPages} 页
        </p>
      ) : null}

      {result && result.total === 0 ? (
        <div className="mt-3 rounded-2xl border border-line bg-card shadow-card p-4">
          <p className="text-[13px] font-medium">暂无用户</p>
          {/* The two empty cases are different problems: an empty database is
              not something a filter change can fix. */}
          <p className="mt-1 text-[12px] text-muted">
            {appliedHasFilters ? "没有符合当前筛选条件的用户。" : "系统中还没有任何用户。"}
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
          // Each button appears only if this role may actually perform it.
          const actions = STATUS_ACTION_ORDER.filter((action) => canSetUserStatus(role, action));

          return (
            <div key={item.id} className="rounded-2xl border border-line bg-card shadow-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[14px] font-medium">
                    <Link href={`/users/${item.id}`} className="underline">
                      {item.nickname ?? item.email}
                    </Link>{" "}
                    {item.isAdmin ? "🛡️" : ""}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-1 text-[12px] text-muted">
                    <span>{item.email}</span>
                    <span>·</span>
                    <StatusBadge status={item.status} testId="status-badge" />
                    <span>·</span>
                    <span>国家 {item.countryCode ?? "-"}</span>
                    <span>·</span>
                    <span>创建 {formatTime(item.createdAt)}</span>
                    <span>·</span>
                    <span>最近活跃 {formatTime(item.lastActiveAt)}</span>
                  </p>
                  <p className="mt-1 text-[12px] text-muted">
                    {item.suspendedUntil
                      ? `解封于 ${new Date(item.suspendedUntil).toLocaleString()}`
                      : (item.banReason ?? "无封禁原因")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {actions.map((action) => (
                    <button
                      key={action}
                      onClick={() => setPending({ user: item, action })}
                      disabled={acting === item.id}
                      className={`h-9 rounded-xl px-3 text-[12px] disabled:opacity-40 ${
                        action === "ban"
                          ? "bg-red-500 text-white"
                          : "border border-line"
                      }`}
                    >
                      {ACTION_META[action].label}
                    </button>
                  ))}
                  {canWrite && actions.length === 0 ? (
                    <span className="text-[11px] text-muted">无可用操作</span>
                  ) : null}
                </div>
              </div>
              {canWrite ? (
                <div className="mt-3 flex gap-2">
                  <input
                    value={note[item.id] ?? ""}
                    onChange={(event) => setNote((current) => ({ ...current, [item.id]: event.target.value }))}
                    placeholder="写一条内部备注…"
                    className="h-9 flex-1 rounded-xl border border-line px-3 text-[12px] outline-none"
                  />
                  <button
                    onClick={() => void addNote(item.id)}
                    disabled={acting === item.id}
                    className="h-9 rounded-xl bg-[#16213A] px-3 text-[12px] text-white disabled:opacity-40"
                  >
                    备注
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Present whenever there is a page to navigate. The buttons carry their
          own disabled state rather than the pager disappearing, so "there is
          only one page" and "paging is broken" look different. */}
      {result && result.total > 0 ? (
        <div className="mt-4 flex items-center gap-2">
          <button
            disabled={currentPage <= 1 || loading}
            onClick={() => void reload(currentPage - 1)}
            className="tf-btn"
          >
            上一页
          </button>
          <button
            disabled={currentPage >= totalPages || loading}
            onClick={() => void reload(currentPage + 1)}
            className="tf-btn"
          >
            下一页
          </button>
          <span data-testid="users-pager" className="text-[12px] text-muted">
            第 {currentPage} / {totalPages} 页
          </span>
        </div>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        busy={acting !== null}
        title={pending ? ACTION_META[pending.action].title : ""}
        description={pending ? ACTION_META[pending.action].describe(pending.user) : ""}
        danger={pending ? ACTION_META[pending.action].danger : undefined}
        requirePhrase={pending ? ACTION_META[pending.action].phrase : undefined}
        withExpiry={pending ? Boolean(ACTION_META[pending.action].withExpiry) : false}
        confirmLabel={pending ? ACTION_META[pending.action].label : "确认"}
        onCancel={() => setPending(null)}
        onConfirm={(payload) => void runStatusChange(payload)}
      />
    </>
  );
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

/**
 * Never show an administrator a raw internal failure.
 *
 * The API answers with a clean envelope, so in practice `message` is already
 * presentable. This is the belt to that braces: if a proxy or a future gateway
 * hands back a Prisma error, a stack trace or a bare status code, it is
 * replaced rather than printed.
 */
function friendlyError(error: unknown): string {
  if (!(error instanceof Error)) return "加载失败，请稍后重试";
  const message = error.message ?? "";
  if (!message || /prisma|stack|\bat \w|ECONNREFUSED|ETIMEDOUT|\bSQL\b|\b500\b/i.test(message)) {
    return "加载失败，请稍后重试";
  }
  return message;
}
