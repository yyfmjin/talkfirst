"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { StatCard } from "@/components/stat-card";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { ApiRequestError, apiFetch } from "@/lib/api";
import {
  REPORT_TARGET_BADGE_CLASS,
  REPORT_TARGET_LABELS,
  deriveReportTargetType,
} from "@/lib/report-target";
import { useAdminSession } from "@/lib/session";
import type { Permission } from "@/lib/permissions";

/**
 * Platform operations dashboard.
 *
 * Read-only: every number here comes from `GET /admin/dashboard`, which reads
 * live PostgreSQL. Nothing on this page is hardcoded, sampled or derived on the
 * client, and the page performs no mutation — so it writes no audit entry.
 *
 * ## Zero is data
 *
 * `SUSPENDED` is genuinely 0 in the current database. A KPI that hides itself
 * when its value is zero would make "no suspensions" indistinguishable from
 * "this card is broken", so every figure renders unconditionally.
 *
 * ## Every list has three states
 *
 * loading / empty / error are distinct on purpose. The reports list is empty
 * today (no OPEN reports exist), so an empty section is the *normal* first
 * impression, not an edge case — it must never be shown as a blank gap or as a
 * permanently spinning 「加载中…」.
 *
 * ## Layout: four headline figures, then evidence
 *
 * The eight account figures were previously one undifferentiated grid of cards,
 * so the one number an operator acts on (the open-report backlog) sat at the
 * same weight as the vanity count. They are now tiered: four headline KPIs, a
 * supporting strip, and then the queues and feeds that explain them.
 *
 * No time series exists on the API, so no trend line, sparkline or chart is
 * drawn here. A fabricated graph would be the single most misleading thing this
 * screen could do.
 */

type AuditEntry = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  actorType: "USER" | "SYSTEM";
  adminId: string | null;
  detail: string | null;
  createdAt: string;
};

/** A SYSTEM event row: no `adminId` is sent, because there is no actor id. */
type SystemEvent = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: string | null;
  createdAt: string;
};

type ResolvedReport = {
  id: string;
  reason: string;
  status: string;
  // Both pointers are selected by the API; the target is derived from them,
  // because a report has no targetType column of its own.
  messageId: string | null;
  momentId: string | null;
  createdAt: string;
  reporter: { id: string; nickname: string | null; email: string };
  reportedUser: { id: string; nickname: string | null; email: string };
};

type Dashboard = {
  // Pre-existing fields.
  users: number;
  activeToday: number;
  messagesToday: number;
  connections: number;
  reportsOpen: number;
  admins: number;
  banned: number;
  // Phase B1 additions.
  active: number;
  suspended: number;
  todayNewUsers: number;
  newUsers7d: number;
  recentAudit: AuditEntry[];
  recentResolvedReports: ResolvedReport[];
  recentSystemEvents: SystemEvent[];
};

/**
 * `AdminSessionProvider` is rendered by `<Shell>`, so any consumer of the
 * session context must sit *below* it. Keeping the screen in an inner component
 * is the established pattern in this console.
 */
export default function DashboardPage() {
  return (
    <Shell>
      <DashboardScreen />
    </Shell>
  );
}

function DashboardScreen() {
  const router = useRouter();
  const { can } = useAdminSession();
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await apiFetch<Dashboard>("/admin/dashboard"));
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
      setError(requestError instanceof Error ? requestError.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="仪表盘"
        description="平台运营状态总览。所有数字直接来自数据库，页面只读、不产生审计记录。"
        actions={
          <button
            type="button"
            onClick={() => void load()}
            // Disabled while in flight, so a second click cannot fire a duplicate
            // request. No page reload — the same endpoint is re-fetched in place.
            disabled={loading}
            className="tf-btn"
          >
            {loading ? "刷新中…" : "刷新"}
          </button>
        }
      />

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} retrying={loading} className="mt-4" />
      ) : null}

      {!data && loading ? <p className="mt-4 text-[13px] text-muted">加载中…</p> : null}

      {data ? (
        <>
          {/* Four headline figures. The backlog comes first because it is the
              only one of the four an operator has to *do* something about. */}
          <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard label="用户总数" value={data.users} hint={`其中 ${data.active} 个账号可用`} />
            <StatCard label="正常账号" value={data.active} tone="success" />
            <StatCard
              label="已暂停"
              value={data.suspended}
              tone={data.suspended > 0 ? "warning" : "default"}
            />
            <StatCard
              label="待处理举报"
              value={data.reportsOpen}
              tone={data.reportsOpen > 0 ? "danger" : "default"}
            />
          </div>

          {/* The supporting strip: same figures, quieter weight. Each still
              renders at zero — a blank tile would read as a broken query. */}
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard size="sm" label="已封禁" value={data.banned} />
            <StatCard size="sm" label="今日新增" value={data.todayNewUsers} />
            <StatCard size="sm" label="7 日新增" value={data.newUsers7d} />
            <StatCard size="sm" label="在线管理员" value={data.admins} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
            <StatCard size="sm" label="今日活跃" value={data.activeToday} />
            <StatCard size="sm" label="今日消息" value={data.messagesToday} />
            <StatCard size="sm" label="有效连接" value={data.connections} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <PendingWork data={data} can={can} className="lg:col-span-2" />
            <QuickActions can={can} />
          </div>

          <Section title="最近举报处理" count={data.recentResolvedReports.length}>
            {data.recentResolvedReports.map((report) => {
              // Same helper as the reports queue and the risk feed, so the
              // three surfaces cannot disagree about what a report points at.
              const target = deriveReportTargetType(report);
              return (
              <Row key={report.id}>
                <div data-target-type={target} data-report-id={report.id}>
                  <p className="font-medium">
                    {report.reporter.nickname ?? report.reporter.email} →{" "}
                    {report.reportedUser.nickname ?? report.reportedUser.email}
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-1 text-muted">
                    <span
                      data-testid="dashboard-report-target"
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${REPORT_TARGET_BADGE_CLASS[target]}`}
                    >
                      {REPORT_TARGET_LABELS[target]}
                    </span>
                    <span>·</span>
                    <span>{report.reason}</span>
                    <span>·</span>
                    <StatusBadge status={report.status} domain="REPORT" />
                    <span>·</span>
                    <span>{new Date(report.createdAt).toLocaleString()}</span>
                  </p>
                </div>
              </Row>
              );
            })}
          </Section>

          <Section title="最近审计" count={data.recentAudit.length}>
            {data.recentAudit.map((entry) => {
              // A SYSTEM row has no administrator behind it. Only the SYSTEM
              // branch may describe the actor without an id; only the USER
              // branch reads `adminId` at all.
              const isSystem = entry.actorType === "SYSTEM";
              return (
                <Row key={entry.id}>
                  <p className="font-medium">{entry.action}</p>
                  <p className="mt-1 text-muted">
                    {new Date(entry.createdAt).toLocaleString()} ·{" "}
                    {isSystem ? (
                      <SystemBadge />
                    ) : (
                      // Defensive `?.`: `adminId` is nullable at the type level.
                      `admin ${entry.adminId?.slice(0, 8) ?? "-"}`
                    )}{" "}
                    · target {entry.targetId ? entry.targetId.slice(0, 8) : "-"}
                  </p>
                  {entry.detail ? <p className="mt-1 text-muted">{entry.detail}</p> : null}
                </Row>
              );
            })}
          </Section>

          <Section title="系统自动事件" count={data.recentSystemEvents.length}>
            {data.recentSystemEvents.map((event) => (
              <Row key={event.id}>
                <p className="font-medium">{event.action}</p>
                <p className="mt-1 text-muted">
                  <SystemBadge /> · {new Date(event.createdAt).toLocaleString()} · target{" "}
                  {event.targetId ? event.targetId.slice(0, 8) : "-"}
                </p>
                {event.detail ? <p className="mt-1 text-muted">{event.detail}</p> : null}
              </Row>
            ))}
          </Section>
        </>
      ) : null}
    </>
  );
}

/**
 * What is actually waiting on a human.
 *
 * Deliberately *not* an `EmptyState`: the dashboard's three activity feeds own
 * the 「暂无数据」 phrase, and a fourth copy would make that word ambiguous on
 * the screen where it matters most. An empty queue states its own, different
 * sentence instead.
 */
function PendingWork({
  data,
  can,
  className = "",
}: {
  data: Dashboard;
  can: (permission: Permission) => boolean;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-line bg-card p-4 shadow-card ${className}`}>
      <h2 className="tf-section-title">待处理事项</h2>
      <p className="mt-0.5 text-[12px] text-muted">需要管理员决定的内容，全部读取自实时数据库。</p>

      <div className="mt-3 rounded-xl border border-line/60 bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ink">举报队列</p>
            <p className="mt-0.5 text-[12px] text-muted">
              状态为待处理的举报，等待受理、处理或驳回。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-[18px] font-semibold tabular-nums text-ink">
              {data.reportsOpen}
            </span>
            {can("reports:read") ? (
              <Link href="/reports" className="tf-btn tf-btn-sm">
                前往处理
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {data.reportsOpen === 0 ? (
        <p className="mt-2 text-[12px] text-muted">队列已清空，当前没有需要立即处置的举报。</p>
      ) : null}

      <div className="mt-2 rounded-xl border border-line/60 bg-surface p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-ink">封禁中账号</p>
            <p className="mt-0.5 text-[12px] text-muted">
              临时封禁到期后由系统自动解封；永久封禁不会自动解除。
            </p>
          </div>
          <span className="shrink-0 text-[18px] font-semibold tabular-nums text-ink">
            {data.suspended + data.banned}
          </span>
        </div>
      </div>
    </section>
  );
}

/**
 * Role-aware shortcuts.
 *
 * Every entry is filtered by the *same* permission the sidebar uses, and the
 * labels are deliberately not identical to any nav label — `getByRole("link",
 * { name: "用户", exact: true })` must resolve to the sidebar entry alone, and a
 * shortcut sharing that name would make navigation ambiguous.
 */
const QUICK_ACTIONS: Array<{ href: string; label: string; permission: Permission }> = [
  { href: "/reports", label: "举报工作台", permission: "reports:read" },
  { href: "/users", label: "用户目录", permission: "users:read" },
  { href: "/moderation", label: "审核队列", permission: "reports:read" },
  { href: "/risk", label: "风险信号总览", permission: "risk:read" },
  { href: "/audit", label: "审计记录", permission: "audit:read" },
];

function QuickActions({ can }: { can: (permission: Permission) => boolean }) {
  const available = QUICK_ACTIONS.filter((action) => can(action.permission));

  return (
    <section className="rounded-2xl border border-line bg-card p-4 shadow-card">
      <h2 className="tf-section-title">快捷操作</h2>
      <p className="mt-0.5 text-[12px] text-muted">只列出当前角色有权限进入的页面。</p>
      <div className="mt-3 space-y-1.5">
        {available.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="flex items-center justify-between rounded-xl border border-line/60 bg-surface px-3 py-2 text-[13px] text-ink transition-colors hover:border-[#D6DAE1] hover:bg-card"
          >
            <span>{action.label}</span>
            <span aria-hidden="true" className="text-muted">
              →
            </span>
          </Link>
        ))}
      </div>
      {available.length === 0 ? (
        <p className="mt-2 text-[12px] text-muted">当前角色没有可用的操作入口。</p>
      ) : null}
    </section>
  );
}

/** A titled feed that always states its empty case rather than showing a gap. */
function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {count === 0 ? (
        <EmptyState className="mt-2" />
      ) : (
        <div className="mt-2 space-y-2">{children}</div>
      )}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-3 text-[12px] shadow-card">
      {children}
    </div>
  );
}

/** The one rendering of a machine actor. Never accompanied by an admin id. */
function SystemBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-system-wash px-2 py-0.5 text-[11px] font-medium text-system-ink">
      系统 · 自动
    </span>
  );
}
