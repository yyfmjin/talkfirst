"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { ApiRequestError, apiFetch } from "@/lib/api";

/**
 * Phase C2 — the Connection detail screen.
 *
 * ## What this page is
 *
 * A single `Connection` row, read from `GET /admin/connections/:id`. It shows
 * the two participants, the status, the creation date and the conversation id
 * (if present), and nothing else. A connection is not a contact exchange (C3)
 * and not a block (C4), so those surfaces are not reached into.
 *
 * ## `REMOVED` is readable
 *
 * An operator following a link from the list does not expect the row to vanish
 * because it was ended. The detail page renders a REMOVED connection with the
 * same shape as an ACTIVE one.
 *
 * ## `conversationId` may be `null`
 *
 * The column is `String? @unique`, so `null` is legal stored data. It is
 * rendered as 「未关联」 rather than substituted with an empty string, which
 * would make "no conversation" indistinguishable from a load failure.
 */

type Party = { id: string; nickname: string | null };

type ConnectionDetail = {
  id: string;
  status: string;
  createdAt: string;
  conversationId: string | null;
};

type HistoryItem = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  actorType: "USER" | "SYSTEM";
  adminId: string | null;
  reason: string | null;
  detail: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
};

type ConnectionDetailResponse = {
  connection: ConnectionDetail;
  userA: Party;
  userB: Party;
  history: HistoryItem[];
};

export default function ConnectionDetailPage() {
  return (
    <Shell>
      <ConnectionDetailScreen />
    </Shell>
  );
}

function ConnectionDetailScreen() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [data, setData] = useState<ConnectionDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch<ConnectionDetailResponse>(`/admin/connections/${id}`);
      setData(response);
    } catch (requestError) {
      if (
        requestError instanceof ApiRequestError &&
        (requestError.code === "ADMIN_REQUIRED" ||
          requestError.code === "ADMIN_INACTIVE" ||
          requestError.code === "UNAUTHORIZED")
      ) {
        router.replace("/login");
        return;
      }
      if (requestError instanceof ApiRequestError && requestError.code === "CONNECTION_NOT_FOUND") {
        setError("连接不存在");
      } else {
        setError(requestError instanceof Error ? requestError.message : "加载失败");
      }
    } finally {
      setLoading(false);
    }
  }, [id, router]);

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
          <h1 className="text-[20px] font-semibold">连接详情</h1>
          <p className="mt-1 text-[13px] text-muted">连接 ID：{id}</p>
        </div>
        <Link
          href="/connections"
          className="h-9 shrink-0 rounded-xl border border-line px-4 text-[13px] leading-9"
        >
          返回列表
        </Link>
      </div>

      {error ? (
        <div data-testid="connection-detail-error" className="mt-4 rounded-2xl border border-line p-4">
          <p className="text-[13px] text-red-500">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="mt-3 h-9 rounded-xl border border-line px-4 text-[13px] disabled:opacity-40"
          >
            {loading ? "重试中…" : "重试"}
          </button>
        </div>
      ) : null}

      {loading && !data ? (
        <p data-testid="connection-detail-loading" className="mt-4 text-[13px] text-muted">
          加载中…
        </p>
      ) : null}

      {data ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-2xl border border-line p-4">
            <h2 className="text-[15px] font-semibold">基本信息</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 text-[13px] md:grid-cols-2">
              <div>
                <p className="text-muted">状态</p>
                <p className="mt-1">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadge(data.connection.status)}`}
                  >
                    {data.connection.status}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-muted">创建时间</p>
                <p className="mt-1">{new Date(data.connection.createdAt).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted">会话 ID</p>
                <p className="mt-1">
                  {data.connection.conversationId ?? (
                    <span className="text-muted">未关联</span>
                  )}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-line p-4">
            <h2 className="text-[15px] font-semibold">用户 A</h2>
            <div className="mt-3 text-[13px]">
              <p>
                <span className="text-muted">ID：</span>
                <Link href={`/users/${data.userA.id}`} className="text-blue-600 underline">
                  {data.userA.id}
                </Link>
              </p>
              <p className="mt-1">
                <span className="text-muted">昵称：</span>
                {data.userA.nickname ?? "—"}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-line p-4">
            <h2 className="text-[15px] font-semibold">用户 B</h2>
            <div className="mt-3 text-[13px]">
              <p>
                <span className="text-muted">ID：</span>
                <Link href={`/users/${data.userB.id}`} className="text-blue-600 underline">
                  {data.userB.id}
                </Link>
              </p>
              <p className="mt-1">
                <span className="text-muted">昵称：</span>
                {data.userB.nickname ?? "—"}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-line p-4">
            <h2 className="text-[15px] font-semibold">处理历史</h2>
            {data.history.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted">暂无记录</p>
            ) : (
              <ul className="mt-2 space-y-2 text-[13px]">
                {data.history.map((h) => (
                  <li key={h.id} className="rounded-xl border border-line/60 p-3">
                    <p className="font-medium">{h.action}</p>
                    <p className="mt-1 text-muted">
                      {new Date(h.createdAt).toLocaleString()} ·{" "}
                      {h.actorType === "SYSTEM" ? "系统 · 自动" : `admin ${h.adminId?.slice(0, 8) ?? "-"}`}
                    </p>
                    {h.detail ? <p className="mt-1">{h.detail}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
