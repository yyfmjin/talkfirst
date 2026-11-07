import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";
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
/** `#RRGGBB` → Tailwind 可用的「带 alpha 插槽」颜色。 */
const cssColor = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

/** 把一个色阶整体映射成 CSS 变量引用（键名不变，`bg-brand-500` 照旧）。 */
const colorScale = (family: string, scale: Record<string, string>) => {
  const out: Record<string, string> = {};
  for (const step of Object.keys(scale)) {
    out[step] = cssColor(`${family}-${step}`);
  }
  return out;
};

/** hex → `"R G B"`：`rgb(var(--x) / .5)` 需要 triplet，不能直接填 hex。 */
const hexToTriplet = (value: string): string | null => {
  if (!value.startsWith("#")) return null;
  const raw = value.slice(1);
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};

const scaleVars = (family: string, scale: Record<string, string>) => {
  const out: Record<string, string> = {};
  for (const [step, value] of Object.entries(scale)) {
    const triplet = hexToTriplet(value);
    if (triplet) out[`--${family}-${step}`] = triplet;
  }
  return out;
};

/**
 * 把 tokens 里的色阶写成 `:root` 的 CSS 变量（浅色一套）。
 *
 * 深色值不在这里 —— 它写在 `app/globals.css` 的
 * `@media (prefers-color-scheme: dark)` 里，因为那里能同时看到底 wash、
 * 玻璃反光和上下文注释。
 */
const designVars = plugin(({ addBase }) => {
  addBase({
    ":root": {
      ...scaleVars("brand", brand),
      ...scaleVars("accent", accent),
      ...scaleVars("success", success),
      ...scaleVars("warning", warning),
      ...scaleVars("danger", danger),
      ...scaleVars("info", info),
      ...scaleVars("neutral", neutral),
      ...scaleVars("content", content),
      // 以下四个是带 alpha 的 rgba，直接当完整颜色用
      "--surface": surface.DEFAULT,
      "--surface-raised": surface.raised,
      "--surface-frame": surface.frame,
      "--surface-canvas": surface.canvas,
      "--surface-sunken": surface.sunken,
      "--surface-brand": surface.brand,
      "--surface-scrim": surface.scrim,
      "--border": border.DEFAULT,
      "--border-hairline": border.hairline,
      "--border-strong": border.strong,
    },
  });
});

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        /*
         * 全部色阶走 CSS 变量（2026-11-06，跟随系统的深色模式）。
         *
         * 为什么不再把 hex 直接交给 Tailwind：Tailwind 生成的是**静态色**，
         * 同一个 `text-content` 没法在深色下变成另一个值。映射成
         * `rgb(var(--x) / <alpha-value>)` 之后，调用点一个字都不用改；
         * `<alpha-value>` 还保住了 `/60`、`/80` 这类透明度修饰。
         *
         * 变量由文件末尾的 `designVars` 插件从 tokens 生成（不手抄 hex）；
         * 深色值写在 `app/globals.css` 的 `prefers-color-scheme: dark` 里。
         */
        brand: colorScale("brand", brand),
        accent: colorScale("accent", accent),
        success: colorScale("success", success),
        warning: colorScale("warning", warning),
        danger: colorScale("danger", danger),
        info: colorScale("info", info),
        neutral: colorScale("neutral", neutral),
        content: colorScale("content", content),

        /* glass 的四个 tint 自带固定 alpha，拆成 triplet 会让 `/80` 覆盖掉
           原本 0.58 的语义，所以整条颜色走 var（深色只换 var 的值）。 */
        surface: {
          DEFAULT: "var(--surface)",
          raised: "var(--surface-raised)",
          frame: "var(--surface-frame)",
          canvas: "var(--surface-canvas)",
          sunken: "var(--surface-sunken)",
          brand: "var(--surface-brand)",
          scrim: "var(--surface-scrim)",
        },
        border: {
          DEFAULT: "var(--border)",
          hairline: "var(--border-hairline)",
          strong: "var(--border-strong)",
          brand: cssColor("brand-300"),
        },

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
        /*
         * 骨架节奏统一（2026-10-31）：原来 `pulse-soft` 是 1.6s、Tailwind 自带的
         * `animate-pulse` 是 2s，同一个页面里两种呼吸速度，看起来像卡顿。现在两个
         * 名字指向同一个 keyframes、同一个 1.2s，谁写哪个都对。
         */
        "pulse-soft": "tf-pulse-soft 1.2s ease-in-out infinite",
        pulse: "tf-pulse-soft 1.2s ease-in-out infinite",
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
  plugins: [designVars],
};

export default config;
