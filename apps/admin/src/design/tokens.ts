/**
 * TalkFirst 管理后台 — 设计 token 单一真源（2026-10-06，B 方案）
 *
 * ## 这个文件解决什么
 *
 * 后台原先把色值写在自己的 `tailwind.config.ts` 里，与成员端
 * （`apps/web/src/design/tokens.ts`）**各是一套**：品牌主色一边是 indigo
 * `#4F46E5`、一边是 TalkFirst Blue `#3B82F6`；中性灰、字体栈也各写各的。
 * 结果是同一个产品里两套视觉语言。B 方案就是把后台接到成员端那套值上。
 *
 * ## 对齐映射（后台角色 → 成员端 token → 值）
 *
 * | 后台角色 | 成员端 | 值 | 说明 |
 * |---|---|---|---|
 * | `primary` | `brand-500` | `#3B82F6` | 产品的品牌蓝，**唯一**允许表示「首要操作 / 激活 / 链接」的颜色 |
 * | `primary-hover` | `brand-600` | `#2563EB` | 按下 / 悬停 |
 * | `accent` | `brand-100` | `#EAF3FF` | 图标底、激活行、chip 的浅底 |
 * | `bg` | `neutral-50` | `#F7F9FC` | 页面画布 |
 * | `card` | `neutral-0` | `#FFFFFF` | 卡片/表格/浮层 |
 * | `surface` | `neutral-25` | `#FBFCFE` | 卡片内的凹槽面板（日志、详情块） |
 * | `subtle` | `neutral-100` | `#F1F4F9` | 行悬停与中性 chip |
 * | `line` | `neutral-200` | `#E9EDF4` | 发丝边框与分隔线 |
 * | `ink` | `neutral-800` | `#172033` | 正文主色 |
 * | `muted` | `neutral-500` | `#68738A` | 次要文字、表头 |
 * | `body` | `neutral-600` | `#4A5468` | 导航标签、次级正文 |
 * | `primary-ink` | `neutral-800` | `#172033` | 填充按钮的深色。**并入 `content`** —— 成员端自己的迁移表里 `#16213A → content` 就是这么定的 |
 * | `success/warning/danger` | `*-600` | `#16A34A` / `#D97706` / `#DC2626` | 与成员端**本来就相同** |
 * | `*-wash` / `*-ink` | `*-100` / `*-700`~`800` | 见下 | 徽标底色与文字 |
 * | `system-wash/ink` | `accent-50` / `accent-600` | `#F4F2FF` / `#6A58D8` | 「SYSTEM · 自动」标记（审计时间线、风险列表） |
 * | `fontFamily` | 成员端同一栈 | — | **去掉 `Inter`**，改用成员端的 CJK 优先栈 |
 *
 * ## 刻意**不**对齐的两处（都是控制台的固有取舍，改这里即可对齐）
 *
 * 1. **半径**：成员端是 18/20/24/28/32（手机卡片尺度）；后台保留 8/10/12/14。
 *    原因写在原先的配置文件里：16px 卡片在信息密集的运维台里会读成「消费级气泡」。
 *    要对齐就改下面 `radius` 一个块。
 * 2. **字号**：这次只把**命名**对齐（display/title/heading/body/ui/caption/overline
 *    七个名字与成员端一致），但旧页面里的 `text-[13px]` 这类字面量**尚未逐页替换** ——
 *    逐页替换会把正文从 13px 抬到 ui 的 14px，属于可见变化，留作 B 的第二阶段单独做、单独验收。
 *
 * ## 值从哪来
 *
 * 全部逐字取自 `apps/web/src/design/tokens.ts`（成员端设计体系）。任何一处要改，
 * 先在成员端改，再同步到这里 —— 不要在这里发明新值。
 */

/* -------------------------------------------------------------------------- */
/* 品牌与语义色                                                                */
/* -------------------------------------------------------------------------- */

/** TalkFirst Blue —— 产品的品牌色。只有「首要操作 / 激活 / 链接」可以用它。 */
export const brand = {
  50: "#F5F9FF",
  100: "#EAF3FF",
  200: "#D6E6FF",
  300: "#B3D1FE",
  400: "#7BAAF9",
  500: "#3B82F6",
  600: "#2563EB",
  700: "#1D4ED8",
} as const;

/** 社交层配色（成员端用于连接/交换与发现页的次级强调）。后台只用于「SYSTEM」标记。 */
export const accent = {
  50: "#F4F2FF",
  100: "#EBE7FF",
  300: "#B9AEF7",
  500: "#7C6CE5",
  600: "#6A58D8",
} as const;

export const success = {
  50: "#ECFDF3",
  100: "#DCFCE7",
  500: "#22C55E",
  600: "#16A34A",
  700: "#15803D",
} as const;

export const warning = {
  50: "#FFFBEB",
  100: "#FFF4E5",
  200: "#FFE0B2",
  500: "#F59E0B",
  600: "#D97706",
  800: "#B26A00",
} as const;

export const danger = {
  50: "#FEF2F2",
  100: "#FEE2E2",
  200: "#FECACA",
  500: "#EF4444",
  600: "#DC2626",
  700: "#B91C1C",
} as const;

export const info = {
  50: "#EFF6FF",
  100: "#DBEAFE",
  500: "#3B82F6",
  700: "#1D4ED8",
} as const;

/* -------------------------------------------------------------------------- */
/* 中性色与语义角色                                                            */
/* -------------------------------------------------------------------------- */

export const neutral = {
  0: "#FFFFFF",
  25: "#FBFCFE",
  50: "#F7F9FC",
  100: "#F1F4F9",
  200: "#E9EDF4",
  300: "#D8DEE9",
  400: "#B4BCCC",
  500: "#68738A",
  600: "#4A5468",
  700: "#2E3849",
  800: "#172033",
  900: "#0E1522",
} as const;

/**
 * 后台界面用到的角色。名字沿用控制台里那二十个页面已经在用的历史名
 * （`ink` / `muted` / `line` / `bg` / `card` / `surface` / `subtle`），
 * 这样换值不必逐页改类名。
 */
export const consoleColors = {
  /** 页面画布。 */
  bg: neutral[50],
  /** 卡片、表格、浮层。 */
  card: neutral[0],
  /** 正文主色。 */
  ink: neutral[800],
  /** 次要文字、标签、表头。 */
  muted: neutral[500],
  /** 导航标签与次级正文（成员端的 neutral-600）。 */
  body: neutral[600],
  /** 发丝边框与分隔线。 */
  line: neutral[200],
  /** 卡片内的凹槽面板。 */
  surface: neutral[25],
  /** 行悬停与中性 chip。 */
  subtle: neutral[100],
  /** 唯一强调色。 */
  primary: brand[500],
  /** 强调色按下/悬停。 */
  primaryHover: brand[600],
  /** 强调色的按下态；用于「实心按钮的底色必须达到 AA」那一步（见下方注释）。 */
  primaryActive: brand[700],
  /** 强调色浅底。 */
  accent: brand[100],
  /** 填充按钮的深色；已并入 `ink`（成员端迁移表 `#16213A → content`）。 */
  primaryInk: neutral[800],

  success: success[600],
  warning: warning[600],
  danger: danger[600],
  dangerHover: danger[700],

  successWash: success[100],
  successInk: success[700],
  warningWash: warning[100],
  /*
   * **刻意不等于成员端的 `warning-800`（#B26A00）。**
   * 2026-10-06 实测（WCAG 相对亮度）：#B26A00 在白底只有 **4.24**、在 `warning-100`
   * 桃底上只有 **3.90** —— 两者都不到正文所需的 4.5。徽标是 11-12px 小字，
   * 不适用「大字 3.0」的宽松阈值。改用深一档的 #92400E：桃底 **6.52**、
   * 旧黄底 **6.37**，都属于 AA 合格。（成员端 `tf/display.tsx` 用的仍是
   * `text-warning-800`，那条待成员端自己修，见 `docs/DESIGN-SYSTEM.md` 的对比度审计。）
   */
  warningInk: "#92400E",
  dangerWash: danger[100],
  dangerInk: danger[700],
  infoWash: info[100],
  infoInk: info[700],

  /** 「停用 / 已移除 / 已拒绝」这一类冷灰。 */
  neutralWash: neutral[100],
  neutralInk: neutral[600],

  /** 「SYSTEM · 自动」：不是「停用」，而是「没有人做过这件事」。 */
  systemWash: accent[50],
  systemInk: accent[600],
} as const;

/* -------------------------------------------------------------------------- */
/* 形状、层级、字体、动效                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 半径：**刻意保持控制台密度**（见文件头第 1 条）。要对齐成员端就把这里换成
 * `{ control: "18px", row: "20px", card: "24px", sheet: "28px", frame: "32px" }`
 * 并同步 `tailwind.config.ts` 的键名。
 */
export const radius = {
  md: "8px",
  lg: "10px",
  xl: "10px",
  "2xl": "12px",
  "3xl": "14px",
} as const;

/** 抬起层级：几乎不用阴影，靠边框 + 背景分层。阴影色基与成员端一致（neutral-800）。 */
export const shadow = {
  card: "0 1px 2px rgba(23, 32, 51, 0.04), 0 1px 3px rgba(23, 32, 51, 0.05)",
  raised: "0 4px 12px rgba(23, 32, 51, 0.08), 0 1px 3px rgba(23, 32, 51, 0.04)",
  overlay: "0 16px 40px rgba(23, 32, 51, 0.18)",
} as const;

/**
 * 七个字号步长，**名字与成员端一致**（值也一致）。旧页面的 `text-[13px]`
 * 等字面量尚未替换 —— 见文件头第 2 条。`2xs` 是既有页面的兼容别名。
 */
export const fontSize = {
  display: ["28px", { lineHeight: "36px", letterSpacing: "-0.01em" }],
  title: ["22px", { lineHeight: "30px", letterSpacing: "-0.01em" }],
  heading: ["17px", { lineHeight: "24px" }],
  body: ["15px", { lineHeight: "23px" }],
  ui: ["14px", { lineHeight: "20px" }],
  caption: ["12px", { lineHeight: "17px" }],
  overline: ["11px", { lineHeight: "15px" }],
  /** 兼容：既有两个页面用 `text-2xs`。 */
  "2xs": ["11px", "16px"],
} as const;

export const fontWeight = {
  regular: "400",
  medium: "500",
  semibold: "600",
} as const;

/**
 * 与成员端同一套字体栈。**刻意不含 `Inter`**：成员端用的是 CJK 优先栈，
 * 中英混排时字形归属一致；`Inter` 在前会让后台的中文回退行为与成员端不同。
 */
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

/** 四个允许的时长；控制台不用更长的过渡。 */
export const duration = {
  instant: "120ms",
  fast: "180ms",
  base: "240ms",
  slow: "320ms",
} as const;

/** 两条缓动：出现用 `out`，进出对称动作用 `inOut`。 */
export const ease = {
  out: "cubic-bezier(0.22, 1, 0.36, 1)",
  inOut: "cubic-bezier(0.4, 0, 0.2, 1)",
} as const;
