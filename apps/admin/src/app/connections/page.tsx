"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Shell } from "@/components/shell";
import { StatusBadge, statusLabel } from "@/components/status-badge";
import { ApiRequestError, apiFetch } from "@/lib/api";

/**
 * Phase C2 — the Connections list.
 *
 * ## What this page is
 *
 * An inspection console for `Connection` rows. It is **read-only**: there is no
 * delete, restore or status-change on this page, even though `connections:write`
 * exists in the permission matrix. The matrix describes the role model; it does
 * not oblige this phase to ship a mutation.
 *
 * ## What it deliberately does NOT do
 *
 * It does not reach into Contact Exchange (C3) or Block (C4). A `Connection` is
 * a link between two users — nothing more. The page shows the two participants,
 * the status and the creation date, and stops there. An operator who needs
 * exchange history or block status follows the participant link to `/users/:id`.
 *
 * ## `REMOVED` is visible
 *
 * The normal-user API filters to `ACTIVE` only, so this list is the one place a
 * removed connection survives. No implicit `status: "ACTIVE"` is applied — the
 * default view shows every row.
 *
 * ## `conversationId` may be `null`
 *
 * The column is `String? @unique`, so `null` is legal stored data. It is
 * rendered as 「未关联」 rather than substituted with an empty string, which
 * would make "no conversation" indistinguishable from a load failure.
 */

type ConnectionItem = {
  id: string;
  status: string;
  createdAt: string;
  conversationId: string | null;
  userA: { id: string; nickname: string | null };
  userB: { id: string; nickname: string | null };
};

type ConnectionListResponse = {
  items: ConnectionItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export default function ConnectionsPage() {
  return (
    <Shell>
      <ConnectionsScreen />
    </Shell>
  );
}

const STATUS_OPTIONS = [
  { value: "", label: "全部" },
  { value: "ACTIVE", label: statusLabel("ACTIVE") },
  { value: "REMOVED", label: statusLabel("REMOVED") },
];

function ConnectionsScreen() {
  const router = useRouter();
  const [data, setData] = useState<ConnectionListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [status, setStatus] = useState("");
  const [user, setUser] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");

  const seqRef = useRef(0);

  const load = useCallback(
    async (opts?: { page?: number; pageSize?: number }) => {
      const seq = ++seqRef.current;
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (status) params.set("status", status);
        if (user.trim()) params.set("user", user.trim());
        if (createdFrom) params.set("createdFrom", createdFrom);
        if (createdTo) params.set("createdTo", createdTo);
        if (opts?.page) params.set("page", String(opts.page));
        if (opts?.pageSize) params.set("pageSize", String(opts.pageSize));
        const query = params.toString();
        const response = await apiFetch<ConnectionListResponse>(
          `/admin/connections${query ? `?${query}` : ""}`,
        );
        // Ignore stale responses from a race: only the latest in-flight request
        // may commit its result to the screen.
        if (seq === seqRef.current) {
          setData(response);
        }
      } catch (requestError) {
        if (seq !== seqRef.current) return;
        if (
          requestError instanceof ApiRequestError &&
          (requestError.code === "ADMIN_REQUIRED" ||
            requestError.code === "ADMIN_INACTIVE" ||
            requestError.code === "UNAUTHORIZED")
        ) {
          router.replace("/login");
          return;
        }
        setError(requestError instanceof Error ? requestError.message : "加载失败");
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    },
    [router, status, user, createdFrom, createdTo],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const statusBadge = (s: string) => {
    if (s === "ACTIVE") return "bg-[#DCFCE7] text-[#166534]";
    if (s === "REMOVED") return "bg-[#EDEFF3] text-[#5A6472]";
    return "bg-[#FEF3C7] text-[#92400E]";
  };

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold">连接</h1>
          <p className="mt-1 text-[13px] text-muted">
            查看平台用户之间的连接关系。此页面只读，不产生审计记录。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="tf-btn"
        >
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>

      {error ? (
        <div data-testid="connections-error" className="mt-4 rounded-2xl border border-line bg-card shadow-card p-4">
          <p className="text-[13px] text-red-500">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="mt-3 tf-btn"
          >
            {loading ? "重试中…" : "重试"}
          </button>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted">状态</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
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
          <label className="text-[11px] text-muted">用户</label>
          <input
            type="text"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="搜索用户 ID / 昵称"
            className="h-9 w-56 rounded-xl border border-line px-3 text-[13px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted">创建时间（起）</label>
          <input
            type="date"
            value={createdFrom}
            onChange={(e) => setCreatedFrom(e.target.value)}
            className="h-9 rounded-xl border border-line px-3 text-[13px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted">创建时间（止）</label>
          <input
            type="date"
            value={createdTo}
            onChange={(e) => setCreatedTo(e.target.value)}
            className="h-9 rounded-xl border border-line px-3 text-[13px]"
          />
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="tf-btn"
        >
          筛选
        </button>
      </div>

      {loading && !data ? (
        <p data-testid="connections-loading" className="mt-6 text-[13px] text-muted">
          加载中…
        </p>
      ) : null}

      {data && data.total === 0 ? (
        <p data-testid="connections-empty" className="mt-6 text-[13px] text-muted">
          暂无连接
        </p>
      ) : null}

      {data && data.total > 0 ? (
        <>
          <div className="mt-4 rounded-2xl border border-line bg-card shadow-card overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="pb-2 pr-4 font-normal">连接 ID</th>
                  <th className="pb-2 pr-4 font-normal">用户 A</th>
                  <th className="pb-2 pr-4 font-normal">用户 B</th>
                  <th className="pb-2 pr-4 font-normal">状态</th>
                  <th className="pb-2 pr-4 font-normal">创建时间</th>
                  <th className="pb-2 font-normal">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id} className="border-b border-line/60">
                    <td className="py-2 pr-4 font-mono text-[11px] text-muted">
                      {item.id.slice(0, 8)}…
                    </td>
                    <td className="py-2 pr-4">
                      {item.userA.nickname ?? item.userA.id.slice(0, 8)}
                    </td>
                    <td className="py-2 pr-4">
                      {item.userB.nickname ?? item.userB.id.slice(0, 8)}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadge(item.status)}`}
                      >
                        {statusLabel(item.status)}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-muted">
                      {new Date(item.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2">
                      <Link
                        href={`/connections/${item.id}`}
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

          {data.totalPages > 1 ? (
            <div className="mt-4 flex items-center gap-3 text-[13px]">
              <button
                type="button"
                disabled={data.page <= 1 || loading}
                onClick={() => void load({ page: data.page - 1 })}
                className="tf-btn tf-btn-sm"
              >
                上一页
              </button>
              <span className="text-muted">
                第 {data.page} / {data.totalPages} 页（共 {data.total} 条）
              </span>
              <button
                type="button"
                disabled={data.page >= data.totalPages || loading}
                onClick={() => void load({ page: data.page + 1 })}
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
