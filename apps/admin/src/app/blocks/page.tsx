"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Shell } from "@/components/shell";
import { ApiRequestError, apiFetch } from "@/lib/api";

/**
 * Phase C4 — the Blocks list.
 *
 * ## What this page is
 *
 * An inspection console for `Block` rows. It is **read-only**: there is no
 * unblock, no edit, no delete and no bulk action on this page, even though
 * `blocks:write` exists in the permission matrix. The matrix describes the role
 * model; it does not oblige this phase to ship a mutation.
 *
 * ## There is no `id` column, and the page does not pretend otherwise
 *
 * `Block` declares `@@id([blockerId, blockedId])` — a composite key with no
 * single-column `id`. So a row is keyed by the **pair**, the 「查看」 link goes
 * to `/blocks/{blockerId}/{blockedId}`, and there is no 「屏蔽 ID」 column
 * showing a value the database cannot resolve. Inventing an id (a hash, a
 * joined string) would look tidier and be a lie.
 *
 * ## Direction is the whole meaning of a row
 *
 * `Alice → Bob` ("Alice blocks Bob") and `Bob → Alice` are **different facts**,
 * not two spellings of one relationship. The table therefore has two named,
 * ordered columns — 屏蔽方 then 被屏蔽方 — and an explicit 「屏蔽 →」 marker
 * between them, rather than a neutral 「关联用户」 pair that a reader would have
 * to guess the direction of. The API reports the pair exactly as stored; this
 * screen must not be the place where it gets quietly normalised.
 *
 * ## Draft vs applied
 *
 * The inputs hold a *draft*; pressing 筛选 applies it. Keeping the two apart is
 * what stops a request firing on every keystroke, and it matches the Users,
 * Reports, Connections and Exchanges screens. The applied filters are what
 * paging re-runs, so changing a dropdown without pressing 筛选 does not
 * silently re-page.
 *
 * ## `createdTo` is inclusive of the whole day
 *
 * The API compares `createdTo` literally (`lte`), so a bare `2026-03-04` would
 * mean midnight and exclude everything that happened during the day. The date
 * input is therefore widened to `T23:59:59.999Z` before it is sent, exactly as
 * the Users, Reports, Moderation, Connections and Exchanges screens already do.
 */

type BlockItem = {
  blockerId: string;
  blockedId: string;
  createdAt: string;
  blocker: { id: string; nickname: string | null };
  blocked: { id: string; nickname: string | null };
};

type BlockListResponse = {
  items: BlockItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export default function BlocksPage() {
  return (
    <Shell>
      <BlocksScreen />
    </Shell>
  );
}

type Filters = {
  user: string;
  createdFrom: string;
  createdTo: string;
  sort: string;
};

const DEFAULT_FILTERS: Filters = {
  user: "",
  createdFrom: "",
  createdTo: "",
  sort: "",
};

/**
 * The six orderings the API accepts, mirroring `BLOCK_SORT_ORDERS`.
 *
 * The four nickname keys are listed separately rather than collapsed into one
 * 「昵称」 option because a block has a direction: 「屏蔽方昵称」 and
 * 「被屏蔽方昵称」 are different questions, and offering a single nameless
 * 「昵称排序」 would hide which side is being sorted on.
 *
 * An empty value means "let the server pick", which is `createdAt_desc`.
 */
const SORT_OPTIONS = [
  { value: "", label: "默认（最新优先）" },
  { value: "createdAt_desc", label: "创建时间 ↓" },
  { value: "createdAt_asc", label: "创建时间 ↑" },
  { value: "blocker_nickname_asc", label: "屏蔽方昵称 ↑" },
  { value: "blocker_nickname_desc", label: "屏蔽方昵称 ↓" },
  { value: "blocked_nickname_asc", label: "被屏蔽方昵称 ↑" },
  { value: "blocked_nickname_desc", label: "被屏蔽方昵称 ↓" },
];

function hasAnyFilter(filters: Filters): boolean {
  return Object.values(filters).some((value) => value.trim() !== "");
}

function buildPath(filters: Filters, page: number): string {
  const params = new URLSearchParams();
  if (filters.user.trim()) params.set("user", filters.user.trim());
  if (filters.createdFrom) params.set("createdFrom", filters.createdFrom);
  if (filters.createdTo) params.set("createdTo", `${filters.createdTo}T23:59:59.999Z`);
  if (filters.sort) params.set("sort", filters.sort);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return `/admin/blocks${query ? `?${query}` : ""}`;
}

/** The stable per-row identity: a block has no id, so the pair is the key. */
function pairKey(item: { blockerId: string; blockedId: string }): string {
  return `${item.blockerId}-${item.blockedId}`;
}

function BlocksScreen() {
  const router = useRouter();
  const [draft, setDraft] = useState<Filters>(DEFAULT_FILTERS);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<BlockListResponse | null>(null);
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
        const data = await apiFetch<BlockListResponse>(buildPath(effective, nextPage));
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
          <h1 className="text-[20px] font-semibold">屏蔽</h1>
          <p className="mt-1 text-[13px] text-muted">
            查看用户之间的屏蔽关系。屏蔽有方向：屏蔽方主动屏蔽被屏蔽方。此页面只读，不产生审计记录。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(currentPage, filters)}
          disabled={loading}
          className="h-9 shrink-0 rounded-xl border border-line px-4 text-[13px] disabled:opacity-40"
        >
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>

      {error ? (
        <div data-testid="blocks-error" className="mt-4 rounded-2xl border border-line p-4">
          <p className="text-[13px] text-red-500">{error}</p>
          <button
            type="button"
            onClick={() => void load(currentPage, filters)}
            disabled={loading}
            className="mt-3 h-9 rounded-xl border border-line px-4 text-[13px] disabled:opacity-40"
          >
            {loading ? "重试中…" : "重试"}
          </button>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="block-user" className="text-[11px] text-muted">
            用户
          </label>
          <input
            id="block-user"
            data-testid="block-user-filter"
            type="text"
            value={draft.user}
            onChange={(e) => patchDraft({ user: e.target.value })}
            onKeyDown={submitOnEnter}
            placeholder="搜索用户 ID / 昵称（任一方）"
            className="h-9 w-56 rounded-xl border border-line px-3 text-[13px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="block-from" className="text-[11px] text-muted">
            创建时间（起）
          </label>
          <input
            id="block-from"
            data-testid="block-created-from"
            type="date"
            value={draft.createdFrom}
            onChange={(e) => patchDraft({ createdFrom: e.target.value })}
            className="h-9 rounded-xl border border-line px-3 text-[13px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="block-to" className="text-[11px] text-muted">
            创建时间（止）
          </label>
          <input
            id="block-to"
            data-testid="block-created-to"
            type="date"
            value={draft.createdTo}
            onChange={(e) => patchDraft({ createdTo: e.target.value })}
            className="h-9 rounded-xl border border-line px-3 text-[13px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="block-sort" className="text-[11px] text-muted">
            排序
          </label>
          <select
            id="block-sort"
            data-testid="block-sort"
            value={draft.sort}
            onChange={(e) => patchDraft({ sort: e.target.value })}
            className="h-9 rounded-xl border border-line bg-white px-3 text-[13px]"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          data-testid="block-apply-filters"
          onClick={() => applyDraft(draft)}
          disabled={loading}
          className="h-9 rounded-xl border border-line px-4 text-[13px] disabled:opacity-40"
        >
          筛选
        </button>
        {appliedHasFilters || hasAnyFilter(draft) ? (
          <button
            type="button"
            data-testid="block-clear-filters"
            onClick={() => applyDraft(DEFAULT_FILTERS)}
            disabled={loading}
            className="h-9 rounded-xl border border-line px-4 text-[13px] text-muted disabled:opacity-40"
          >
            清除筛选
          </button>
        ) : null}
      </div>

      {loading && !result ? (
        <p data-testid="blocks-loading" className="mt-6 text-[13px] text-muted">
          加载中…
        </p>
      ) : null}

      {result && result.total === 0 ? (
        <p data-testid="blocks-empty" className="mt-6 text-[13px] text-muted">
          {appliedHasFilters ? "没有符合当前筛选条件的屏蔽记录" : "暂无屏蔽记录"}
        </p>
      ) : null}

      {result && result.total > 0 ? (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="pb-2 pr-4 font-normal">屏蔽方</th>
                  <th className="pb-2 pr-4 font-normal">方向</th>
                  <th className="pb-2 pr-4 font-normal">被屏蔽方</th>
                  <th className="pb-2 pr-4 font-normal">创建时间</th>
                  <th className="pb-2 font-normal">操作</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((item) => (
                  <tr
                    key={pairKey(item)}
                    data-testid={`block-row-${pairKey(item)}`}
                    className="border-b border-line/60"
                  >
                    <td className="py-2 pr-4">
                      <span data-testid={`block-blocker-${pairKey(item)}`}>
                        {item.blocker.nickname ?? item.blocker.id.slice(0, 8)}
                      </span>
                    </td>
                    {/* The direction marker is its own cell so a reader cannot
                        mistake the two parties for an unordered pair. */}
                    <td className="py-2 pr-4">
                      <span
                        data-testid={`block-direction-${pairKey(item)}`}
                        className="rounded-full bg-[#FEE2E2] px-2 py-0.5 text-[11px] font-medium text-[#991B1B]"
                      >
                        屏蔽 →
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      <span data-testid={`block-blocked-${pairKey(item)}`}>
                        {item.blocked.nickname ?? item.blocked.id.slice(0, 8)}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-muted">
                      {new Date(item.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2">
                      {/* Read-only: 「查看」 is the only action, and there is no
                          unblock / edit / delete control anywhere on this page. */}
                      <Link
                        href={`/blocks/${item.blockerId}/${item.blockedId}`}
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
                className="h-8 rounded-xl border border-line px-3 disabled:opacity-40"
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
                className="h-8 rounded-xl border border-line px-3 disabled:opacity-40"
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
  if (code === "BLOCK_NOT_FOUND") return "屏蔽记录不存在";
  const message = error.message ?? "";
  if (!message || /prisma|stack|\bat \w|ECONNREFUSED|ETIMEDOUT|\bSQL\b|\b500\b/i.test(message)) {
    return "加载失败，请稍后重试";
  }
  return message;
}
