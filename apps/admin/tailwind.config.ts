import type { Config } from "tailwindcss";

/**
 * Admin console design tokens.
 *
 * A single source of truth for the console's palette, radii and elevation, so a
 * screen never invents its own hex value. The intent is a calm, dense,
 * trustworthy operations surface — closer to a tool than to a marketing page:
 * one accent, a flat near-white canvas, hairline borders and almost no shadow.
 *
 * `ink` / `muted` / `line` are the historical names the twenty existing screens
 * already use; their *values* were retuned here rather than renamed, so the
 * whole console moves to the new palette without a per-screen refactor. The
 * `card` / `bg` / `primary` / `success` / `warning` / `danger` tokens are the
 * forward-looking names new code should use.
 */
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        /** Canvas behind the content column. */
        bg: "#F7F8FA",
        /** Surfaces: cards, tables, popovers. */
        card: "#FFFFFF",
        /** Primary text. */
        ink: "#171A1F",
        /** Secondary text, labels, table headers. */
        muted: "#6B7280",
        /** Hairline borders and dividers. */
        line: "#E8EBEF",
        /** The single accent — links, primary buttons, active nav. */
        primary: "#4F46E5",
        /** Pressed/hover shade of `primary` (was an inline `#4338CA`). */
        "primary-hover": "#4338CA",
        /*
         * Status colours. These MUST stay flat keys: `stat-card.tsx` uses
         * `text-success` / `text-warning` / `text-danger` and `bg-success/10`, and
         * `error-state.tsx` / `shell.tsx` use `text-danger`. Tailwind has no
         * built-in `danger`, so without these the classes resolve to nothing and
         * the status figures render in the default text colour.
         */
        success: "#16A34A",
        warning: "#D97706",
        danger: "#DC2626",
        /** Pressed/hover shade of `danger` (was an inline `#B91C1C`). */
        "danger-hover": "#B91C1C",

        /*
         * ---------------------------------------------------------------------
         * Phase I — the missing steps.
         *
         * The docblock above claims "a screen never invents its own hex value",
         * but 63 arbitrary hexes had accumulated across 18 screens anyway. These
         * are the ones that repeat, promoted to names in the same visual family as
         * the tokens already here.
         *
         * `primary-ink` is the interesting one: `bg-[#16213A]` appeared as the
         * filled-button colour on SIX different screens. It is a near-black navy
         * rather than the indigo accent, which reads as a deliberate choice for
         * heavyweight submit buttons in an ops tool — so it is recorded as a peer
         * of `primary`, not merged into it.
         */

        /** Recessed panels inside a card: log entries, detail blocks. */
        surface: "#FBFCFE",
        /** Row hover and neutral chips. */
        subtle: "#F3F4F6",
        /** Accent wash: icon tiles, active nav row, accent chips. */
        accent: "#EEF2FF",
        /** Legacy `#374151` — nav labels and secondary body text. */
        body: "#374151",
        /** The filled-button navy. `primary-ink` = the ink of a primary action. */
        "primary-ink": "#16213A",

        /*
         * Status shades as FLAT keys (`bg-success-wash`), deliberately NOT nested
         * scales (`success: { wash: … }`).
         *
         * Replacing the existing `success: "#16A34A"` with an object would break
         * `text-danger`, `text-success` and `bg-success/10` — all of which are in
         * use in `stat-card.tsx` / `error-state.tsx` / `shell.tsx`. Flat keys keep
         * every current utility resolving to the same colour while making the
         * dozens of `bg-[#DCFCE7]`-style literals nameable.
         */
        "success-wash": "#DCFCE7",
        "success-ink": "#166534",
        "warning-wash": "#FEF3C7",
        "warning-ink": "#92400E",
        "danger-wash": "#FEE2E2",
        "danger-ink": "#991B1B",
        "info-wash": "#DBEAFE",
        "info-ink": "#1E40AF",
        /*
         * The neutral status pair. `#EDEFF3` / `#5A6472` is NOT `subtle`
         * (`#F3F4F6`) — it is a cooler grey, used for "cancelled / removed /
         * rejected" states on four screens. Kept as its own pair because folding
         * it into `subtle` would visibly warm every inactive badge.
         */
        "neutral-wash": "#EDEFF3",
        "neutral-ink": "#5A6472",
        /*
         * The "SYSTEM · automatic" actor badge — a violet-slate pair used on the
         * risk list and the audit timeline. Distinct from BOTH `accent`
         * (#EEF2FF/#4338CA, the brighter indigo) and `neutral` (#EDEFF3/#5A6472,
         * the cooler grey): it marks "no human did this", which is a different
         * statement from "inactive".
         */
        "system-wash": "#E4EAF7",
        "system-ink": "#4A5A7A",
      },
      /**
       * Tighter than Tailwind's defaults on purpose: 16px cards read as
       * consumer-app bubbles, not as an operations console. The class names are
       * unchanged so no existing markup has to be migrated.
       */
      borderRadius: {
        md: "8px",
        lg: "10px",
        xl: "10px",
        "2xl": "12px",
        "3xl": "14px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.04), 0 1px 3px rgba(16, 24, 40, 0.06)",
        raised: "0 4px 12px rgba(16, 24, 40, 0.08), 0 1px 3px rgba(16, 24, 40, 0.04)",
        overlay: "0 16px 40px rgba(16, 24, 40, 0.18)",
      },
      fontSize: {
        /** Console-scale type: 11 for meta, 12 for secondary, 13 body, 20 title. */
        "2xs": ["11px", "16px"],
      },
    },
  },
  plugins: [],
};

export default config;
