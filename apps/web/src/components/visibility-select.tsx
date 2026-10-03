"use client";

import {
  VISIBILITY_HINTS,
  VISIBILITY_LABELS,
  VISIBILITY_SHORT_LABELS,
  VISIBILITY_TIERS,
  type VisibilityTier,
} from "@/lib/profile";
import { cn } from "@/lib/cn";

/**
 * PC-1.4: the single 3-way visibility control (公开 / 仅连接 / 仅自己).
 *
 * Shared by per-attribute visibility and per-field profile visibility so the two
 * settings screens cannot drift apart. The enum names are never rendered:
 * members see Chinese wording, and the active tier's meaning is spelt out
 * underneath.
 *
 * ## What must not change (Phase F)
 *
 * `profile.spec.ts` drives this control with
 *   `row.getByRole("radio", { name: "仅自己", exact: true })`
 * so three things are load-bearing and are unchanged here:
 *
 *   - `role="radio"` on each option, inside a `role="radiogroup"` with the
 *     field's name as its `aria-label`;
 *   - the option text coming from `VISIBILITY_SHORT_LABELS` (「公开」「仅连接」
 *     「仅自己」) — the `exact` match means a suffix would break it;
 *   - `aria-checked` reflecting the active tier, so the group is a real radio
 *     group rather than three buttons that look selected.
 *
 * Only the styling moved: the selected state was a `tf-gradient` fill (a state
 * wearing a primary-button costume) and is now a brand border plus tint.
 */
export function VisibilitySelect({
  value,
  onChange,
  disabled = false,
  label,
}: {
  value: VisibilityTier;
  onChange: (tier: VisibilityTier) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-3 gap-1.5">
        {VISIBILITY_TIERS.map((tier) => {
          const active = value === tier;
          return (
            <button
              key={tier}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(tier)}
              className={cn(
                "min-h-9 rounded-full border px-2 text-caption transition-[background-color,border-color,color] duration-instant ease-out",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
                "disabled:cursor-not-allowed disabled:opacity-50",
                active
                  ? "border-brand-500 bg-brand-50 font-medium text-brand-600"
                  : "border-border bg-surface text-content-muted hover:bg-surface-sunken",
              )}
            >
              {VISIBILITY_SHORT_LABELS[tier]}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-caption leading-4 text-content-muted">
        {VISIBILITY_LABELS[value]}：{VISIBILITY_HINTS[value]}
      </p>
    </div>
  );
}
