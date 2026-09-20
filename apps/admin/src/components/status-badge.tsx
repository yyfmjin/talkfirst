import type { ReactNode } from "react";

/**
 * One pill for every status enum the console renders.
 *
 * The badge shows the **raw status value** unless a `label` is given. That is
 * on purpose: the existing suites assert on `OPEN` / `SUSPENDED` / `RESOLVED`
 * text, and a badge that silently translated those would break them — and would
 * also hide the exact value an operator is cross-checking against the API.
 *
 * Colour is the only thing this component decides, and it decides it from a
 * single table so two screens can never colour the same status differently.
 */
export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-[#F3F4F6] text-[#4B5563] ring-[#E5E7EB]",
  info: "bg-[#EFF6FF] text-[#1D4ED8] ring-[#BFDBFE]",
  success: "bg-[#ECFDF5] text-[#047857] ring-[#A7F3D0]",
  warning: "bg-[#FFFBEB] text-[#B45309] ring-[#FDE68A]",
  danger: "bg-[#FEF2F2] text-[#B91C1C] ring-[#FECACA]",
  accent: "bg-[#EEF2FF] text-[#4338CA] ring-[#C7D2FE]",
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

export type StatusBadgeProps = {
  status: string;
  /** Overrides the visible text while keeping `status` as the colour key. */
  label?: ReactNode;
  /** Pass `"status-badge"` where a suite locates the badge by testid. */
  testId?: string;
  className?: string;
};

export function StatusBadge({ status, label, testId, className = "" }: StatusBadgeProps) {
  return (
    <span
      {...(testId ? { "data-testid": testId } : {})}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${TONE_CLASS[toneForStatus(status)]} ${className}`}
    >
      {label ?? status}
    </span>
  );
}
