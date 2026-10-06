import type { Config } from "tailwindcss";

import {
  consoleColors,
  duration,
  ease,
  fontFamily,
  fontSize,
  fontWeight,
  radius,
  shadow,
} from "./src/design/tokens";

/**
 * 管理后台主题 —— 值全部来自 `src/design/tokens.ts`（B 方案，2026-10-06）。
 *
 * 上一版把色值直接写在这里，与成员端各一套：主色一边 indigo `#4F46E5`、
 * 一边 TalkFirst Blue `#3B82F6`。现在两边消费同一套值，映射表在 tokens.ts 文件头。
 *
 * 三条**必须继续成立**的结构约定（改这一行前先读）：
 *
 * 1. **状态色是扁平的键**（`bg-success-wash`、`text-danger`），不能写成嵌套刻度
 *    （`success: { wash: … }`）：`stat-card.tsx` 用 `text-success` 与 `bg-success/10`，
 *    `error-state.tsx` / `shell.tsx` 用 `text-danger`。写成对象会让这些类名解析不到，
 *    状态数字静默退回默认字色 —— 没有编译错误，只有看不出来。
 * 2. `primary-ink` 保留为独立类名，但**值已并入 `ink`**（成员端迁移表把 `#16213A`
 *    映射到 `content`）。保留名字是为了不动二十个页面里已有的类名。
 * 3. 半径仍是控制台密度（见 tokens.ts 文件头第 1 条），**不是**成员端的 18/20/24/28/32。
 */
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: consoleColors.bg,
        card: consoleColors.card,
        ink: consoleColors.ink,
        muted: consoleColors.muted,
        body: consoleColors.body,
        line: consoleColors.line,
        surface: consoleColors.surface,
        subtle: consoleColors.subtle,
        primary: consoleColors.primary,
        "primary-hover": consoleColors.primaryHover,
        "primary-active": consoleColors.primaryActive,
        "primary-ink": consoleColors.primaryInk,
        accent: consoleColors.accent,

        success: consoleColors.success,
        warning: consoleColors.warning,
        danger: consoleColors.danger,
        "danger-hover": consoleColors.dangerHover,

        "success-wash": consoleColors.successWash,
        "success-ink": consoleColors.successInk,
        "warning-wash": consoleColors.warningWash,
        "warning-ink": consoleColors.warningInk,
        "danger-wash": consoleColors.dangerWash,
        "danger-ink": consoleColors.dangerInk,
        "info-wash": consoleColors.infoWash,
        "info-ink": consoleColors.infoInk,
        "neutral-wash": consoleColors.neutralWash,
        "neutral-ink": consoleColors.neutralInk,
        "system-wash": consoleColors.systemWash,
        "system-ink": consoleColors.systemInk,
      },
      borderRadius: radius,
      boxShadow: shadow,
      /*
       * 逐项展开（而不是直接把 `fontSize` 传进去）是成员端同一处的写法：
       * `tokens.ts` 里的值带 `as const`，得到的是**只读元组**，而 Tailwind 的类型
       * 要的是可变元组 —— 直接传会以 `The type ... is 'readonly' and cannot be
       * assigned to the mutable type` 编译失败（2026-10-06 实测到了这条）。
       */
      fontSize: {
        display: [...fontSize.display],
        title: [...fontSize.title],
        heading: [...fontSize.heading],
        body: [...fontSize.body],
        ui: [...fontSize.ui],
        caption: [...fontSize.caption],
        overline: [...fontSize.overline],
        "2xs": [...fontSize["2xs"]],
      },
      fontWeight: fontWeight,
      fontFamily: { sans: [...fontFamily.sans] },
      transitionDuration: duration,
      transitionTimingFunction: ease,
    },
  },
  plugins: [],
};

export default config;
