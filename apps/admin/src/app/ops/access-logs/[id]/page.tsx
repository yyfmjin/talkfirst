"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Shell } from "@/components/shell";
import { ApiRequestError, apiFetch } from "@/lib/api";

/**
 * Phase O2 follow-up — one HTTP access log row in full.
 *
 * ## Why this page had to exist
 *
 * The list screen has linked here since Phase O2 (`/ops/access-logs/${id}`), but
 * the route was never created, so 「查看」 was a 404. The API side was already
 * complete — `GET /admin/access-logs/:id` has been returning the row plus its
 * resolved account all along — so this is the missing half of an existing pair,
 * not a new feature.
 *
 * ## What it adds over the list row
 *
 * The list shows eight columns and deliberately omits the rest. Here the operator
 * gets the whole stored row: `requestId` (the ONLY correlation key to a
 * `SecurityEvent` for the same request), `queryDigest`, `referer`, `origin`,
 * `acceptLanguage`, `contentType` and the full `deviceHash`.
 *
 * ## The two jumps, which are the point of the screen
 *
 * 1. **该 IP 的全部记录** — links back to the list with `?ip=` applied. A single
 *    request is rarely the interesting thing; the pattern around it is. This works
 *    because the list already supports an exact `ip` filter.
 * 2. **该账号** — links to `/users/:id` for the resolved account.
 *
 * Both are ordinary links carrying the value, so the destination screen applies
 * the filter itself and stays the single owner of its own query string.
 *
 * ## What is deliberately absent
 *
 * There is no delete, no export and no edit. An audit trail that could be edited
 * would not be one — the same rule the list screen states.
 *
 * ## NULLs are states, not errors
 *
 * `ip`, `deviceHash` and `userAgent` are nullable, and `userId` outlives its
 * account by design (no foreign key). A row whose account is gone is rendered as
 * 已删除账号, and a missing IP as —, rather than failing the whole page.
 */

/** Everything `ACCESS_LOG_LIST_SELECT` projects, plus the resolved account. */
type AccessLogDetail = {
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

const RISK_LABEL: Record<string, string> = {
  LOW: "低",
  MEDIUM: "中",
  HIGH: "高",
  CRITICAL: "严重",
};

const RISK_CLASS: Record<string, string> = {
  LOW: "bg-success-wash text-success-ink",
  MEDIUM: "bg-warning-wash text-warning-ink",
  HIGH: "bg-danger-wash text-danger-ink",
  CRITICAL: "bg-danger-wash text-danger-ink",
};

export default function AccessLogDetailPage() {
  return (
    <Shell>
      <AccessLogDetailScreen />
    </Shell>
  );
}

function AccessLogDetailScreen() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = typeof params?.id === "string" ? params.id : "";

  const [detail, setDetail] = useState<AccessLogDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /** Ticket for the newest in-flight request; a stale response is dropped. */
  const ticket = useRef(0);

  const load = useCallback(async () => {
    if (!id) {
      setError("缺少日志 ID");
      setLoading(false);
      return;
    }
    const mine = ++ticket.current;
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<AccessLogDetail>(`/admin/access-logs/${id}`);
      if (mine !== ticket.current) return;
      setDetail(data);
    } catch (requestError) {
      if (mine !== ticket.current) return;
      const code = (requestError as { code?: string }).code;
      // Same redirect contract as the list screen: a session that is gone must
      // not leave the operator staring at an error they cannot act on.
      if (code === "ADMIN_REQUIRED" || code === "ADMIN_INACTIVE" || code === "UNAUTHORIZED") {
        router.replace("/login");
        return;
      }
      if (code === "ACCESS_LOG_NOT_FOUND") {
        setError("该访问日志不存在，可能已被保留策略清理。");
        return;
      }
      setError(friendlyError(requestError));
    } finally {
      if (mine === ticket.current) setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/ops/access-logs" className="text-[13px] text-muted underline">
          ← 返回访问日志
        </Link>
      </div>

      <h1 className="mt-3 text-[20px] font-semibold">访问日志详情</h1>

      {loading ? (
        <p className="mt-6 text-[13px] text-muted">加载中…</p>
      ) : error ? (
        <p data-testid="access-log-detail-error" className="mt-6 text-[13px] text-red-500">
          {error}
        </p>
      ) : detail ? (
        <>
          {/* The two jumps. Placed above the table because they are the reason an
              operator opens one row at all. */}
          <div className="mt-4 flex flex-wrap gap-2">
            {detail.ip ? (
              <Link
                href={`/ops/access-logs?ip=${encodeURIComponent(detail.ip)}`}
                data-testid="access-log-same-ip"
                className="tf-btn tf-btn-sm"
              >
                查看该 IP 的全部记录
              </Link>
            ) : null}
            {/*
              Carries the address to the ban form rather than banning from here.
              A ban needs a level and a mandatory reason, so a one-click ban would
              either guess at both or open a dialog that duplicates the form. Passing
              `?ip=` prefills the one field this screen actually knows, and leaves the
              decision where the consequences are explained.
            */}
            {detail.ip ? (
              <Link
                href={`/ops/ip-bans?ip=${encodeURIComponent(detail.ip)}`}
                data-testid="access-log-ban-ip"
                className="tf-btn tf-btn-sm"
              >
                封禁此 IP
              </Link>
            ) : null}
            {detail.account ? (
              <Link
                href={`/users/${detail.account.id}`}
                data-testid="access-log-account"
                className="tf-btn tf-btn-sm"
              >
                查看该账号
              </Link>
            ) : null}
          </div>

          <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span
                data-testid="access-log-status"
                className={
                  detail.statusCode >= 400
                    ? "font-medium text-red-500"
                    : "font-medium text-success-ink"
                }
              >
                {detail.statusCode}
              </span>
              <span className="font-mono text-[13px]">{detail.method}</span>
              <span className="break-all font-mono text-[13px]">{detail.path}</span>
              {detail.isAdmin ? (
                <span className="rounded-full bg-danger-wash px-2 py-0.5 text-[10px] font-medium text-danger-ink">
                  后台
                </span>
              ) : null}
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  RISK_CLASS[detail.riskLevel] ?? "bg-accent text-muted"
                }`}
              >
                风险 {RISK_LABEL[detail.riskLevel] ?? detail.riskLevel}
              </span>
              <span className="text-[12px] text-muted">{detail.durationMs} ms</span>
            </div>
          </div>

          <Section title="请求">
            <Row label="时间" value={new Date(detail.createdAt).toLocaleString()} />
            <Row label="请求 ID" value={detail.requestId} mono />
            <Row label="方法" value={detail.method} mono />
            <Row label="路径" value={detail.path} mono wrap />
            {/* The digest is stored INSTEAD of the raw query string, so a token or
                code that travelled in the query is not readable here. */}
            <Row label="查询摘要" value={detail.queryDigest} mono wrap />
            <Row label="Content-Type" value={detail.contentType} mono wrap />
            <Row label="错误码" value={detail.errorCode} mono />
          </Section>

          <Section title="身份">
            <Row
              label="账号"
              value={
                detail.account ? (
                  <Link href={`/users/${detail.account.id}`} className="text-blue-600 underline">
                    {detail.account.nickname ?? detail.account.email}
                  </Link>
                ) : detail.userId ? (
                  // `userId` has no foreign key on purpose, so a row can outlive its
                  // account. That is an ordinary state, rendered as one.
                  <span className="text-muted" title={detail.userId}>
                    已删除账号
                  </span>
                ) : (
                  <span className="text-muted">匿名</span>
                )
              }
            />
            {/* Shown only when the row HAS a userId, so an anonymous request does not
                display a uuid column that would always read —. */}
            {detail.userId ? <Row label="用户 ID" value={detail.userId} mono wrap /> : null}
            <Row label="已登录" value={detail.authenticated ? "是" : "否"} />
          </Section>

          <Section title="客户端">
            <Row
              label="IP"
              value={
                detail.ip ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono">{detail.ip}</span>
                    <Link
                      href={`/ops/access-logs?ip=${encodeURIComponent(detail.ip)}`}
                      className="text-[12px] text-blue-600 underline"
                    >
                      该 IP 的全部记录
                    </Link>
                  </span>
                ) : (
                  <span className="text-muted">—</span>
                )
              }
            />
            {/* NULL for every row until the device salt is configured; the column
                stores only a hash, never the raw user agent, so the UA is shown
                beside it as context rather than as the identifier. */}
            <Row
              label="设备标识"
              value={detail.deviceHash ? <span className="font-mono">{detail.deviceHash}</span> : "—"}
            />
            <Row label="User-Agent" value={detail.userAgent} wrap />
            <Row label="Referer" value={detail.referer} wrap />
            <Row label="Origin" value={detail.origin} wrap />
            <Row label="Accept-Language" value={detail.acceptLanguage} />
          </Section>
        </>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h2 className="mb-2 text-[14px] font-medium">{title}</h2>
      <dl className="rounded-2xl border border-line bg-surface p-4">{children}</dl>
    </section>
  );
}

/**
 * One label/value pair.
 *
 * `wrap` is opt-in rather than always-on: a user agent and a path need to wrap, a
 * status code and a locale do not, and wrapping everything makes a wide table of
 * two-line rows that is harder to scan than the thing it replaced.
 */
function Row({
  label,
  value,
  mono = false,
  wrap = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  wrap?: boolean;
}) {
  return (
    <div className="flex gap-3 border-b border-line/60 py-2 last:border-b-0">
      <dt className="w-32 shrink-0 text-[12px] text-muted">{label}</dt>
      <dd
        className={`min-w-0 flex-1 text-[13px] ${mono ? "font-mono text-[12px]" : ""} ${
          wrap ? "break-all" : ""
        }`}
      >
        {value === null || value === undefined || value === "" ? (
          <span className="text-muted">—</span>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

function friendlyError(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return "加载失败，请稍后重试";
  const code = error.code;
  if (code === "PERMISSION_DENIED") return "无权限访问";
  if (code === "PERMISSION_UNDECLARED") return "无权限访问";
  const message = error.message ?? "";
  // A provider or Prisma message can name internals; the console never shows one.
  if (!message || /prisma|stack|\bat \w|ECONNREFUSED|ETIMEDOUT|\bSQL\b|\b500\b/i.test(message)) {
    return "加载失败，请稍后重试";
  }
  return message;
}
