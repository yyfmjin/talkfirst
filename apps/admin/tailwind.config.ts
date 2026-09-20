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
        success: "#16A34A",
        warning: "#D97706",
        danger: "#DC2626",
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
