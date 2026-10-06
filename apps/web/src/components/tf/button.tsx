"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * TFButton — the one button in the member app.
 *
 * ## Why it replaces three
 *
 * `GradientButton`, `OutlineButton` and `SmallButton` overlapped but disagreed:
 * three different heights (36/40/48px), three paddings, two type sizes, and no
 * `hover` or `focus-visible` state at all — the shared primitives were the LEAST
 * stateful components in the product. On top of those, ~25 call sites hand-rolled
 * a pill of their own (`bg-[#6572D8]`, `bg-[#16213A]`, raw `tf-gradient`), so
 * "the primary button" had seven implementations.
 *
 * This is one component with an explicit role, an explicit size, and every state
 * the design language requires.
 *
 * ## Roles are capabilites, not colours
 *
 *   primary  — THE action on the screen. At most one visible at a time.
 *   secondary— the alternative to it. At most one or two.
 *   ghost    — a third action that must not compete: cancel, skip, retry.
 *   danger   — destructive. Only ever inside a confirmation or a settings row.
 *
 * The brief's rule that blue means "primary / active / link" and nothing else is
 * enforced here: only `primary` and `ghost` paint brand blue, and `ghost` does so
 * only for its text.
 *
 * ## `loading` is not `disabled`
 *
 * A submitting button must keep its width (so the layout does not jump), keep its
 * accessible name (so a screen reader still says what is happening), and refuse
 * a second click. `loading` does all three; `disabled` only greys out.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  /* The sticky CTA from the composer is the reference: solid brand, pill,
     very light brand shadow, 120ms press.

     底色用 600 而不是 500（2026-10-06）：白字压在 `brand-500`（#3B82F6）上只有 **3.68**，
     不到正文级 AA 要求的 4.5；`brand-600`（#2563EB）是 **5.17**，按下用 700。
     主色 token 本身不变（链接、激活态、选中态仍用 500）。 */
  primary:
    "bg-brand-600 text-white shadow-brand hover:bg-brand-700 active:bg-brand-700 focus-visible:ring-brand-300 disabled:bg-brand-200 disabled:shadow-none",
  secondary:
    "border border-border bg-surface text-content hover:bg-surface-sunken active:bg-neutral-100 focus-visible:ring-neutral-300 disabled:text-content-subtle",
  ghost:
    "bg-transparent text-content-brand hover:bg-brand-50 active:bg-brand-100 focus-visible:ring-brand-300 disabled:text-content-subtle",
  danger:
    "bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-700 focus-visible:ring-danger-200 disabled:bg-danger-200",
};

/**
 * Three sizes, and the height is the touch target: 36 for an inline row action,
 * 44 (the thumb floor) for anything in a form or a CTA row, 48 for the single
 * strongest action on a screen.
 */
const SIZE: Record<Size, string> = {
  sm: "h-9 gap-1.5 px-3.5 text-caption font-medium",
  md: "h-11 gap-2 px-4 text-ui font-medium",
  lg: "h-12 gap-2 px-5 text-body font-semibold",
};

export type TFButtonProps = {
  variant?: Variant;
  size?: Size;
  /** Renders as a `Link` when set, so navigation stays client-side. */
  href?: string;
  /** Shows a spinner, keeps the label, blocks re-entry. */
  loading?: boolean;
  /** Replaces the label while `loading`. Falls back to the children. */
  loadingLabel?: ReactNode;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  className?: string;
  children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">;

function classesFor(variant: Variant, size: Size, fullWidth: boolean, className?: string) {
  return cn(
    "inline-flex shrink-0 select-none items-center justify-center rounded-control",
    /* Motion is 120ms and transform-only, and it is switched off wholesale for
       `prefers-reduced-motion` users. */
    "transition-[background-color,color,box-shadow,transform] duration-instant ease-out",
    "active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
    "disabled:cursor-not-allowed disabled:active:scale-100",
    VARIANT[variant],
    SIZE[size],
    fullWidth && "w-full",
    className,
  );
}

export const TFButton = forwardRef<HTMLButtonElement, TFButtonProps>(function TFButton(
  {
    variant = "primary",
    size = "md",
    href,
    loading = false,
    loadingLabel,
    fullWidth = false,
    leadingIcon,
    trailingIcon,
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  const classes = classesFor(variant, size, fullWidth, className);
  const body = (
    <>
      {loading ? <Loader2 size={16} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : leadingIcon}
      <span className="truncate">{loading ? (loadingLabel ?? children) : children}</span>
      {loading ? null : trailingIcon}
    </>
  );

  /* `aria-busy` is what tells assistive tech the control is working; the label
     itself is deliberately NOT swapped to "loading…" alone. */
  if (href && !isDisabled) {
    return (
      <Link href={href} className={classes} aria-busy={loading || undefined}>
        {body}
      </Link>
    );
  }

  return (
    <button ref={ref} type="button" className={classes} disabled={isDisabled} aria-busy={loading || undefined} {...rest}>
      {body}
    </button>
  );
});

/**
 * TFIconButton — an icon with no label.
 *
 * Every instance REQUIRES an accessible name: the whole reason this is a
 * component instead of a bare `<button>` is that a bare one has no way to force
 * `aria-label`, and the audit found icon-only controls with a ~1-character hit
 * target (`⋯` at 12px) and no focus state.
 *
 * `size="sm"` is 36px and is only for a row action where something else already
 * carries the row's tap target; anything a thumb aims at uses `md` (44px).
 */
export type TFIconButtonProps = {
  /** Required. Becomes both `aria-label` and `title`. */
  label: string;
  variant?: Variant;
  size?: "sm" | "md";
  className?: string;
  children: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children" | "aria-label">;

export const TFIconButton = forwardRef<HTMLButtonElement, TFIconButtonProps>(function TFIconButton(
  { label, variant = "ghost", size = "md", className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full",
        "transition-[background-color,color,transform] duration-instant ease-out",
        "active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
        "disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-9 w-9" : "h-11 w-11",
        variant === "ghost" && "bg-transparent text-content hover:bg-surface-sunken",
        variant === "secondary" && "border border-border bg-surface text-content hover:bg-surface-sunken",
        variant === "primary" && "bg-brand-600 text-white hover:bg-brand-700",
        variant === "danger" && "bg-danger-50 text-danger-600 hover:bg-danger-100",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
