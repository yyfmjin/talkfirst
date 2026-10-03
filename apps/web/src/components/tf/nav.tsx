"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * TFTabs — the segmented control and the underline tab row.
 *
 * The audit found four independent tab implementations, using four different ARIA
 * stories for the same idea: `role="tablist"` + `aria-selected` in one place,
 * `aria-pressed` on plain buttons in another, and **no state attribute at all** in
 * a third (the moments feed's 推荐/关注/我的 row, so a screen reader could not say
 * which tab was active).
 *
 * One implementation, one ARIA pattern, two shapes:
 *
 *  - `variant="underline"` — top-level content switching (feed tabs). The active
 *    tab is marked by colour plus a 2px rule, so state is never colour-only.
 *  - `variant="segment"` — a binary or ternary filter inside a card (the
 *    attribute picker's ABOUT_ME / LOOKING_FOR).
 *
 * ## Keyboard
 *
 * A `tablist` is expected to respond to arrow keys and to keep exactly one tab in
 * the tab order, so Left/Right move the selection and Home/End jump to the ends.
 * Optionally `scrollable` marks the row as horizontally scrollable for the tab
 * strip on a narrow screen.
 */

export type TFTabItem<T extends string> = {
  id: T;
  label: ReactNode;
  /** Rendered in a small pill after the label (a count). */
  badge?: ReactNode;
};

export function TFTabs<T extends string>({
  items,
  value,
  onChange,
  variant = "underline",
  label,
  scrollable = false,
  className,
}: {
  items: ReadonlyArray<TFTabItem<T>>;
  value: T;
  onChange: (next: T) => void;
  variant?: "underline" | "segment";
  /** Accessible name for the tablist. Required — an unnamed tablist is unreadable. */
  label: string;
  /** Adds horizontal scrolling instead of shrinking the tabs. */
  scrollable?: boolean;
  className?: string;
}) {
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = items.findIndex((item) => item.id === value);
    if (index < 0) return;
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;
    event.preventDefault();
    onChange(items[next].id);
  }

  if (variant === "segment") {
    return (
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn("flex gap-1 rounded-full bg-surface-sunken p-1", className)}
      >
        {items.map((item) => {
          const active = item.id === value;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(item.id)}
              className={cn(
                "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-ui transition-colors duration-instant ease-out",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
                active ? "bg-surface font-medium text-brand-600 shadow-card" : "text-content-muted hover:text-content",
              )}
            >
              <span className="truncate">{item.label}</span>
              {item.badge}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "flex items-stretch border-b border-border",
        scrollable && "tf-scroll-x overflow-x-auto",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.id)}
            className={cn(
              "relative flex shrink-0 items-center justify-center gap-1.5 px-4 pb-2.5 pt-3 text-ui transition-colors duration-instant ease-out",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-300",
              active ? "font-semibold text-content" : "text-content-muted hover:text-content",
            )}
          >
            <span className="truncate">{item.label}</span>
            {item.badge}
            {active ? (
              <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-brand-500" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * TFSectionHeader — the small label above a group of rows.
 *
 * Exists because the audit found the same heading written four ways at four sizes
 * (`text-[11px]`/`text-[12px]`/`text-[13px]`/`text-[14px]`, uppercase or not,
 * muted or not) with no rule about which to use where.
 */
export function TFSectionHeader({
  title,
  action,
  className,
}: {
  title: ReactNode;
  /** A single trailing affordance — 「查看全部」, a count, a toggle. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3 px-4 pb-2 pt-4", className)}>
      <h2 className="min-w-0 truncate text-caption font-semibold uppercase tracking-wide text-content-muted">{title}</h2>
      {action}
    </div>
  );
}

/**
 * TFListRow — one row in a settings-style list.
 *
 * The brief asks for the Settings entry pattern (icon, title, auxiliary text,
 * chevron) and the audit found it re-implemented per page with three different
 * heights. Here it is once, with the chevron and the whole-row tap target.
 */
export function TFListRow({
  icon,
  title,
  subtitle,
  trailing,
  onClick,
  href,
  tone = "default",
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Replaces the chevron when the row is not navigational. */
  trailing?: ReactNode;
  onClick?: () => void;
  href?: string;
  tone?: "default" | "danger";
  className?: string;
}) {
  const classes = cn(
    "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-instant ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-300",
    (onClick || href) && "hover:bg-surface-sunken active:bg-neutral-100",
    className,
  );

  const content = (
    <>
      {icon ? (
        <span
          className={cn(
            "grid h-9 w-9 shrink-0 place-items-center rounded-control",
            tone === "danger" ? "bg-danger-50 text-danger-600" : "bg-surface-sunken text-content-muted",
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-ui", tone === "danger" ? "text-danger-600" : "text-content")}>
          {title}
        </span>
        {subtitle ? <span className="mt-0.5 block truncate text-caption text-content-muted">{subtitle}</span> : null}
      </span>
      {trailing ?? (href || onClick ? <Chevron /> : null)}
    </>
  );

  if (href) {
    /* `Link`, not `<a>`: the audit found two internal routes using a plain anchor,
       which triggers a full page reload and throws away the session state the
       client is holding. */
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {content}
      </button>
    );
  }
  return <div className={classes}>{content}</div>;
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4 shrink-0 text-content-subtle"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}
