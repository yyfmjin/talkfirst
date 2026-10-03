import type { ReactNode } from "react";

/**
 * One pill for every status enum the console renders.
 *
 * PC-3.4 — the badge shows a Chinese label for the status, not the raw enum.
 * The console is a Chinese-language product surface, and `OPEN` next to
 * 「待处理」 in the same row was the clearest example of the mixed-language UI
 * this phase removes. The status value is untouched: it stays the colour key
 * here and stays the wire value everywhere else, so an operator still has
 * exactly one spelling to cross-check against the API.
 *
 * ## Why the label needs a domain
 *
 * `ACTIVE` is not one thing: a `User.status` of `ACTIVE` reads 「正常」 while a
 * `Connection.status` of `ACTIVE` reads 「已连接」. A single flat map cannot hold
 * both, and picking one silently mislabels the other — so the domain is a
 * required parameter rather than a default. An unmapped status falls back to
 * the raw value rather than to a blank pill, so a new enum member is visible
 * instead of invisible.
 *
 * Colour is the only thing this component decides, and it decides it from a
 * single table so two screens can never colour the same status differently.
 */
export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

const TONE_CLASS: Record<StatusTone, string> = {
  /*
   * Only the tones whose hexes EXACTLY match a token are migrated here.
   *
   * `neutral` / `accent` / `info` map to `subtle` / `accent` / `info-wash`
   * one-for-one, so nothing changes visually. `success` / `warning` / `danger`
   * are deliberately LEFT as literals: their values are Tailwind's `*-50`/`*-100`
   * family (`#ECFDF5`, `#FFFBEB`, `#FEF2F2`) which is NOT the same family the
   * other admin screens use (`#DCFCE7`, `#FEF3C7`, `#FEE2E2`). Renaming them to
   * the nearest token would change every badge's colour with no build error and
   * nobody to notice — a silent regression is worse than a remaining literal.
   */
  neutral: "bg-subtle text-[#4B5563] ring-[#E5E7EB]",
  info: "bg-info-wash text-[#1D4ED8] ring-[#BFDBFE]",
  success: "bg-[#ECFDF5] text-[#047857] ring-[#A7F3D0]",
  warning: "bg-[#FFFBEB] text-[#B45309] ring-[#FDE68A]",
  danger: "bg-[#FEF2F2] text-[#B91C1C] ring-[#FECACA]",
  accent: "bg-accent text-[#4338CA] ring-[#C7D2FE]",
};

/**
 * Status → tone. Deliberately exhaustive over the enums the console meets:
 * user status, report status, connection status and exchange status.
 */
const STATUS_TONE: Record<string, StatusTone> = {
  // User / account
  ACTIVE: "success",
  SUSPENDED: "warning",
  BANNED: "danger",
  DISABLED: "neutral",
  DELETED: "neutral",
  // Reports & moderation
  OPEN: "warning",
  REVIEWING: "accent",
  RESOLVED: "success",
  REJECTED: "neutral",
  // Connections & exchanges
  PENDING: "warning",
  ACCEPTED: "success",
  DECLINED: "neutral",
  REMOVED: "neutral",
  // Risk severities
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "danger",
};

export function toneForStatus(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  return STATUS_TONE[status.toUpperCase()] ?? "neutral";
}

/**
 * The five enums the console renders. The wording is not invented per screen —
 * it matches the labels the filter dropdowns already used (`reports/page.tsx`
 * had 待处理 / 审核中 / 已处理 / 已驳回).
 */
export type StatusDomain = "USER" | "REPORT" | "CONNECTION" | "EXCHANGE" | "RISK";

const STATUS_LABELS: Record<StatusDomain, Record<string, string>> = {
  USER: {
    ACTIVE: "正常",
    SUSPENDED: "已暂停",
    BANNED: "已封禁",
    DISABLED: "已停用",
    DELETED: "已删除",
  },
  REPORT: {
    OPEN: "待处理",
    REVIEWING: "审核中",
    RESOLVED: "已处理",
    REJECTED: "已驳回",
  },
  CONNECTION: {
    ACTIVE: "已连接",
    REMOVED: "已解除",
  },
  EXCHANGE: {
    PENDING: "待响应",
    ACCEPTED: "已接受",
    REJECTED: "已拒绝",
    CANCELLED: "已取消",
  },
  RISK: {
    LOW: "低",
    MEDIUM: "中",
    HIGH: "高",
    CRITICAL: "严重",
  },
};

/** Falls back to the raw value: a new enum member stays visible, not blank. */
export function statusLabel(status: string | null | undefined, domain: StatusDomain): string {
  if (!status) return "";
  return STATUS_LABELS[domain][status.toUpperCase()] ?? status;
}

export type StatusBadgeProps = {
  status: string;
  /** Which enum `status` belongs to — `ACTIVE` differs between domains. */
  domain: StatusDomain;
  /** Overrides the visible text while keeping `status` as the colour key. */
  label?: ReactNode;
  /** Pass `"status-badge"` where a suite locates the badge by testid. */
  testId?: string;
  className?: string;
};

export function StatusBadge({ status, domain, label, testId, className = "" }: StatusBadgeProps) {
  return (
    <span
      {...(testId ? { "data-testid": testId } : {})}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONE_CLASS[toneForStatus(status)]} ${className}`}
    >
      {label ?? statusLabel(status, domain)}
    </span>
  );
}
