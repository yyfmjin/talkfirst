import type { Config } from "tailwindcss";
import {
  accent,
  border,
  brand,
  content,
  danger,
  duration,
  ease,
  fontFamily,
  fontSize,
  fontWeight,
  info,
  keyframes,
  legacy,
  neutral,
  radius,
  shadow,
  success,
  surface,
  warning,
} from "./src/design/tokens";

/**
 * TalkFirst design system — Tailwind theme.
 *
 * ## What changed in Phase A
 *
 * Everything here is ADDITIVE except for one thing: the theme now comes from
 * `src/design/tokens.ts` instead of being written inline. Not one existing class
 * changes meaning, because:
 *
 *   - `ink` / `muted` / `cloud` / `line` keep their exact previous values
 *     (`legacy`), so the ~500 call sites using them render identically;
 *   - `shadow.phone` keeps its exact previous value;
 *   - the new scales are new NAMES, so any class that did not exist before
 *     (e.g. `bg-brand-500`, `rounded-card`, `text-body`) is a new capability
 *     rather than a redefinition of an old one.
 *
 * That is deliberate: Phase A must be verifiable as a no-op for the pages, so
 * that Phases B–H can migrate one screen at a time against a known-good
 * baseline. `design/tokens.ts` documents the old-name → new-name mapping.
 *
 * ## Reading order for the migration
 *
 *   colour role  →  `brand` / `accent` / `success` / `warning` / `danger` /
 *                   `surface` / `content` / `border` / `neutral`
 *   radius       →  `rounded-control | row | card | sheet | frame | full`
 *   elevation    →  `shadow-card | raised | overlay | brand`
 *   type         →  `text-display | title | heading | body | ui | caption | overline`
 *   motion       →  `duration-instant | fast | base | slow`, `ease-out | in-out`
 */
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        /* ---- Phase A scale -------------------------------------------- */
        brand,
        accent,
        success,
        warning,
        danger,
        info,
        neutral,

        /* Role aliases. `surface.canvas` → `bg-surface-canvas`, and
           `surface.DEFAULT` → `bg-surface`. */
        surface,
        content,
        border,

        /* ---- Legacy aliases (DEPRECATED, values unchanged) ------------- */
        /* New code must not use these. Removed once their last caller is
           migrated; see LEGACY_MIGRATION in design/tokens.ts. */
        ink: legacy.ink,
        muted: legacy.muted,
        cloud: legacy.cloud,
        line: legacy.line,
      },

      borderRadius: {
        /* Named steps from the design language. `full` is Tailwind's. */
        control: radius.control,
        row: radius.row,
        card: radius.card,
        sheet: radius.sheet,
        frame: radius.frame,
      },

      boxShadow: {
        card: shadow.card,
        raised: shadow.raised,
        overlay: shadow.overlay,
        brand: shadow.brand,
        /* Legacy, value unchanged (PhoneShell). */
        phone: shadow.phone,
      },

      fontFamily: {
        sans: [...fontFamily.sans],
      },

      fontSize: {
        display: [...fontSize.display],
        title: [...fontSize.title],
        heading: [...fontSize.heading],
        body: [...fontSize.body],
        ui: [...fontSize.ui],
        caption: [...fontSize.caption],
        overline: [...fontSize.overline],
      },

      /** Tailwind's own `font-normal` is 400; kept explicit for the scale. */
      fontWeight: {
        regular: fontWeight.regular,
      },

      transitionDuration: {
        instant: duration.instant,
        fast: duration.fast,
        base: duration.base,
        slow: duration.slow,
      },

      transitionTimingFunction: {
        out: ease.out,
        "in-out": ease.inOut,
      },

      keyframes,

      animation: {
        /* Only four, all short, all reducible via `motion-reduce:animate-none`. */
        "fade-in": "tf-fade-in 180ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "slide-up": "tf-slide-up 240ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "sheet-up": "tf-sheet-up 240ms cubic-bezier(0.22, 1, 0.36, 1) both",
        "pulse-soft": "tf-pulse-soft 1.6s ease-in-out infinite",
      },

      /**
       * Spacing is deliberately NOT extended.
       *
       * Tailwind's 4px grid already covers the scale, and adding half-steps and
       * aliases is how the old code ended up with `1.5`/`2.5`/`3.5` everywhere.
       *
       * Safe-area padding in particular is written as a single arbitrary value
       * (`pb-[calc(1rem+env(safe-area-inset-bottom))]`) rather than a
       * `pb-safe-b` helper, because a helper would emit a SECOND
       * `padding-bottom` declaration on the same element and which one wins would
       * depend on Tailwind's internal ordering.
       */
    },
  },
  plugins: [],
};

export default config;
