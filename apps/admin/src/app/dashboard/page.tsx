"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { ApiRequestError, apiFetch } from "@/lib/api";

/**
 * Phase B1 — platform operations dashboard.
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
  messageId: string | null;
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

  const kpis: Array<[string, number]> = data
    ? [
        ["用户总数", data.users],
        ["ACTIVE", data.active],
        ["SUSPENDED", data.suspended],
        ["BANNED", data.banned],
        ["今日新增", data.todayNewUsers],
        ["7 日新增", data.newUsers7d],
        ["待处理举报", data.reportsOpen],
        ["在线管理员", data.admins],
      ]
    : [];

  const secondary: Array<[string, number]> = data
    ? [
        ["今日活跃", data.activeToday],
        ["今日消息", data.messagesToday],
        ["有效连接", data.connections],
      ]
    : [];

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold">仪表盘</h1>
          <p className="mt-1 text-[13px] text-muted">
            平台运营状态总览。所有数字直接来自数据库，页面只读、不产生审计记录。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          // Disabled while in flight, so a second click cannot fire a duplicate
          // request. No page reload — the same endpoint is re-fetched in place.
          disabled={loading}
          className="h-9 shrink-0 rounded-xl border border-line px-4 text-[13px] disabled:opacity-40"
        >
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-line p-4">
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

      {!data && loading ? <p className="mt-4 text-[13px] text-muted">加载中…</p> : null}

      {data ? (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            {kpis.map(([label, value]) => (
              <Kpi key={label} label={label} value={value} />
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
            {secondary.map(([label, value]) => (
              <Kpi key={label} label={label} value={value} subtle />
            ))}
          </div>

          <Section title="最近举报处理" count={data.recentResolvedReports.length}>
            {data.recentResolvedReports.map((report) => (
              <Row key={report.id}>
                <p className="font-medium">
                  {report.reporter.nickname ?? report.reporter.email} →{" "}
                  {report.reportedUser.nickname ?? report.reportedUser.email}
                </p>
                <p className="mt-1 text-muted">
                  {report.reason} · {report.status} ·{" "}
                  {new Date(report.createdAt).toLocaleString()}
                </p>
              </Row>
            ))}
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
                      <span className="rounded-full bg-[#E4EAF7] px-2 py-0.5 text-[11px] font-medium text-[#4A5A7A]">
                        系统 · 自动
                      </span>
                    ) : (
                      // Defensive `?.`: `adminId` is nullable at the type level.
                      `admin ${entry.adminId?.slice(0, 8) ?? "-"}`
                    )}{" "}
                    · target {entry.targetId ? entry.targetId.slice(0, 8) : "-"}
                  </p>
                  {entry.detail ? <p className="mt-1">{entry.detail}</p> : null}
                </Row>
              );
            })}
          </Section>

          <Section title="系统自动事件" count={data.recentSystemEvents.length}>
            {data.recentSystemEvents.map((event) => (
              <Row key={event.id}>
                <p className="font-medium">{event.action}</p>
                <p className="mt-1 text-muted">
                  <span className="rounded-full bg-[#E4EAF7] px-2 py-0.5 text-[11px] font-medium text-[#4A5A7A]">
                    系统 · 自动
                  </span>{" "}
                  · {new Date(event.createdAt).toLocaleString()} · target{" "}
                  {event.targetId ? event.targetId.slice(0, 8) : "-"}
                </p>
                {event.detail ? <p className="mt-1">{event.detail}</p> : null}
              </Row>
            ))}
          </Section>
        </>
      ) : null}
    </>
  );
}

function Kpi({ label, value, subtle }: { label: string; value: number; subtle?: boolean }) {
  return (
    <div className="rounded-2xl border border-line p-4">
      <p className={`font-semibold ${subtle ? "text-[20px]" : "text-[24px]"}`}>{value}</p>
      <p className="mt-1 text-[12px] text-muted">{label}</p>
    </div>
  );
}

/** A titled block that always states its empty case rather than showing a gap. */
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
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {count === 0 ? (
        <p className="mt-2 rounded-2xl border border-line p-3 text-[12px] text-muted">暂无数据</p>
      ) : (
        <div className="mt-2 space-y-2">{children}</div>
      )}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-line p-3 text-[12px]">{children}</div>;
}
