"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { ConfirmDialog, type ConfirmPayload } from "@/components/confirm-dialog";
import { statusLabel } from "@/components/status-badge";
import { reportReasonLabel } from "@/lib/report-reasons";
import { ApiRequestError, apiFetch, apiSend } from "@/lib/api";
import { canSetUserStatus } from "@/lib/permissions";
import { useAdminSession } from "@/lib/session";
import { ACTION_META, STATUS_ACTION_ORDER, type StatusAction } from "@/lib/status-actions";

type AuditItem = {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  actorType: "USER" | "SYSTEM";
  adminId: string | null;
  reason: string | null;
  detail: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
};

type Detail = {
  id: string;
  email: string;
  nickname: string | null;
  avatarUrl: string | null;
  countryCode: string | null;
  status: string;
  isAdmin: boolean;
  bannedAt: string | null;
  banReason: string | null;
  suspendedUntil: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  adminUser: { role: string; isActive: boolean } | null;
  profileCompletion: { completed: number; total: number; percentage: number; missing: string[] };
  connectionCount: number;
  reportsReceivedCount: number;
  reportsMadeCount: number;
  blocksMadeCount: number;
  blocksReceivedCount: number;
  socialAccountCount: number;
  reportsReceived: Array<{ id: string; reason: string; status: string; createdAt: string }>;
  reportsMade: Array<{ id: string; reason: string; status: string; createdAt: string }>;
  adminNotes: Array<{ id: string; body: string; adminId: string; createdAt: string }>;
  auditSummary: AuditItem[];
};

/**
 * `AdminSessionProvider` is rendered *inside* `<Shell>`, so `useAdminSession()`
 * must be called by a child of `<Shell>` — see the long note in
 * `app/users/page.tsx` for the Phase A bug this avoids.
 */
export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Shell>
      <UserDetailScreen params={params} />
    </Shell>
  );
}

function UserDetailScreen({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { identity } = useAdminSession();
  const [userId, setUserId] = useState<string | null>(null);
  const [data, setData] = useState<Detail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<StatusAction | null>(null);
  const [acting, setActing] = useState(false);

  const role = identity?.role ?? null;
  const canWrite = Boolean(identity?.permissions?.includes("users:write"));

  useEffect(() => {
    void params.then((value) => setUserId(value.id));
  }, [params]);

  const load = useCallback(async () => {
    if (!userId) return;
    setError("");
    try {
      setData(await apiFetch<Detail>(`/admin/users/${userId}`));
    } catch (requestError) {
      const code = requestError instanceof ApiRequestError ? requestError.code : "";
      if (code === "ADMIN_REQUIRED" || code === "ADMIN_INACTIVE" || code === "UNAUTHORIZED") {
        router.replace("/login");
        return;
      }
      // Phase A+: the API answers 404 USER_NOT_FOUND for an unknown id. That is a
      // distinct state, not a transient failure — surface it as such instead of
      // leaving the screen on 「加载中…」 forever.
      if (code === "USER_NOT_FOUND") {
        setNotFound(true);
        return;
      }
      setError(requestError instanceof Error ? requestError.message : "加载失败");
    }
  }, [userId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs the confirmed status change. The reason is mandatory by design. */
  async function runStatusChange(payload: ConfirmPayload) {
    if (!pending || !userId) return;
    setActing(true);
    try {
      await apiSend(`/admin/users/${userId}/status`, "POST", {
        action: pending,
        reason: payload.reason,
        ...(payload.expiresAt ? { expiresAt: payload.expiresAt } : {}),
      });
      setPending(null);
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "操作失败");
    } finally {
      setActing(false);
    }
  }

  if (notFound) {
    return (
      <>
        <Link href="/users" className="text-[13px] text-muted underline">
          ← 返回用户列表
        </Link>
        <h1 className="mt-2 text-[20px] font-semibold">用户不存在</h1>
        <p className="mt-2 text-[13px] text-muted">
          找不到 ID 为 <span className="font-mono">{userId}</span> 的用户。该账号可能已被删除。
        </p>
        <Link
          href="/users"
          className="mt-4 tf-btn"
        >
          返回用户列表
        </Link>
      </>
    );
  }

  // Only the actions this role may actually perform are rendered.
  const actions = STATUS_ACTION_ORDER.filter((action) => canSetUserStatus(role, action));

  return (
    <>
      <Link href="/users" className="text-[13px] text-muted underline">
        ← 返回用户列表
      </Link>
      <h1 className="mt-2 text-[20px] font-semibold">用户详情</h1>
      {error ? <p className="mt-3 text-[13px] text-red-500">{error}</p> : null}
      {!data && !error ? <p className="mt-3 text-[13px] text-muted">加载中…</p> : null}
      {data ? (
        <div className="mt-4 space-y-4">
          {/* 基础资料 */}
          <section className="rounded-2xl border border-line bg-card shadow-card p-4">
            <p className="text-[15px] font-medium">
              {data.nickname ?? data.email} {data.isAdmin ? "🛡️" : ""}
            </p>
            <p className="mt-1 text-[12px] text-muted">
              {data.email} · {statusLabel(data.status)} · {data.countryCode ?? "-"}
              {data.adminUser ? ` · ${data.adminUser.role}` : ""}
            </p>
            <p className="mt-1 text-[12px] text-muted">封禁原因：{data.banReason ?? "—"}</p>
            {data.suspendedUntil ? (
              <p className="mt-1 text-[12px] text-muted">
                解封时间：{new Date(data.suspendedUntil).toLocaleString()}
              </p>
            ) : null}
          </section>

          {/* 资料完整度 */}
          <section className="rounded-2xl border border-line bg-card shadow-card p-4" data-testid="profile-completion">
            <h2 className="text-[14px] font-semibold">资料完整度</h2>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-2 w-32 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-blue-500"
                  style={{ width: `${data.profileCompletion.percentage}%` }}
                />
              </div>
              <span className="text-[12px] text-muted">
                {data.profileCompletion.completed} / {data.profileCompletion.total}（
                {data.profileCompletion.percentage}%）
              </span>
            </div>
            {data.profileCompletion.missing.length > 0 ? (
              <p className="mt-1 text-[11px] text-muted">
                缺失：{data.profileCompletion.missing.join("、")}
              </p>
            ) : null}
          </section>

          {/* 统计卡片 */}
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="连接" value={data.connectionCount} testId="stat-connections" />
            <StatCard label="收到举报" value={data.reportsReceivedCount} testId="stat-reports-received" />
            <StatCard label="发出举报" value={data.reportsMadeCount} testId="stat-reports-made" />
            <StatCard label="被封锁" value={data.blocksReceivedCount} testId="stat-blocks-received" />
            <StatCard label="封锁他人" value={data.blocksMadeCount} testId="stat-blocks-made" />
            <StatCard label="社交账号" value={data.socialAccountCount} testId="stat-social-accounts" />
          </section>

          {/* 账号操作 */}
          <section className="rounded-2xl border border-line bg-card shadow-card p-4">
            <h2 className="text-[14px] font-semibold">账号操作</h2>
            {canWrite ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {actions.map((action) => (
                  <button
                    key={action}
                    onClick={() => setPending(action)}
                    disabled={acting}
                    className={`h-9 rounded-xl px-3 text-[12px] disabled:opacity-40 ${
                      action === "ban" ? "bg-red-500 text-white" : "border border-line"
                    }`}
                  >
                    {ACTION_META[action].label}
                  </button>
                ))}
                {actions.length === 0 ? (
                  <span className="text-[11px] text-muted">无可用操作</span>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 rounded-xl bg-[#F7F9FF] px-3 py-2 text-[12px] text-muted">
                你的角色（{role}）为只读，无法修改用户状态。
              </p>
            )}
          </section>

          {/* 被举报（最近10条） */}
          <section className="rounded-2xl border border-line bg-card shadow-card p-4">
            <h2 className="text-[14px] font-semibold">
              被举报（共 {data.reportsReceivedCount} 条，最近 {data.reportsReceived.length} 条）
            </h2>
            {data.reportsReceived.length === 0 ? (
              <p className="mt-1 text-[12px] text-muted">无</p>
            ) : (
              data.reportsReceived.map((item) => (
                <p key={item.id} className="mt-1 text-[12px] text-muted">
                  {reportReasonLabel(item.reason)} · {statusLabel(item.status)}
                </p>
              ))
            )}
          </section>

          {/* 发出举报（最近10条） */}
          <section className="rounded-2xl border border-line bg-card shadow-card p-4">
            <h2 className="text-[14px] font-semibold">
              发出举报（共 {data.reportsMadeCount} 条，最近 {data.reportsMade.length} 条）
            </h2>
            {data.reportsMade.length === 0 ? (
              <p className="mt-1 text-[12px] text-muted">无</p>
            ) : (
              data.reportsMade.map((item) => (
                <p key={item.id} className="mt-1 text-[12px] text-muted">
                  {reportReasonLabel(item.reason)} · {statusLabel(item.status)}
                </p>
              ))
            )}
          </section>

          {/* 审计摘要 */}
          <section className="rounded-2xl border border-line bg-card shadow-card p-4">
            <h2 className="text-[14px] font-semibold">管理员操作记录（最近 {data.auditSummary.length} 条）</h2>
            {data.auditSummary.length === 0 ? (
              <p className="mt-1 text-[12px] text-muted">无</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {data.auditSummary.map((item) => (
                  <li key={item.id} className="text-[12px] text-muted">
                    <span className="font-medium">
                      {item.actorType === "SYSTEM" ? "系统 · 自动" : `admin ${item.adminId ?? "—"}`}
                    </span>
                    <span className="mx-1">·</span>
                    <span>{item.action}</span>
                    {item.reason ? (
                      <>
                        <span className="mx-1">·</span>
                        <span>{item.reason}</span>
                      </>
                    ) : null}
                    <span className="mx-1">·</span>
                    <span className="text-[11px]">{new Date(item.createdAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 内部备注 */}
          <section className="rounded-2xl border border-line bg-card shadow-card p-4">
            <h2 className="text-[14px] font-semibold">内部备注（{data.adminNotes.length}）</h2>
            {data.adminNotes.map((item) => (
              <p key={item.id} className="mt-1 text-[12px] text-muted">
                {item.body}
              </p>
            ))}
          </section>
        </div>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        busy={acting}
        title={pending ? ACTION_META[pending].title : ""}
        description={pending && data ? ACTION_META[pending].describe(data) : ""}
        danger={pending ? ACTION_META[pending].danger : undefined}
        requirePhrase={pending ? ACTION_META[pending].phrase : undefined}
        withExpiry={pending ? Boolean(ACTION_META[pending].withExpiry) : false}
        confirmLabel={pending ? ACTION_META[pending].label : "确认"}
        onCancel={() => setPending(null)}
        onConfirm={(payload) => void runStatusChange(payload)}
      />
    </>
  );
}

function StatCard({ label, value, testId }: { label: string; value: number; testId?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card shadow-card p-3" data-testid={testId}>
      <p className="text-[20px] font-semibold">{value}</p>
      <p className="text-[11px] text-muted">{label}</p>
    </div>
  );
}
