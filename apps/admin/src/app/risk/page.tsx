"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/shell";
import { ApiRequestError, apiFetch } from "@/lib/api";
import {
  REPORT_TARGET_BADGE_CLASS,
  REPORT_TARGET_LABELS,
  deriveReportTargetType,
} from "@/lib/report-target";

/**
 * Phase C1 — the Risk Center.
 *
 * ## What this page is
 *
 * An **operational overview of facts already in the database**. It is not a
 * risk engine, and it has no severity model: the platform stores no risk level,
 * no score and no risk table, and Phase C forbids inventing one. So every figure
 * here is a count of a stored fact, fetched from `GET /admin/risk`.
 *
 * ## What it deliberately does NOT do
 *
 * It never interprets a status as a risk level. `BANNED` is not "high risk" and
 * `SUSPENDED` is not "scam" — those would be business rules nobody has defined.
 * The page states what the database says and stops there.
 *
 * The 「待核查异常举报」 section lists reports where the reporter and the reported
 * user are the same account. Those rows come from a known latent defect in
 * `SafetyService.recordAutoFlag`, which this phase is explicitly forbidden to
 * repair. So the section reports the *signal* and names it neutrally — it never
 * claims the row is a machine flag, and never accuses the account.
 *
 * ## Zero is data
 *
 * Every KPI renders unconditionally. A card that hid itself at zero would make
 * "no suspensions" indistinguishable from "this card is broken".
 *
 * ## Read-only
 *
 * There is no mutation on this page, so it writes no audit entry. Every link
 * goes to a screen that already exists (`/reports/:id`, `/moderation/:id`,
 * `/users/:id`) — this phase adds no Risk detail route.
 */

type Party = { id: string; nickname: string | null; email: string };

type RiskReport = {
  id: string;
  reason: string;
  status: string;
  description: string | null;
  // Both pointers are selected by the API, because the target of a report is
  // derived from them -- there is no targetType column to read.
  messageId: string | null;
  momentId: string | null;
  createdAt: string;
  reporter: Party;
  reportedUser: Party & { status?: string };
};

/**
 * An audit row. `actorType` is optional at the type level only because the
 * audit page treats it that way for pre-Phase-A rows; the Risk endpoint always
 * sends it.
 */
type RiskAction = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  actorType?: "USER" | "SYSTEM";
  adminId: string | null;
  detail: string | null;
  before: unknown;
  after: unknown;
  createdAt: string;
};

type RiskOverview = {
  overview: {
    totalReports: number;
    openReports: number;
    reviewingReports: number;
    resolvedReports: number;
    rejectedReports: number;
    suspendedUsers: number;
    bannedUsers: number;
    disabledUsers: number;
    activeUsers: number;
    suspiciousSelfReports: number;
  };
  recentReports: RiskReport[];
  recentActions: RiskAction[];
  suspiciousSignals: RiskReport[];
};

/**
 * `AdminSessionProvider` is rendered by `<Shell>`, so any consumer of the
 * session context must sit *below* it. Keeping the screen in an inner component
 * is the established pattern in this console.
 */
export default function RiskPage() {
  return (
    <Shell>
      <RiskScreen />
    </Shell>
  );
}

/** Human-readable labels for the audit vocabulary the endpoint returns. */
const ACTION_LABELS: Record<string, string> = {
  ADMIN_USER_ACTIVATE: "恢复用户",
  ADMIN_USER_DISABLE: "停用用户",
  ADMIN_USER_BAN: "永久封禁",
  ADMIN_USER_SUSPEND: "临时封禁",
  ADMIN_USER_UNBAN: "解除封禁",
  REPORT_REVIEWING: "受理举报",
  REPORT_RESOLVED: "处理举报",
  REPORT_REJECTED: "驳回举报",
  SYSTEM_USER_SUSPENSION_EXPIRED: "临时封禁到期",
};

const STATUS_BADGE: Record<string, string> = {
  OPEN: "bg-[#FEF3C7] text-[#92400E]",
  REVIEWING: "bg-[#DBEAFE] text-[#1E40AF]",
  RESOLVED: "bg-[#DCFCE7] text-[#166534]",
  REJECTED: "bg-[#EDEFF3] text-[#5A6472]",
};

function RiskScreen() {
  const router = useRouter();
  const [data, setData] = useState<RiskOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await apiFetch<RiskOverview>("/admin/risk"));
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
        ["举报总量", data.overview.totalReports],
        ["待处理举报", data.overview.openReports],
        ["审核中举报", data.overview.reviewingReports],
        ["已处理举报", data.overview.resolvedReports],
        ["已驳回举报", data.overview.rejectedReports],
        ["SUSPENDED", data.overview.suspendedUsers],
        ["BANNED", data.overview.bannedUsers],
        ["DISABLED", data.overview.disabledUsers],
        ["ACTIVE", data.overview.activeUsers],
        ["待核查异常举报", data.overview.suspiciousSelfReports],
      ]
    : [];

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold">风险中心</h1>
          <p className="mt-1 text-[13px] text-muted">
            基于平台现有数据的运营概览。所有数字直接来自数据库，页面只读、不产生审计记录。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          // Disabled while in flight so a second click cannot fire a duplicate
          // request. No page reload — the same endpoint is re-fetched in place.
          disabled={loading}
          className="tf-btn"
        >
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>

      {error ? (
        <div data-testid="risk-error" className="mt-4 rounded-2xl border border-line bg-card shadow-card p-4">
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

      {!data && loading ? <p className="mt-4 text-[13px] text-muted">加载中…</p> : null}

      {data ? (
        <>
          <div data-testid="risk-kpis" className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-5">
            {kpis.map(([label, value]) => (
              <div
                key={label}
                // Each card carries its own key so a browser test can bind a
                // number to the label it belongs to. Locating the card by "the
                // div that contains this text" is ambiguous — every ancestor
                // grid contains it too — and the assertion would silently read
                // a neighbouring card's value.
                data-testid={`risk-kpi-${label}`}
                className="rounded-2xl border border-line bg-card shadow-card p-4"
              >
                <p data-testid="risk-kpi-value" className="text-[24px] font-semibold">
                  {value}
                </p>
                <p className="mt-1 text-[12px] text-muted">{label}</p>
              </div>
            ))}
          </div>

          {/*
            The counts above are facts, not verdicts. This note is deliberately
            on the page so an operator reading "BANNED 2" does not read it as a
            risk assessment.
          */}
          <p className="mt-3 text-[12px] text-muted">
            以上为状态计数，不构成风险评级。平台当前没有风险分级模型，页面不做推断。
          </p>

          <Section title="近期举报" count={data.recentReports.length}>
            {data.recentReports.map((report) => {
              // Derived with the same helper the reports queue uses, so a row
              // cannot be labelled one way here and filtered another way there.
              const target = deriveReportTargetType(report);
              return (
              <Row key={report.id}>
                <div
                  className="flex items-start justify-between gap-3"
                  data-target-type={target}
                  data-report-id={report.id}
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {report.reporter.nickname ?? report.reporter.email} →{" "}
                      {report.reportedUser.nickname ?? report.reportedUser.email}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-1 text-muted">
                      <span
                        data-testid="report-target-badge"
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${REPORT_TARGET_BADGE_CLASS[target]}`}
                      >
                        {REPORT_TARGET_LABELS[target]}
                      </span>
                      <span>·</span>
                      <span>{report.reason}</span>
                      <span>·</span>
                      <Badge status={report.status}>{report.status}</Badge>
                      <span>·</span>
                      <span>{new Date(report.createdAt).toLocaleString()}</span>
                    </p>
                  </div>
                  <Link
                    href={`/reports/${report.id}`}
                    className="shrink-0 text-[12px] text-blue-600 underline"
                  >
                    查看举报
                  </Link>
                </div>
              </Row>
              );
            })}
          </Section>

          <Section title="近期管理员处理" count={data.recentActions.length}>
            {data.recentActions.map((entry) => {
              // A SYSTEM row has no administrator behind it. Only the SYSTEM
              // branch may describe the actor without an id; only the USER
              // branch reads `adminId` at all.
              const isSystem = entry.actorType === "SYSTEM";
              return (
                <Row key={entry.id}>
                  <p className="font-medium">
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </p>
                  <p className="mt-1 text-muted">
                    {new Date(entry.createdAt).toLocaleString()} ·{" "}
                    {isSystem ? (
                      <span className="rounded-full bg-[#E4EAF7] px-2 py-0.5 text-[11px] font-medium text-[#4A5A7A]">
                        系统 · 自动
                      </span>
                    ) : (
                      // Defensive `?.`: `adminId` is nullable at the type level.
                      `admin ${entry.adminId?.slice(0, 8) ?? "-"}`
                    )}
                  </p>
                  {entry.detail ? <p className="mt-1">{entry.detail}</p> : null}
                </Row>
              );
            })}
          </Section>

          <Section title="待核查异常举报" count={data.suspiciousSignals.length}>
            {data.suspiciousSignals.map((signal) => (
              <Row key={signal.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {/* Stated plainly: this row's reporter and reported user
                          are the same account. It is described as a signal to
                          check, never as a machine flag or a verdict. */}
                      举报人与被举报人为同一账号
                    </p>
                    <p className="mt-1 text-muted">
                      {signal.reason} ·{" "}
                      <Badge status={signal.status}>{signal.status}</Badge> ·{" "}
                      {new Date(signal.createdAt).toLocaleString()}
                    </p>
                    <p className="mt-1 text-muted">
                      账号：{signal.reportedUser.nickname ?? signal.reportedUser.email}
                    </p>
                  </div>
                  <Link
                    href={`/reports/${signal.id}`}
                    className="shrink-0 text-[12px] text-blue-600 underline"
                  >
                    查看举报
                  </Link>
                </div>
              </Row>
            ))}
          </Section>
        </>
      ) : null}
    </>
  );
}

function Badge({ status, children }: { status: string; children: React.ReactNode }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
        STATUS_BADGE[status] ?? "bg-[#EDEFF3] text-[#5A6472]"
      }`}
    >
      {children}
    </span>
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
    <section className="mt-6" data-testid={`risk-section-${title}`}>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {count === 0 ? (
        <p className="mt-2 rounded-2xl border border-line bg-card shadow-card p-3 text-[12px] text-muted">
          暂无数据
        </p>
      ) : (
        <div className="mt-2 space-y-2">{children}</div>
      )}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-line bg-card shadow-card p-3 text-[12px]">{children}</div>;
}
