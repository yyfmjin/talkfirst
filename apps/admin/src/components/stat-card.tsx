import type { ReactNode } from "react";

/**
 * A single figure with its label.
 *
 * ## Structure is a contract, not a style choice
 *
 * Two browser suites bind a value to its label with
 * `getByText(label, { exact: true }).locator("xpath=preceding-sibling::p[1]")`
 * — i.e. **the value must be the `<p>` immediately before the label `<p>`**, as
 * a sibling, with nothing in between. `getByText(label)` must also resolve to
 * exactly one element, so a label may not be repeated anywhere on a page.
 *
 * That is why the markup below is `value <p>` then `label <p>`, adjacent, and
 * why anything else this card renders (`icon`, `hint`, `tone`) is placed either
 * before the value or after the label — never between them.
 */
export type StatCardTone = "default" | "primary" | "success" | "warning" | "danger";

const TONE_ACCENT: Record<StatCardTone, string> = {
  default: "text-ink",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

const TONE_TRACK: Record<StatCardTone, string> = {
  default: "bg-ink/10",
  primary: "bg-primary/10",
  success: "bg-success/10",
  warning: "bg-warning/10",
  danger: "bg-danger/10",
};

export type StatCardProps = {
  label: string;
  value: ReactNode;
  tone?: StatCardTone;
  /** Optional supporting line, rendered *after* the label. */
  hint?: ReactNode;
  /** Optional leading icon, rendered *before* the value. */
  icon?: ReactNode;
  /** `lg` is the four headline figures; `sm` is the supporting strip. */
  size?: "lg" | "sm";
  className?: string;
};

export function StatCard({
  label,
  value,
  tone = "default",
  hint,
  icon,
  size = "lg",
  className = "",
}: StatCardProps) {
  const large = size === "lg";

  return (
    <div
      className={`rounded-2xl border border-line bg-card shadow-card ${
        large ? "p-4" : "px-3.5 py-3"
      } ${className}`}
    >
      {large ? (
        <div className="mb-3 flex items-center justify-between">
          <span
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full ${TONE_TRACK[tone]} ${TONE_ACCENT[tone]}`}
            aria-hidden="true"
          >
            {icon}
          </span>
        </div>
      ) : null}

      <p
        className={`font-semibold tabular-nums tracking-tight ${
          large ? "text-[26px] leading-8" : "text-[18px] leading-6"
        } ${large ? TONE_ACCENT[tone] : "text-ink"}`}
      >
        {value}
      </p>
      <p className={`mt-1 text-muted ${large ? "text-[12px]" : "text-[11px]"}`}>{label}</p>

      {hint ? <p className="mt-1.5 text-[11px] text-muted/80">{hint}</p> : null}
    </div>
  );
}
