"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { avatarInitial } from "@/lib/profile";

/**
 * TFAvatar — one avatar.
 *
 * The audit counted ten independent avatar implementations with five different
 * fills, four sizes and no shared component, so the same person could render as a
 * blue-grey disc in a comment and as a purple gradient in the feed card directly
 * beside it. This is the one implementation.
 *
 * ## Accessibility
 *
 * An avatar is almost always decorative: it sits inside a link, a row or a
 * button that already carries the person's name. Rendering a second accessible
 * name for it makes a screen reader announce the same person twice. So the image
 * is `alt=""` by DEFAULT, and a caller that needs the avatar to *be* the label
 * (an avatar-only control) passes `alt` explicitly.
 *
 * ## Fallback
 *
 * A user with no uploaded avatar, or whose image fails to load, gets a stable
 * brand-tinted disc with their initial — not a broken-image icon. The tint is
 * derived from the id so the same person is always the same colour.
 */

type Size = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE: Record<Size, string> = {
  xs: "h-6 w-6 text-overline",
  sm: "h-8 w-8 text-caption",
  md: "h-11 w-11 text-ui",
  lg: "h-14 w-14 text-heading",
  xl: "h-20 w-20 text-title",
};

/** Three tints, one per hash bucket. Brand, accent, neutral — no rainbow. */
const TINTS = ["bg-brand-100 text-brand-600", "bg-accent-100 text-accent-600", "bg-neutral-100 text-content-muted"];

function tintFor(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 997;
  }
  return TINTS[hash % TINTS.length];
}

export type TFAvatarProps = {
  /** Used for the fallback initial and the tint. */
  name: string | null | undefined;
  src?: string | null;
  size?: Size;
  /** Explicit accessible name. Omit for a decorative avatar. */
  alt?: string;
  /** `true` shows a brand ring, for "you" and for the active speaker. */
  ring?: boolean;
  /** Small presence dot. `null` renders nothing. */
  online?: boolean | null;
  className?: string;
};

export function TFAvatar({ name, src, size = "md", alt, ring, online, className }: TFAvatarProps) {
  const label = name ?? "TalkFirst 用户";
  const dot = online === null || online === undefined ? null : (
    <span
      aria-hidden="true"
      className={cn(
        "absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-surface",
        size === "xs" || size === "sm" ? "h-2.5 w-2.5" : "h-3.5 w-3.5",
        online ? "bg-success-500" : "bg-neutral-400",
      )}
    />
  );

  return (
    <span className={cn("relative inline-block shrink-0", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt ?? ""}
          className={cn(
            "block rounded-full object-cover",
            SIZE[size],
            ring ? "ring-2 ring-brand-200" : "ring-1 ring-black/5",
          )}
        />
      ) : alt ? (
        /* An avatar that IS the label. `role="img"` + `aria-label` is the correct
           pairing for a non-image element standing in for an image. */
        <span
          role="img"
          aria-label={alt}
          className={cn(
            "grid place-items-center rounded-full font-semibold",
            SIZE[size],
            tintFor(label),
            ring ? "ring-2 ring-brand-200" : "ring-1 ring-black/5",
          )}
        >
          {avatarInitial(name)}
        </span>
      ) : (
        /* Decorative — the common case, because an avatar normally sits inside a
           link or button that already carries the person's name. `aria-hidden`
           only: an earlier draft spread `alt` onto this `<span>`, which does not
           accept that attribute and would have been a type error. */
        <span
          aria-hidden="true"
          className={cn(
            "grid place-items-center rounded-full font-semibold",
            SIZE[size],
            tintFor(label),
            ring ? "ring-2 ring-brand-200" : "ring-1 ring-black/5",
          )}
        >
          {avatarInitial(name)}
        </span>
      )}
      {dot}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * TFCard — a surface.
 *
 * The audit found six ways of drawing a card (three radii, `border-indigo-100` in
 * some places and `border-line` in others, with and without a background) and the
 * brief calls out "white card containing a white card" as the thing to avoid.
 *
 * So a card is deliberately quiet: `surface` + a hairline `border`, radius
 * `card`, and NO shadow by default. `elevated` exists for the one case a card
 * genuinely floats (a dropdown, a sticky summary) and is the only variant that
 * adds one.
 *
 * `flush` removes the padding for a card whose content is a list or a media block
 * that must reach the edges — which is how the feed avoids the
 * card-inside-card look: the row is flush, the media is the card's edge.
 */
export type TFCardProps = {
  /** `quiet` = no border, a tinted fill. For secondary groupings inside a card. */
  tone?: "default" | "quiet" | "brand" | "danger";
  /** Vertical padding only. Rows supply their own horizontal padding. */
  flush?: boolean;
  /** Adds the one permitted elevation. */
  elevated?: boolean;
  /** Renders as a `<section>`/`<article>` when the content warrants it. */
  as?: "div" | "section" | "article" | "li";
  /**
   * `data-testid` is declared explicitly because the E2E suite addresses rows
   * through the card (`visibility-row-bio`). `display.tsx` does not set
   * `htmlAttributes: ["class", "style"]` in the Tailwind config, so an
   * undeclared `data-*` prop is a type error rather than an accepted extra —
   * the same reason `TFBadge` declares `title`.
   */
  "data-testid"?: string;
  className?: string;
  children: ReactNode;
};

export function TFCard({
  tone = "default",
  flush,
  elevated,
  as: Tag = "div",
  className,
  children,
  "data-testid": testId,
}: TFCardProps) {
  return (
    <Tag
      data-testid={testId}
      className={cn(
        "min-w-0 rounded-card",
        flush ? "py-2" : "p-4",
        tone === "default" && "border border-border bg-surface",
        tone === "quiet" && "bg-surface-sunken",
        tone === "brand" && "border border-brand-200 bg-brand-50",
        tone === "danger" && "border border-danger-200 bg-danger-50",
        elevated && "shadow-raised",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * TFBadge — a status pill.
 *
 * Status, not decoration: it exists so that ACTIVE / PENDING / BLOCKED / REVIEW
 * read the same way everywhere. The audit found eight independent status→colour
 * tables that already disagreed with each other (`REVIEWING` was blue in one and
 * a different blue in another), which is exactly what a single `tone` union
 * prevents.
 */
export type TFTone = "neutral" | "brand" | "accent" | "success" | "warning" | "danger" | "info";

const TONE: Record<TFTone, string> = {
  neutral: "bg-neutral-100 text-content-muted",
  brand: "bg-brand-100 text-brand-600",
  accent: "bg-accent-100 text-accent-600",
  success: "bg-success-50 text-success-700",
  warning: "bg-warning-100 text-warning-800",
  danger: "bg-danger-50 text-danger-700",
  info: "bg-info-50 text-info-700",
};

export function TFBadge({
  tone = "neutral",
  /** A leading dot, for states that are live (online, active). */
  dot,
  /**
   * Native tooltip. Declared explicitly rather than accepting arbitrary HTML
   * attributes: `display.tsx` does NOT set `htmlAttributes: ["class", "style"]`
   * in the Tailwind config, so a `<span>` component's props are checked against
   * `HTMLAttributes` strictly — an undeclared `title` would be a type error at
   * every call site that passes one (the feed's 「示例」 badge does).
   */
  title,
  /**
   * `data-testid` is declared for the same reason as `title`: props are a closed
   * object type here, so an undeclared attribute is a type error at the call
   * site. `/me/attributes` renders `attribute-count-{kind}` on a badge, and
   * `profile.spec.ts` waits on that testid for the page to load.
   */
  "data-testid": testId,
  className,
  children,
}: {
  tone?: TFTone;
  dot?: boolean;
  title?: string;
  "data-testid"?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      data-testid={testId}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-overline font-medium",
        TONE[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * TFChip — a selectable token.
 *
 * Distinct from `TFBadge` on purpose: a badge is a statement, a chip is a
 * control. A chip therefore has `aria-pressed`, a pressed style, and a 36px
 * height so it is reachable; a badge is inert text at 11px.
 *
 * This replaces the six chip implementations the audit found (interest,
 * purpose, country, tag, platform, filter) and the four different ways the same
 * "am I selected" state was expressed.
 */
export function TFChip({
  selected = false,
  disabled = false,
  onClick,
  /** Renders the chip as static text when there is no action. */
  as = onClick ? "button" : "span",
  /**
   * Native tooltip. Declared explicitly for the same reason `TFBadge` declares
   * it: `TFChip`'s props are a closed object type, not `HTMLAttributes`, so an
   * undeclared attribute is a TYPE ERROR at the call site rather than a silently
   * ignored extra. The exchange panel passes one
   * (`title={owned ? … : "…（需先在「我的」绑定）"}`).
   */
  title,
  className,
  children,
}: {
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  as?: "button" | "span";
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const classes = cn(
    "inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border px-3.5 text-ui transition-[background-color,border-color,color] duration-instant ease-out",
    selected
      ? "border-brand-300 bg-brand-50 font-medium text-brand-600"
      : "border-border bg-surface text-content-muted",
    as === "button" && "hover:border-neutral-300 active:scale-[0.98] motion-reduce:active:scale-100",
    as === "button" && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
    disabled && "cursor-not-allowed opacity-50",
    className,
  );

  if (as === "button") {
    return (
      <button
        type="button"
        title={title}
        onClick={onClick}
        disabled={disabled}
        aria-pressed={selected}
        className={classes}
      >
        <span className="truncate">{children}</span>
      </button>
    );
  }

  return (
    <span title={title} className={classes}>
      {children}
    </span>
  );
}
