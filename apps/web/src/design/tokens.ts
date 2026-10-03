/**
 * TalkFirst Design Tokens — the single source of truth for the member app's
 * visual language.
 *
 * ## Where these values come from
 *
 * They are extracted from PC-3.6 「发布动态」 (`app/moments/compose/page.tsx`),
 * which is the design reference for the whole product. Everything that page does
 * well — one continuous column instead of stacked cards, a borderless body, a
 * condensed identity + visibility row, a single sticky CTA, light borders
 * instead of heavy shadows — is encoded here as a reusable scale rather than as
 * per-page class strings.
 *
 * ## The rule this file exists to enforce
 *
 * Before this file the app had 48 distinct hex values, 17 arbitrary font sizes
 * (`text-[8px]` … `text-[34px]`) and 9 different button heights, all written
 * inline. A page could not be restyled without hunting through its JSX, and two
 * pages could not be made to agree. Anything that repeats more than twice now
 * gets a name here first.
 *
 * ## Backwards compatibility (important)
 *
 * `ink` / `muted` / `cloud` / `line` keep their EXACT previous values (and the
 * `phone` shadow keeps its exact value) so that Phase A changes nothing on
 * screen. They are legacy aliases: new code should use the semantic names
 * (`content`, `contentMuted`, `surfaceSunken`, `border`, `brand`, …). The
 * legacy names are removed only when their last caller is migrated, page by
 * page, in Phases B–H.
 *
 * ## Not here (deliberately)
 *
 * No component classes. Tokens describe *what* a colour or a step is; how a
 * button uses them belongs to `components/tf/*`.
 */

/* -------------------------------------------------------------------------- */
/* Brand                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * TalkFirst Blue.
 *
 * The product's brand colour, and the ONLY colour allowed to mean "this is the
 * primary action / this is active / this is a link". The brief is explicit that
 * the whole product must not become blue: blue carries primary and active,
 * nothing else. Everything informational uses the neutral scale.
 */
export const brand = {
  50: "#F5F9FF",
  100: "#EAF3FF",
  200: "#D6E6FF",
  300: "#B3D1FE",
  400: "#7BAAF9",
  500: "#3B82F6", // primary — CTAs, active nav, links
  600: "#2563EB", // pressed / hover for primary
  700: "#1D4ED8", // rare: on-light text needing more contrast than 500
} as const;

/**
 * The warm counterpart to brand blue.
 *
 * Reserved for "the social layer": connection and exchange states, the moments
 * composer's accent, and Discover's secondary emphasis. It exists so that
 * "connected" and "primary action" can be told apart by colour alone — a
 * distinction the old single-purple palette could not express.
 */
export const accent = {
  50: "#F4F2FF",
  100: "#EBE7FF",
  300: "#B9AEF7",
  500: "#7C6CE5",
  600: "#6A58D8",
} as const;

/* -------------------------------------------------------------------------- */
/* Semantic status                                                            */
/* -------------------------------------------------------------------------- */

/** Success — exchange completed, saved, online. */
export const success = {
  50: "#ECFDF3",
  100: "#DCFCE7",
  500: "#22C55E",
  600: "#16A34A",
  700: "#15803D",
} as const;

/** Warning — quota exhausted, "retired" tags, unverified states. */
export const warning = {
  50: "#FFFBEB",
  100: "#FFF4E5",
  200: "#FFE0B2",
  500: "#F59E0B",
  600: "#D97706",
  800: "#B26A00",
} as const;

/** Danger — destructive actions, errors, blocked. */
export const danger = {
  50: "#FEF2F2",
  100: "#FEE2E2",
  200: "#FECACA",
  500: "#EF4444",
  600: "#DC2626",
  700: "#B91C1C",
} as const;

/** Info — neutral system notices that are neither success nor warning. */
export const info = {
  50: "#EFF6FF",
  100: "#DBEAFE",
  500: "#3B82F6",
  700: "#1D4ED8",
} as const;

/* -------------------------------------------------------------------------- */
/* Neutrals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The neutral scale, and the semantic roles built from it.
 *
 * `content` is the one text colour for body copy; `contentMuted` is everything
 * secondary (timestamps, hints, counts). The old palette had `ink` plus two
 * competing near-ink values (`#3D4663`, `#16213A`) and five weights of muted —
 * that is what this replaces.
 */
export const neutral = {
  0: "#FFFFFF",
  25: "#FBFCFE",
  50: "#F7F9FC", // page canvas
  100: "#F1F4F9",
  200: "#E9EDF4", // hairlines, dividers
  300: "#D8DEE9",
  400: "#B4BCCC",
  500: "#68738A", // secondary text
  600: "#4A5468",
  700: "#2E3849",
  800: "#172033", // primary text
  900: "#0E1522",
} as const;

/** Readable aliases for the neutral roles, so call sites read as intent. */
export const surface = {
  /** Card / sheet / row background. */
  DEFAULT: neutral[0],
  /** Page canvas behind content. */
  canvas: neutral[50],
  /** Recessed fill: inputs, quiet panels, code blocks. */
  sunken: neutral[100],
  /** A tint that belongs to the brand rather than to depth. */
  brand: brand[100],
  /** Overlay scrim behind sheets and dialogs. */
  scrim: "rgba(15, 23, 42, 0.36)",
} as const;

export const content = {
  DEFAULT: neutral[800],
  muted: neutral[500],
  subtle: neutral[400],
  inverse: neutral[0],
  brand: brand[500],
  accent: accent[500],
} as const;

export const border = {
  DEFAULT: neutral[200],
  /** A border that must read on a sunken surface. */
  strong: neutral[300],
  /** Brand-tinted border for selected chips and focused rows. */
  brand: brand[300],
} as const;

/* -------------------------------------------------------------------------- */
/* Shape                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Radius scale. The brief allows 18/20/24/28/32 and forbids the soup of
 * `rounded-2xl` + `rounded-3xl` + `rounded-[27px]` + `rounded-[19px]`.
 *
 * Each step has exactly one job:
 *   18 → controls (button, input, chip-as-rect)
 *   20 → rows and list items
 *   24 → cards and sections
 *   28 → sheets and dialogs
 *   32 → the device frame only
 *   full → pills, avatars, badges
 */
export const radius = {
  control: "18px",
  row: "20px",
  card: "24px",
  sheet: "28px",
  frame: "32px",
} as const;

/**
 * Elevation. Deliberately almost nothing: the design language is "border + a
 * background layer beats a shadow". `card` is a hairline lift, `raised` is for
 * something that genuinely floats above a scroll (sticky CTA, dropdown), and
 * `overlay` is only for a modal that covers the screen.
 */
export const shadow = {
  card: "0 1px 2px rgba(23, 32, 51, 0.04), 0 1px 3px rgba(23, 32, 51, 0.05)",
  raised: "0 4px 14px rgba(23, 32, 51, 0.08), 0 1px 3px rgba(23, 32, 51, 0.04)",
  overlay: "0 16px 40px rgba(23, 32, 51, 0.16)",
  /** Kept verbatim from the pre-existing config so PhoneShell is unchanged. */
  phone: "0 30px 80px rgba(80, 110, 200, 0.18)",
  /** The brand CTA's lift. Very light on purpose. */
  brand: "0 6px 16px rgba(59, 130, 246, 0.24)",
} as const;

/* -------------------------------------------------------------------------- */
/* Type                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Seven steps, down from seventeen arbitrary sizes.
 *
 * Body text is 15px (the composer's textarea — the single most-read surface in
 * the product — is the reference), secondary 12px, and nothing in the member app
 * goes below 11px. Line heights are part of each step so a size can never be
 * applied without one.
 */
export const fontSize = {
  /** Auth headlines, empty-state titles. */
  display: ["28px", { lineHeight: "36px", letterSpacing: "-0.01em" }],
  /** Page titles. */
  title: ["22px", { lineHeight: "30px", letterSpacing: "-0.01em" }],
  /** Section titles, dialog titles, the screen header. */
  heading: ["17px", { lineHeight: "24px" }],
  /** Long-form reading: moment bodies, comments, chat bubbles. */
  body: ["15px", { lineHeight: "23px" }],
  /** The default UI size: buttons, list rows, form values. */
  ui: ["14px", { lineHeight: "20px" }],
  /** Secondary text: hints, counts, timestamps. */
  caption: ["12px", { lineHeight: "17px" }],
  /** The floor: badges and dense meta. Nothing smaller exists. */
  overline: ["11px", { lineHeight: "15px" }],
} as const;

export const fontWeight = {
  regular: "400",
  medium: "500",
  semibold: "600",
} as const;

export const fontFamily = {
  sans: [
    '"PingFang SC"',
    '"Hiragino Sans GB"',
    '"Noto Sans SC"',
    '"Segoe UI"',
    "system-ui",
    "sans-serif",
  ],
} as const;

/* -------------------------------------------------------------------------- */
/* Motion                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The four allowed durations. Anything longer than 320ms on a mobile surface
 * reads as lag rather than as polish, and the brief forbids bounce/spring/
 * infinite decoration outside the Discover bubbles (which keep their own
 * `tf-bubble-float` keyframes).
 */
export const duration = {
  /** State feedback: press, hover, checkbox. */
  instant: "120ms",
  /** Small movement: fade in, chevron rotate. */
  fast: "180ms",
  /** Sheets, dialogs, expanding panels. */
  base: "240ms",
  /** A full-screen transition on the one screen that needs it. */
  slow: "320ms",
} as const;

export const ease = {
  /** Default for anything that appears. */
  out: "cubic-bezier(0.22, 1, 0.36, 1)",
  /** Symmetric: things that move in and out of place. */
  inOut: "cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

/** The four allowed animation keyframe names, for `animation-*` utilities. */
export const keyframes = {
  "tf-fade-in": {
    from: { opacity: "0" },
    to: { opacity: "1" },
  },
  "tf-slide-up": {
    from: { transform: "translateY(8px)", opacity: "0" },
    to: { transform: "translateY(0)", opacity: "1" },
  },
  "tf-sheet-up": {
    from: { transform: "translateY(100%)" },
    to: { transform: "translateY(0)" },
  },
  "tf-pulse-soft": {
    "0%, 100%": { opacity: "1" },
    "50%": { opacity: "0.55" },
  },
} as const;

/* -------------------------------------------------------------------------- */
/* Layout                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The member app is a phone-first product rendered inside `PhoneShell`. These are
 * the only widths that should ever be written down.
 */
export const layout = {
  /** Below `sm` the shell fills the viewport. */
  mobile: "100%",
  /** At `sm` and up the content column is locked to a phone width. */
  phoneWidth: "390px",
  /** The widest the column may ever stretch. */
  phoneWidthMax: "430px",
  /** The composer's textarea cap, kept from PC-3.6. */
  composerMaxHeight: "220px",
} as const;

/** Touch targets. 44px is the floor for anything a thumb must hit. */
export const controlSize = {
  icon: "44px",
  sm: "36px",
  md: "44px",
  lg: "48px",
} as const;

/* -------------------------------------------------------------------------- */
/* Legacy aliases                                                             */
/* -------------------------------------------------------------------------- */

/**
 * The pre-existing token values, byte-identical.
 *
 * Phase A must not change a single pixel, and every page still reads these names
 * from `tailwind.config.ts`. They are deprecated: each one has an entry in
 * `LEGACY_MIGRATION` below naming its replacement, so the Phase B–H work is a
 * lookup rather than a judgement call.
 */
export const legacy = {
  ink: "#1C2740",
  muted: "#8B95A7",
  cloud: "#F4F7FF",
  line: "#E7ECF5",
} as const;

/**
 * `old name → new token`. Used by the migration checklist and by
 * `DESIGN-SYSTEM.md`; nothing imports it at runtime, which is the point — it
 * documents intent without adding a dependency.
 */
export const LEGACY_MIGRATION = {
  ink: "content",
  muted: "content-muted",
  cloud: "surface-sunken",
  line: "border",
} as const;

/** Every legacy hex that must disappear by the end of Phase H, with its mapping. */
export const HEX_MIGRATION: Record<string, string> = {
  // Brand blues → brand
  "#6572D8": "brand-500",
  "#6B7CFF": "brand-500",
  "#5B6BD6": "brand-600",
  "#7B86FF": "brand-400",
  "#7B7BFF": "brand-400",
  "#EEF1FF": "brand-100",
  "#F1F3FF": "brand-100",
  "#E4E8FF": "brand-100",
  "#D6E6FF": "brand-200",
  "#C7CCFF": "brand-200",
  // `#16213A` was an un-tokenised third "primary" used for dark CTAs.
  "#16213A": "content",
  // Purples → accent
  "#8B6CFF": "accent-500",
  "#A47BFF": "accent-300",
  "#9B7BFF": "accent-300",
  "#7C5CD6": "accent-600",
  "#F4F1FF": "accent-50",
  "#EEF3FF": "surface-canvas",
  // Surfaces
  "#F8FAFF": "surface-sunken",
  "#F8F9FF": "surface-sunken",
  "#F7F9FF": "surface-sunken",
  "#FAFBFF": "surface-sunken",
  "#F4F6FF": "surface-sunken",
  "#F3F4F9": "surface-sunken",
  "#EEF2FF": "brand-50",
  // Text
  "#3D4663": "neutral-700",
  "#68738A": "content-muted",
  // Status
  "#B26A00": "warning-800",
  "#8A5A00": "warning-800",
  "#9A6B1A": "warning-800",
  "#FFF4E5": "warning-100",
  "#FFF8EC": "warning-50",
  "#FFF7E6": "warning-50",
  "#FFE0B2": "warning-200",
  "#EAFBF1": "success-50",
  "#0E9F6E": "success-600",
  // Charts / illustration only — deliberately kept out of the UI scale.
  "#F472B6": "(avatar preset)",
  "#2DD4BF": "(avatar preset)",
  "#FBBF24": "(avatar preset)",
  "#60A5FA": "(avatar preset)",
  "#A78BFA": "(avatar preset)",
};
