"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { statusLabel } from "@/components/status-badge";
import { ApiRequestError, apiFetch } from "@/lib/api";

/**
 * Phase C3 — the Contact Exchange detail screen.
 *
 * ## What this page is
 *
 * A single `ExchangeRequest`, read from `GET /admin/exchanges/:id`: who asked,
 * who received, which platforms, the request's own message, the status, the
 * share relations granted under it, the connection it claims to belong to, and
 * the (currently empty) handling history.
 *
 * ## What it deliberately does NOT show
 *
 * **It never shows a social handle.** `SharedSocialAccount` proves that one
 * person granted another the right to see one account on one platform, and the
 * share relation is reported as 「谁 → 谁 · 平台」 — without the account behind
 * it. A Telegram @username or a phone number is not something an operator sees
 * merely because they are an operator. The API does not return it, so this
 * screen could not render it even if it wanted to; the absence is asserted in
 * the browser tests as well.
 *
 * ## `connectionId` has no foreign key
 *
 * `ExchangeRequest.connectionId` is a bare UUID with no relation to
 * `Connection`, so the value is a claim rather than a guarantee. When the
 * connection no longer exists the API reports `connectionAvailable: false` and
 * this screen renders 「连接记录不可用」 — the exchange itself is still shown in
 * full, because an operator inspecting an exchange must not be blocked by a
 * stale link.
 *
 * ## The conversation is an id and nothing more
 *
 * `conversationId` is a real foreign key and always resolves, but the
 * participants' chat is not this screen's subject. Only the id is shown, so an
 * operator can correlate; no message body is loaded, by this page or by the
 * API behind it.
 */

type Party = { id: string; nickname: string | null };

type SharedAccount = {
  ownerId: string;
  viewerId: string;
  platform: string;
  createdAt: string;
};

type ExchangeDetail = {
  id: string;
  connectionId: string;
  conversationId: string;
  platforms: string[];
  message: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type ConnectionContext = {
  id: string;
  status: string;
  createdAt: string;
  conversationId: string | null;
  userA: Party;
  userB: Party;
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

type ExchangeDetailResponse = {
  exchange: ExchangeDetail;
  requester: Party;
  receiver: Party;
  sharedAccounts: SharedAccount[];
  connectionAvailable: boolean;
  connection: ConnectionContext | null;
  history: HistoryItem[];
};

export default function ExchangeDetailPage() {
  return (
    <Shell>
      <ExchangeDetailScreen />
    </Shell>
  );
}

function ExchangeDetailScreen() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [data, setData] = useState<ExchangeDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch<ExchangeDetailResponse>(`/admin/exchanges/${id}`);
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
      setError(friendlyError(requestError));
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Display name for a party id, resolved from the two people this exchange is
   * actually about.
   *
   * The share rows carry `ownerId`/`viewerId` as ids, and the only nicknames the
   * API returns for this exchange are the requester's and the receiver's. A
   * share between those two therefore renders as 「Alice → Bob」. An id that is
   * neither — which the schema permits, since a share is not constrained to the
   * exchange's two parties — falls back to the truncated id rather than to a
   * fabricated name.
   */
  function partyLabel(partyId: string): string {
    if (!data) return partyId.slice(0, 8);
    if (data.requester.id === partyId) return data.requester.nickname ?? partyId.slice(0, 8);
    if (data.receiver.id === partyId) return data.receiver.nickname ?? partyId.slice(0, 8);
    return partyId.slice(0, 8);
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold">交换详情</h1>
          <p className="mt-1 text-[13px] text-muted">交换 ID：{id}</p>
        </div>
        <Link
          href="/exchanges"
          className="tf-btn"
        >
          返回列表
        </Link>
      </div>

      {error ? (
        <div data-testid="exchange-detail-error" className="mt-4 rounded-2xl border border-line bg-card shadow-card p-4">
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

      {loading && !data ? (
        <p data-testid="exchange-detail-loading" className="mt-4 text-[13px] text-muted">
          加载中…
        </p>
      ) : null}

      {data ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-2xl border border-line bg-card shadow-card p-4">
            <h2 className="text-[15px] font-semibold">交换信息</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 text-[13px] md:grid-cols-2">
              <div>
                <p className="text-muted">状态</p>
                <p className="mt-1">
                  <span
                    data-testid="exchange-detail-status"
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadge(data.exchange.status)}`}
                  >
                    {statusLabel(data.exchange.status, "EXCHANGE")}
                  </span>
                </p>
              </div>
              <div>
                <p className="text-muted">创建时间</p>
                <p className="mt-1">{new Date(data.exchange.createdAt).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted">更新时间</p>
                <p className="mt-1">{new Date(data.exchange.updatedAt).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted">连接 ID</p>
                <p className="mt-1 break-all font-mono text-[11px]">
                  {data.exchange.connectionId}
                </p>
              </div>
              <div>
                <p className="text-muted">会话 ID</p>
                <p
                  data-testid="exchange-detail-conversation"
                  className="mt-1 break-all font-mono text-[11px]"
                >
                  {data.exchange.conversationId}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-card shadow-card p-4">
            <h2 className="text-[15px] font-semibold">请求方</h2>
            <div className="mt-3 text-[13px]">
              <p>
                <span className="text-muted">ID：</span>
                <Link href={`/users/${data.requester.id}`} className="text-blue-600 underline">
                  {data.requester.id}
                </Link>
              </p>
              <p className="mt-1">
                <span className="text-muted">昵称：</span>
                {data.requester.nickname ?? "—"}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-card shadow-card p-4">
            <h2 className="text-[15px] font-semibold">接收方</h2>
            <div className="mt-3 text-[13px]">
              <p>
                <span className="text-muted">ID：</span>
                <Link href={`/users/${data.receiver.id}`} className="text-blue-600 underline">
                  {data.receiver.id}
                </Link>
              </p>
              <p className="mt-1">
                <span className="text-muted">昵称：</span>
                {data.receiver.nickname ?? "—"}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-line bg-card shadow-card p-4">
            <h2 className="text-[15px] font-semibold">平台</h2>
            {data.exchange.platforms.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted">未指定平台</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {data.exchange.platforms.map((platform) => (
                  <span
                    key={platform}
                    data-testid={`exchange-detail-platform-${platform}`}
                    className="rounded-full bg-[#EDEFF3] px-2.5 py-0.5 text-[12px] font-medium text-[#5A6472]"
                  >
                    {platform}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-card shadow-card p-4">
            <h2 className="text-[15px] font-semibold">请求留言</h2>
            <p data-testid="exchange-detail-message" className="mt-2 text-[13px]">
              {data.exchange.message ?? <span className="text-muted">无留言</span>}
            </p>
          </div>

          <div className="rounded-2xl border border-line bg-card shadow-card p-4">
            <h2 className="text-[15px] font-semibold">共享账号</h2>
            <p className="mt-1 text-[12px] text-muted">
              仅展示共享关系，不展示账号标识。
            </p>
            {data.sharedAccounts.length === 0 ? (
              <p data-testid="exchange-shares-empty" className="mt-2 text-[13px] text-muted">
                暂无共享记录
              </p>
            ) : (
              <ul data-testid="exchange-shares" className="mt-2 space-y-2 text-[13px]">
                {data.sharedAccounts.map((share) => (
                  <li
                    key={`${share.ownerId}-${share.viewerId}-${share.platform}`}
                    data-testid={`exchange-share-${share.platform}`}
                    className="rounded-xl border border-line/60 bg-[#FBFCFE] p-3"
                  >
                    <p className="font-medium">
                      {partyLabel(share.ownerId)} → {partyLabel(share.viewerId)}
                    </p>
                    <p className="mt-1 text-muted">
                      <span className="rounded-full bg-[#EDEFF3] px-2 py-0.5 text-[11px] font-medium text-[#5A6472]">
                        {share.platform}
                      </span>
                      <span className="ml-2">{new Date(share.createdAt).toLocaleString()}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-card shadow-card p-4">
            <h2 className="text-[15px] font-semibold">连接上下文</h2>
            {!data.connectionAvailable || !data.connection ? (
              <p data-testid="exchange-connection-missing" className="mt-2 text-[13px] text-muted">
                连接记录不可用（原连接已不存在）
              </p>
            ) : (
              <div data-testid="exchange-connection" className="mt-3 text-[13px]">
                <p>
                  <span className="text-muted">连接 ID：</span>
                  <Link
                    href={`/connections/${data.connection.id}`}
                    className="text-blue-600 underline"
                  >
                    {data.connection.id}
                  </Link>
                </p>
                <p className="mt-1">
                  <span className="text-muted">状态：</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusBadge(data.connection.status)}`}
                  >
                    {statusLabel(data.connection.status, "CONNECTION")}
                  </span>
                </p>
                <p className="mt-1">
                  <span className="text-muted">参与人：</span>
                  {data.connection.userA.nickname ?? data.connection.userA.id.slice(0, 8)} ·{" "}
                  {data.connection.userB.nickname ?? data.connection.userB.id.slice(0, 8)}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-card shadow-card p-4">
            <h2 className="text-[15px] font-semibold">处理历史</h2>
            {data.history.length === 0 ? (
              <p data-testid="exchange-history-empty" className="mt-2 text-[13px] text-muted">
                暂无处理记录
              </p>
            ) : (
              <ul className="mt-2 space-y-2 text-[13px]">
                {data.history.map((h) => (
                  <li key={h.id} className="rounded-xl border border-line/60 bg-[#FBFCFE] p-3">
                    <p className="font-medium">{h.action}</p>
                    <p className="mt-1 text-muted">
                      {new Date(h.createdAt).toLocaleString()} ·{" "}
                      {h.actorType === "SYSTEM"
                        ? "系统 · 自动"
                        : `admin ${h.adminId?.slice(0, 8) ?? "-"}`}
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

/**
 * Status colours. `PENDING` is the only state that needs attention; `ACCEPTED`
 * is settled, while `REJECTED` and `CANCELLED` are both terminal but mean
 * different things, so they are not collapsed into one grey.
 */
function statusBadge(status: string): string {
  if (status === "ACCEPTED") return "bg-[#DCFCE7] text-[#166534]";
  if (status === "PENDING") return "bg-[#FEF3C7] text-[#92400E]";
  if (status === "REJECTED") return "bg-[#FEE2E2] text-[#991B1B]";
  if (status === "CANCELLED") return "bg-[#EDEFF3] text-[#5A6472]";
  return "bg-[#EDEFF3] text-[#5A6472]";
}

/**
 * Maps the API envelope to the sentence the operator sees. A 404 is named
 * precisely; anything that looks like a database error, a stack trace or a
 * connection string is replaced outright rather than shown.
 */
function friendlyError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "加载失败，请稍后重试";
  const code = error.code;
  if (code === "EXCHANGE_NOT_FOUND") return "交换记录不存在";
  if (code === "PERMISSION_DENIED") return "无权限访问";
  if (code === "VALIDATION_ERROR") return "请求参数不合法";
  const message = error.message ?? "";
  if (!message || /prisma|stack|\bat \w|ECONNREFUSED|ETIMEDOUT|\bSQL\b|\b500\b/i.test(message)) {
    return "加载失败，请稍后重试";
  }
  return message;
}
