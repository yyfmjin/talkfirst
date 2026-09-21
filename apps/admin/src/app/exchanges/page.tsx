"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Shell } from "@/components/shell";
import { statusLabel } from "@/components/status-badge";
import { ApiRequestError, apiFetch } from "@/lib/api";

/**
 * Phase C3 — the Contact Exchange list.
 *
 * ## What this page is
 *
 * An inspection console for `ExchangeRequest` rows. It is **read-only**: there
 * is no cancel, approve, reject or status-change on this page, even though
 * `exchanges:write` exists in the permission matrix. The matrix describes the
 * role model; it does not oblige this phase to ship a mutation.
 *
 * ## What it deliberately does NOT show
 *
 * It never shows a social handle. `SharedSocialAccount` is the only proof that
 * one person may see another's account, and the handle itself — a Telegram
 * @username, a phone number — is not something an operator sees merely because
 * they are an operator. The list does not even load the share relation; the
 * detail screen reports 「谁 与 谁 · 平台」 without the account behind it.
 *
 * ## Draft vs applied
 *
 * The inputs hold a *draft*; pressing 筛选 applies it. Keeping the two apart is
 * what stops a request firing on every keystroke, and it matches the Users and
 * Reports screens. The applied filters are what paging re-runs, so changing a
 * dropdown without pressing 筛选 does not silently re-page.
 *
 * ## `createdTo` is inclusive of the whole day
 *
 * The API compares `createdTo` literally (`lte`), so a bare `2026-03-04` would
 * mean midnight and exclude everything that happened during the day. The date
 * input is therefore widened to `T23:59:59.999Z` before it is sent, exactly as
 * the Users, Reports and Moderation screens already do.
 */

type ExchangeItem = {
  id: string;
  status: string;
  platforms: string[];
  createdAt: string;
  requester: { id: string; nickname: string | null };
  receiver: { id: string; nickname: string | null };
};

type ExchangeListResponse = {
  items: ExchangeItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export default function ExchangesPage() {
  return (
    <Shell>
      <ExchangesScreen />
    </Shell>
  );
}

type Filters = {
  status: string;
  platform: string;
  user: string;
  createdFrom: string;
  createdTo: string;
};

const DEFAULT_FILTERS: Filters = {
  status: "",
  platform: "",
  user: "",
  createdFrom: "",
  createdTo: "",
};

/**
 * The four real `ExchangeStatus` values, and nothing else.
 *
 * There is deliberately no `EXPIRED` / `COMPLETED` / `REVOKED` option: those are
 * not stored states, and offering them would invite an operator to believe an
 * exchange can reach a state the database cannot represent.
 */
const STATUS_OPTIONS = [
  { value: "", label: "全部" },
  { value: "PENDING", label: statusLabel("PENDING", "EXCHANGE") },
  { value: "ACCEPTED", label: statusLabel("ACCEPTED", "EXCHANGE") },
  { value: "REJECTED", label: statusLabel("REJECTED", "EXCHANGE") },
  { value: "CANCELLED", label: statusLabel("CANCELLED", "EXCHANGE") },
];

/**
 * The real `SocialPlatform` members, mirroring `prisma/schema.prisma`.
 *
 * Written out rather than derived, because the admin app has no access to the
 * generated Prisma client. The API ignores a value it does not recognise, so a
 * drift here degrades to "the filter does nothing" rather than a bad request —
 * but the list is still kept complete on purpose: twelve members, not the
 * handful one would guess.
 */
const PLATFORM_OPTIONS = [
  { value: "", label: "全部" },
  { value: "INSTAGRAM", label: "INSTAGRAM" },
  { value: "TELEGRAM", label: "TELEGRAM" },
  { value: "WHATSAPP", label: "WHATSAPP" },
  { value: "DISCORD", label: "DISCORD" },
  { value: "X", label: "X" },
  { value: "TIKTOK", label: "TIKTOK" },
  { value: "WECHAT", label: "WECHAT" },
  { value: "QQ", label: "QQ" },
  { value: "STEAM", label: "STEAM" },
  { value: "YOUTUBE", label: "YOUTUBE" },
  { value: "FACEBOOK", label: "FACEBOOK" },
  { value: "TALKFIRST", label: "TALKFIRST" },
];

function hasAnyFilter(filters: Filters): boolean {
  return Object.values(filters).some((value) => value.trim() !== "");
}

function buildPath(filters: Filters, page: number): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.platform) params.set("platform", filters.platform);
  if (filters.user.trim()) params.set("user", filters.user.trim());
  if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
  if (filters.createdTo) params.set("createdTo", `${filters.createdTo}T23:59:59.999Z`);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/admin/exchanges${query ? `?${query}` : ""}`;
}

function ExchangesScreen() {
  const router = useRouter();
  const [draft, setDraft] = useState<Filters>(DEFAULT_FILTERS);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ExchangeListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /**
   * Ticket for the newest in-flight request. A response whose ticket is stale
   * is dropped, so the table always reflects the most recent query.
   */
  const ticket = useRef(0);

  const load = useCallback(
    async (nextPage: number, effective: Filters) => {
      const mine = ++ticket.current;
      setLoading(true);
      setError("");
      try {
        const data = await apiFetch<ExchangeListResponse>(buildPath(effective, nextPage));
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

  /** Enter submits, so a keyword does not require reaching for the mouse. */
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
          <h1 className="text-[20px] font-semibold">交换</h1>
          <p className="mt-1 text-[13px] text-muted">
            查看用户之间的联系方式交换请求。此页面只读，不产生审计记录。
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
        <div data-testid="exchanges-error" className="mt-4 rounded-2xl border border-line bg-card shadow-card p-4">
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
        <div className="flex flex-col gap-1">
          <label htmlFor="exchange-status" className="text-[11px] text-muted">
            状态
          </label>
          <select
            id="exchange-status"
            data-testid="exchange-status-filter"
            value={draft.status}
            onChange={(e) => patchDraft({ status: e.target.value })}
            className="h-9 rounded-xl border border-line bg-white px-3 text-[13px]"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="exchange-platform" className="text-[11px] text-muted">
            平台
          </label>
          <select
            id="exchange-platform"
            data-testid="exchange-platform-filter"
            value={draft.platform}
            onChange={(e) => patchDraft({ platform: e.target.value })}
            className="h-9 rounded-xl border border-line bg-white px-3 text-[13px]"
          >
            {PLATFORM_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="exchange-user" className="text-[11px] text-muted">
            用户
          </label>
          <input
            id="exchange-user"
            data-testid="exchange-user-filter"
            type="text"
            value={draft.user}
            onChange={(e) => patchDraft({ user: e.target.value })}
            onKeyDown={submitOnEnter}
            placeholder="搜索用户 ID / 昵称"
            className="h-9 w-56 rounded-xl border border-line px-3 text-[13px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="exchange-from" className="text-[11px] text-muted">
            创建时间（起）
          </label>
          <input
            id="exchange-from"
            data-testid="exchange-created-from"
            type="date"
            value={draft.createdFrom}
            onChange={(e) => patchDraft({ createdFrom: e.target.value })}
            className="h-9 rounded-xl border border-line px-3 text-[13px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="exchange-to" className="text-[11px] text-muted">
            创建时间（止）
          </label>
          <input
            id="exchange-to"
            data-testid="exchange-created-to"
            type="date"
            value={draft.createdTo}
            onChange={(e) => patchDraft({ createdTo: e.target.value })}
            className="h-9 rounded-xl border border-line px-3 text-[13px]"
          />
        </div>
        <button
          type="button"
          data-testid="exchange-apply-filters"
          onClick={() => applyDraft(draft)}
          disabled={loading}
          className="tf-btn"
        >
          筛选
        </button>
        {appliedHasFilters || hasAnyFilter(draft) ? (
          <button
            type="button"
            data-testid="exchange-clear-filters"
            onClick={() => applyDraft(DEFAULT_FILTERS)}
            disabled={loading}
            className="tf-btn text-muted"
          >
            清除筛选
          </button>
        ) : null}
      </div>

      {loading && !result ? (
        <p data-testid="exchanges-loading" className="mt-6 text-[13px] text-muted">
          加载中…
        </p>
      ) : null}

      {result && result.total === 0 ? (
        <p data-testid="exchanges-empty" className="mt-6 text-[13px] text-muted">
          {appliedHasFilters ? "没有符合当前筛选条件的交换记录" : "暂无交换记录"}
        </p>
      ) : null}

      {result && result.total > 0 ? (
        <>
          <div className="mt-4 rounded-2xl border border-line bg-card shadow-card overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="pb-2 pr-4 font-normal">交换 ID</th>
                  <th className="pb-2 pr-4 font-normal">请求方</th>
                  <th className="pb-2 pr-4 font-normal">接收方</th>
                  <th className="pb-2 pr-4 font-normal">平台</th>
                  <th className="pb-2 pr-4 font-normal">状态</th>
                  <th className="pb-2 pr-4 font-normal">创建时间</th>
                  <th className="pb-2 font-normal">操作</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((item) => (
                  <tr
                    key={item.id}
                    data-testid={`exchange-row-${item.id}`}
                    className="border-b border-line/60"
                  >
                    <td className="py-2 pr-4 font-mono text-[11px] text-muted">
                      {item.id.slice(0, 8)}…
                    </td>
                    <td className="py-2 pr-4">
                      {item.requester.nickname ?? item.requester.id.slice(0, 8)}
                    </td>
                    <td className="py-2 pr-4">
                      {item.receiver.nickname ?? item.receiver.id.slice(0, 8)}
                    </td>
                    <td className="py-2 pr-4">
                      {/* One badge per platform: `platforms` is an array, and a
                          multi-platform request must show every platform it
                          asked for rather than the first one. */}
                      {item.platforms.length === 0 ? (
                        <span className="text-[11px] text-muted">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {item.platforms.map((platform) => (
                            <span
                              key={platform}
                              data-testid={`exchange-platform-${platform}`}
                              className="rounded-full bg-[#EDEFF3] px-2 py-0.5 text-[11px] font-medium text-[#5A6472]"
                            >
                              {platform}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        data-testid={`exchange-status-${item.status}`}
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadge(item.status)}`}
                      >
                        {statusLabel(item.status, "EXCHANGE")}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-muted">
                      {new Date(item.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2">
                      <Link
                        href={`/exchanges/${item.id}`}
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
                disabled={currentPage <= 1 || loading}
                onClick={() => void load(currentPage - 1, filters)}
                className="tf-btn tf-btn-sm"
              >
                上一页
              </button>
              <span className="text-muted">
                第 {currentPage} / {totalPages} 页（共 {result.total} 条）
              </span>
              <button
                type="button"
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
 * Status colours. `PENDING` is the only state that needs attention; `ACCEPTED`
 * is settled, `REJECTED` and `CANCELLED` are both terminal but different in
 * meaning, so they are not collapsed into one grey.
 */
function statusBadge(status: string): string {
  if (status === "ACCEPTED") return "bg-[#DCFCE7] text-[#166534]";
  if (status === "PENDING") return "bg-[#FEF3C7] text-[#92400E]";
  if (status === "REJECTED") return "bg-[#FEE2E2] text-[#991B1B]";
  if (status === "CANCELLED") return "bg-[#EDEFF3] text-[#5A6472]";
  return "bg-[#EDEFF3] text-[#5A6472]";
}

/**
 * Never surface a database error, a stack trace or a connection string. The
 * guard is a denylist rather than an allowlist: a message that mentions Prisma
 * or SQL is replaced outright, and anything else the API wrote in its envelope
 * is already a human-readable sentence.
 */
function friendlyError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "加载失败，请稍后重试";
  const code = error.code;
  if (code === "PERMISSION_DENIED") return "无权限访问";
  if (code === "VALIDATION_ERROR") return "筛选条件不合法";
  if (code === "EXCHANGE_NOT_FOUND") return "交换记录不存在";
  const message = error.message ?? "";
  if (!message || /prisma|stack|\bat \w|ECONNREFUSED|ETIMEDOUT|\bSQL\b|\b500\b/i.test(message)) {
    return "加载失败，请稍后重试";
  }
  return message;
}
