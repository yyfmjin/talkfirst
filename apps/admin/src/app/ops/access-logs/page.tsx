"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Shell } from "@/components/shell";
import { ApiRequestError, apiFetch } from "@/lib/api";

/**
 * Phase O2 — the HTTP access log ("网站访问日志").
 *
 * ## What this screen is
 *
 * A read-only console over `AccessLog`: one row per HTTP request the API handled,
 * including requests that were **rejected before any handler ran**. That last
 * part is the whole point. Until Phase O1 the audit trail was written by an
 * interceptor, and interceptors run after guards — so a 401/403 rejection or an
 * unmatched 404 left no row at all. The traffic most worth auditing was the
 * traffic that was invisible. It is now recorded by a middleware instead, and
 * this page is where it becomes readable.
 *
 * ## Read-only, and there is nothing to edit
 *
 * There is no delete, no export and no action on a row. An access log that could
 * be edited would not be an audit trail. The only affordance is 「查看」, which
 * opens the full row (hashes, referer, origin, content type) that the table
 * deliberately leaves out.
 *
 * ## Filtering is server-side
 *
 * Every control becomes a query parameter and the database does the work. The
 * page never fetches a page and then hides rows: at 168 rows that looks fine and
 * at 100 000 it silently lies, because `total` and the page count would describe
 * the unfiltered set.
 *
 * ## Draft vs applied
 *
 * Inputs hold a *draft*; pressing 筛选 applies it and reloads page 1. Paging
 * re-runs the **applied** filters, so editing a box without pressing 筛选 does
 * not quietly re-page under a different filter.
 *
 * ## NULLs are rendered as such
 *
 * `ip`, `deviceHash` and `userAgent` are all nullable, and `userId` can outlive
 * its account (there is no foreign key, on purpose). Every one of them is
 * rendered with an explicit placeholder rather than being sliced or assumed:
 * `deviceHash` is NULL for *every* row until `SECURITY_DEVICE_SALT` is
 * configured, so treating it as always-present would blank the column silently.
 */

type AccessLogItem = {
  id: string;
  requestId: string;
  method: string;
  path: string;
  queryDigest: string | null;
  statusCode: number;
  durationMs: number;
  userId: string | null;
  authenticated: boolean;
  isAdmin: boolean;
  ip: string | null;
  deviceHash: string | null;
  userAgent: string | null;
  referer: string | null;
  origin: string | null;
  acceptLanguage: string | null;
  contentType: string | null;
  errorCode: string | null;
  riskLevel: string;
  createdAt: string;
  account: { id: string; nickname: string | null; email: string } | null;
};

type AccessLogListResponse = {
  items: AccessLogItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export default function AccessLogsPage() {
  return (
    <Shell>
      <AccessLogsScreen />
    </Shell>
  );
}

type Filters = {
  ip: string;
  path: string;
  statusCode: string;
  riskLevel: string;
  authenticated: string;
  isAdmin: string;
  createdFrom: string;
  createdTo: string;
};

const DEFAULT_FILTERS: Filters = {
  ip: "",
  path: "",
  statusCode: "",
  riskLevel: "",
  authenticated: "",
  isAdmin: "",
  createdFrom: "",
  createdTo: "",
};

/** The five `riskLevel` values P1 writes; `""` means "any". */
const RISK_OPTIONS = ["", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

/** `""` and `ALL` are UI-only; neither is ever sent to the API. */
const AUTH_OPTIONS = [
  { value: "", label: "全部" },
  { value: "true", label: "已登录" },
  { value: "false", label: "未登录" },
];

function hasAnyFilter(filters: Filters): boolean {
  return Object.values(filters).some((value) => value.trim() !== "");
}

/**
 * Builds the request path from an explicit filter set.
 *
 * A module-level pure function, like every other list screen: passing the
 * filters in is what makes paging unable to pick up a half-edited draft.
 *
 * `createdTo` is widened to the end of the day. The API compares it literally
 * (`lte`), so a bare `2026-10-02` would mean midnight and exclude the whole day
 * the operator asked for.
 */
function buildPath(filters: Filters, page: number): string {
  const params = new URLSearchParams();
  if (filters.ip.trim()) params.set("ip", filters.ip.trim());
  if (filters.path.trim()) params.set("path", filters.path.trim());
  if (filters.statusCode.trim()) params.set("statusCode", filters.statusCode.trim());
  if (filters.riskLevel) params.set("riskLevel", filters.riskLevel);
  if (filters.authenticated) params.set("authenticated", filters.authenticated);
  if (filters.isAdmin) params.set("isAdmin", filters.isAdmin);
  if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
  if (filters.createdTo) params.set("createdTo", `${filters.createdTo}T23:59:59.999Z`);
  params.set("page", String(page));
  params.set("pageSize", "20");
  return `/admin/access-logs?${params.toString()}`;
}

function AccessLogsScreen() {
  const router = useRouter();
  const [draft, setDraft] = useState<Filters>(DEFAULT_FILTERS);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AccessLogListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /** Ticket for the newest in-flight request; a stale response is dropped. */
  const ticket = useRef(0);

  const load = useCallback(
    async (nextPage: number, effective: Filters) => {
      const mine = ++ticket.current;
      setLoading(true);
      setError("");
      try {
        const data = await apiFetch<AccessLogListResponse>(buildPath(effective, nextPage));
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

  function submitOnEnter(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") applyDraft(draft);
  }

  function patchDraft(patch: Partial<Filters>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  const appliedHasFilters = hasAnyFilter(filters);
  const totalPages = result?.totalPages ?? 0;
  const currentPage = result?.page ?? page;

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold">访问日志</h1>
          <p className="mt-1 text-[13px] text-muted">
            每个 HTTP 请求的记录，包含被守卫拒绝（401/403）与未匹配路由（404）的请求——
            这些请求在记录改为中间件之前不会留下任何痕迹。此页面只读，不产生审计记录。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(currentPage, filters)}
          disabled={loading}
          className="tf-btn"
        >
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>

      {error ? (
        <div
          data-testid="access-logs-error"
          className="mt-4 rounded-2xl border border-line bg-card shadow-card p-4"
        >
          <p className="text-[13px] text-red-500">{error}</p>
          <button
            type="button"
            onClick={() => void load(currentPage, filters)}
            disabled={loading}
            className="mt-3 tf-btn"
          >
            {loading ? "重试中…" : "重试"}
          </button>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">IP</span>
          <input
            aria-label="IP 筛选"
            data-testid="access-logs-ip-filter"
            type="text"
            value={draft.ip}
            onChange={(event) => patchDraft({ ip: event.target.value })}
            onKeyDown={submitOnEnter}
            placeholder="精确匹配，如 127.0.0.1"
            className="h-10 w-48 rounded-xl border border-line px-3 text-[13px]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">路径</span>
          <input
            aria-label="路径筛选"
            data-testid="access-logs-path-filter"
            type="text"
            value={draft.path}
            onChange={(event) => patchDraft({ path: event.target.value })}
            onKeyDown={submitOnEnter}
            placeholder="包含匹配，例如路径片段"
            className="h-10 w-52 rounded-xl border border-line px-3 text-[13px]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">状态码</span>
          <input
            aria-label="状态码筛选"
            data-testid="access-logs-status-filter"
            type="number"
            value={draft.statusCode}
            onChange={(event) => patchDraft({ statusCode: event.target.value })}
            onKeyDown={submitOnEnter}
            placeholder="如 401"
            className="h-10 w-24 rounded-xl border border-line px-3 text-[13px]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">风险等级</span>
          <select
            aria-label="风险等级筛选"
            data-testid="access-logs-risk-filter"
            value={draft.riskLevel}
            onChange={(event) => patchDraft({ riskLevel: event.target.value })}
            className="h-10 rounded-xl border border-line px-3 text-[13px]"
          >
            {RISK_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value === "" ? "全部" : value}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">是否登录</span>
          <select
            aria-label="登录状态筛选"
            data-testid="access-logs-auth-filter"
            value={draft.authenticated}
            onChange={(event) => patchDraft({ authenticated: event.target.value })}
            className="h-10 rounded-xl border border-line px-3 text-[13px]"
          >
            {AUTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">后台路由</span>
          <select
            aria-label="后台路由筛选"
            data-testid="access-logs-admin-filter"
            value={draft.isAdmin}
            onChange={(event) => patchDraft({ isAdmin: event.target.value })}
            className="h-10 rounded-xl border border-line px-3 text-[13px]"
          >
            {AUTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">起始日期</span>
          <input
            aria-label="起始日期"
            data-testid="access-logs-from-filter"
            type="date"
            value={draft.createdFrom}
            onChange={(event) => patchDraft({ createdFrom: event.target.value })}
            className="h-10 rounded-xl border border-line px-3 text-[13px]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted">截止日期</span>
          <input
            aria-label="截止日期"
            data-testid="access-logs-to-filter"
            type="date"
            value={draft.createdTo}
            onChange={(event) => patchDraft({ createdTo: event.target.value })}
            className="h-10 rounded-xl border border-line px-3 text-[13px]"
          />
        </label>

        <button
          type="button"
          data-testid="access-logs-apply"
          onClick={() => applyDraft(draft)}
          disabled={loading}
          className="h-10 rounded-xl bg-primary-ink px-4 text-[13px] font-medium text-white disabled:opacity-50"
        >
          筛选
        </button>

        {appliedHasFilters ? (
          <button
            type="button"
            data-testid="access-logs-clear-filters"
            onClick={() => applyDraft(DEFAULT_FILTERS)}
            disabled={loading}
            className="tf-btn text-muted"
          >
            清除筛选
          </button>
        ) : null}
      </div>

      {result ? (
        <p className="mt-3 text-[12px] text-muted">
          共 {result.total} 条记录。筛选与分页都由后端执行。
        </p>
      ) : null}

      {loading && !result ? (
        <p data-testid="access-logs-loading" className="mt-6 text-[13px] text-muted">
          加载中…
        </p>
      ) : null}

      {result && result.total === 0 ? (
        <p data-testid="access-logs-empty" className="mt-6 text-[13px] text-muted">
          {appliedHasFilters ? "没有符合当前筛选条件的访问记录" : "暂无访问记录"}
        </p>
      ) : null}

      {result && result.total > 0 ? (
        <>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-card shadow-card">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="pb-2 pr-4 font-normal">时间</th>
                  <th className="pb-2 pr-4 font-normal">IP</th>
                  <th className="pb-2 pr-4 font-normal">账号</th>
                  <th className="pb-2 pr-4 font-normal">请求</th>
                  <th className="pb-2 pr-4 font-normal">状态</th>
                  <th className="pb-2 pr-4 font-normal">耗时</th>
                  <th className="pb-2 pr-4 font-normal">设备</th>
                  <th className="pb-2 font-normal">操作</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((item) => (
                  <tr
                    key={item.id}
                    data-testid={`access-log-row-${item.id}`}
                    className="border-b border-line/60"
                  >
                    <td className="py-2 pr-4 text-muted">
                      {new Date(item.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 font-mono text-[12px]">
                      {/* `ip` is nullable: a request that never reached the
                          context (or arrived without one) has none. */}
                      {item.ip ?? <span className="text-muted">—</span>}
                    </td>
                    <td className="py-2 pr-4">
                      {/* `userId` outlives its account by design, so a missing
                          `account` is a normal state, not an error. */}
                      {item.account ? (
                        item.account.nickname ?? item.account.email
                      ) : item.userId ? (
                        <span className="text-muted" title={item.userId}>
                          已删除账号
                        </span>
                      ) : (
                        <span className="text-muted">匿名</span>
                      )}
                      {item.authenticated ? null : (
                        <span className="ml-1 rounded-full bg-accent px-2 py-0.5 text-[10px] text-muted">
                          未登录
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <span className="font-mono text-[12px]">{item.method}</span>{" "}
                      <span className="break-all font-mono text-[12px]">{item.path}</span>
                      {item.isAdmin ? (
                        <span className="ml-1 rounded-full bg-danger-wash px-2 py-0.5 text-[10px] font-medium text-danger-ink">
                          后台
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={
                          item.statusCode >= 400 ? "font-medium text-red-500" : "text-muted"
                        }
                      >
                        {item.statusCode}
                      </span>
                      {item.errorCode ? (
                        <span className="ml-1 font-mono text-[11px] text-muted">
                          {item.errorCode}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-4 text-muted">{item.durationMs} ms</td>
                    <td className="py-2 pr-4">
                      {/* NULL for every row until the device salt is configured —
                          the schema stores only a hash, never the raw UA. The
                          operator-facing wording stays Chinese; the variable name
                          belongs in `.env.example`, not on this screen. */}
                      {item.deviceHash ? (
                        <span className="font-mono text-[11px]" title={item.userAgent ?? ""}>
                          {item.deviceHash.slice(0, 8)}
                        </span>
                      ) : (
                        <span className="text-muted" title="未识别到设备标识">
                          —
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      <Link
                        href={`/ops/access-logs/${item.id}`}
                        className="text-[12px] text-blue-600 underline"
                      >
                        查看
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 ? (
            <div className="mt-4 flex items-center gap-3 text-[13px]">
              <button
                type="button"
                data-testid="access-logs-prev"
                disabled={currentPage <= 1 || loading}
                onClick={() => void load(currentPage - 1, filters)}
                className="tf-btn tf-btn-sm"
              >
                上一页
              </button>
              <span className="text-muted">
                第 {currentPage} / {totalPages} 页
              </span>
              <button
                type="button"
                data-testid="access-logs-next"
                disabled={currentPage >= totalPages || loading}
                onClick={() => void load(currentPage + 1, filters)}
                className="tf-btn tf-btn-sm"
              >
                下一页
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}

/**
 * Never surface a database error, a stack trace or a connection string.
 *
 * `PERMISSION_DENIED` gets its own sentence: a role without `ops:read` is
 * refused by the API, and "无权限访问" is the honest explanation — the nav hides
 * this page from those roles, so anyone who reaches it by URL needs to be told
 * why rather than shown a generic failure.
 */
function friendlyError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "加载失败，请稍后重试";
  const code = error.code;
  if (code === "PERMISSION_DENIED") return "无权限访问";
  if (code === "PERMISSION_UNDECLARED") return "无权限访问";
  if (code === "VALIDATION_ERROR") return "筛选条件不合法";
  const message = error.message ?? "";
  if (!message || /prisma|stack|\bat \w|ECONNREFUSED|ETIMEDOUT|\bSQL\b|\b500\b/i.test(message)) {
    return "加载失败，请稍后重试";
  }
  return message;
}
