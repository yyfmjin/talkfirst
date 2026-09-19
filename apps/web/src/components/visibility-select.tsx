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
        {VISIBILITY_TIERS.map((tier) => (
          <button
            key={tier}
            type="button"
            role="radio"
            aria-checked={value === tier}
            disabled={disabled}
            onClick={() => onChange(tier)}
            className={cn(
              "min-h-[2.25rem] rounded-full border px-2 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-50",
              value === tier ? "border-transparent tf-gradient font-medium text-white" : "border-line text-muted",
            )}
          >
            {VISIBILITY_SHORT_LABELS[tier]}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-muted">
        {VISIBILITY_LABELS[value]}：{VISIBILITY_HINTS[value]}
      </p>
    </div>
  );
}
