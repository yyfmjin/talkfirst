---
version: alpha
name: TalkFirst
description: >-
  TalkFirst（先聊再交朋友）的设计系统。网页端 apps/web/src/design/tokens.ts 与
  App 端 apps/mobile/src/theme.ts 都以本文件为准；两端的主色、字号、圆角、
  表面语言必须一致。改这里之前，先读下面「两条硬约束」。
colors:
  # 品牌蓝：只允许表达「主要操作 / 当前选中 / 可点的链接」
  brand-50: "#EFF7FF"
  brand-100: "#DBEEFF"
  brand-200: "#B7DCFF"
  brand-300: "#85C4FF"
  brand-400: "#4AA6FF"
  brand-500: "#0B7FFF"
  brand-600: "#0063E6"
  brand-700: "#0050B8"
  # 社交暖色：连接/交换状态、动态编辑器强调色、发现页的次级强调
  accent-50: "#F4F2FF"
  accent-100: "#EBE7FF"
  accent-300: "#B9AEF7"
  accent-500: "#7C6CE5"
  accent-600: "#6A58D8"
  accent-700: "#5B49C7"
  # 中性
  ink: "#172033"
  ink-900: "#0E1522"
  neutral-700: "#2E3849"
  neutral-600: "#4A5468"
  muted: "#5A6478"
  line: "#ECEEF5"
  # 语义
  success: "#22C55E"
  success-dark: "#16A34A"
  warning: "#F59E0B"
  warning-dark: "#B26A00"
  danger: "#E5484D"
  # 底 wash（毛玻璃必须浮在它上面）
  wash-top: "#F4F8FF"
  wash-mid: "#EAF2FF"
  wash-bottom: "#E0EBFF"
typography:
  display:
    fontSize: 28px
    lineHeight: 36px
    fontWeight: 600
    letterSpacing: -0.01em
  title:
    fontSize: 22px
    lineHeight: 30px
    fontWeight: 600
    letterSpacing: -0.01em
  heading:
    fontSize: 17px
    lineHeight: 24px
    fontWeight: 600
  body:
    fontSize: 15px
    lineHeight: 23px
    fontWeight: 400
  ui:
    fontSize: 14px
    lineHeight: 20px
    fontWeight: 500
  caption:
    fontSize: 12px
    lineHeight: 17px
    fontWeight: 400
  overline:
    fontSize: 11px
    lineHeight: 15px
    fontWeight: 500
rounded:
  control: 18px
  row: 20px
  card: 24px
  sheet: 28px
  frame: 32px
  full: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
components:
  button-primary:
    backgroundColor: "{colors.brand-600}"
    textColor: "#FFFFFF"
    rounded: "{rounded.control}"
    height: 48px
  button-ghost:
    backgroundColor: "{colors.brand-50}"
    textColor: "{colors.brand-600}"
    rounded: "{rounded.control}"
    height: 48px
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "#FFFFFF"
    rounded: "{rounded.control}"
    height: 48px
  card:
    backgroundColor: "rgba(255, 255, 255, 0.58)"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "{spacing.lg}"
  input:
    backgroundColor: "rgba(255, 255, 255, 0.38)"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: 48px
---

# TalkFirst 设计系统

两端（`apps/web`、`apps/mobile`）共用的唯一事实源。代码里的 `tokens.ts` / `theme.ts`
必须与本文件逐项对齐；两者不一致时以本文件为准，并同时改代码。

## 两条硬约束

1. **品牌蓝只表示「主要操作 / 当前选中 / 链接」。** 产品不能整体变蓝。信息性元素
   一律走中性色阶，社交/连接语义走 `accent`。
2. **毛玻璃是「半透明 + backdrop-filter」成对成立。** 只要把页面画布（`surface.canvas`）
   改回不透明色，全站玻璃立刻退化成灰雾；反过来，只有半透明值、没有 `backdrop-filter`
   也一样。App 端的 `bg` 是 `transparent`，底 wash 由根组件的 `<Wash />` 画。

## 颜色

- **主色** `brand-500 #0B7FFF`：图标底、选中态、色块本身。
- **可读的蓝字** 必须用 `brand-600 #0063E6`（压白 5.34:1）。白字压在 `brand-500`
  上只有 3.83:1，不到正文级 AA，所以**填充按钮的底色用 600，不用 500**。
- **按下态** `brand-700 #0050B8`（白字 7.39:1）。
- **社交暖色** `accent-500 #7C6CE5`；浅底徽标上的文字用 `accent-700 #5B49C7`
  （在 `accent-100` 上 5.40:1，`accent-600` 只有 4.35:1，不够）。
- **次要文字** `muted #5A6478`。2026-11-03 从 `#68738A` 调深，因为毛玻璃换了淡蓝
  底 wash 后，旧值在输入框里已跌破 AA。
- **警示徽标** 深字用 `warning-dark #B26A00`（`warning-800` 在 `warning-100` 上只有 3.90:1，
  新档 5.x）。

## 毛玻璃表面

| 用途 | 值 |
|---|---|
| 卡片 / 面板 | `rgba(255,255,255,0.58)` |
| 浮在滚动之上（弹层、菜单、吸顶栏、底栏） | `rgba(255,255,255,0.80)` |
| 面板内凹陷（输入框、静默行） | `rgba(255,255,255,0.38)` |
| 设备外框 | `rgba(255,255,255,0.30)` |
| 白 hairline 边 | `rgba(255,255,255,0.66)` |
| `@supports not (backdrop-filter)` 兜底 | `rgba(255,255,255,0.92)` |

不透明度按「离屏幕多远」分三档，**不要随手加第四档**。顶部反光用 `background-image`
（`glass.sheen`），不要用 `box-shadow`，否则会盖掉组件自己的 elevation。

## 字号（7 级）

`display 28/36`、`title 22/30`、`heading 17/24`、`body 15/23`、`ui 14/20`、
`caption 12/17`、`overline 11/15`。行高是每一级的组成部分，不允许只取字号。
正文基准 15px 来自编辑器输入框（全站阅读最多的面）；11px 是地板，不允许更小。

**唯一例外**：直径 ≤ 16px 的小徽标（未读数、封面角标、▾ 这种符号）里的数字可以用
8–10px。这类字号是为盒子大小服务的，撑到 11px 会在圆点里溢出——属“刻意为之”，
不是漏改。除此外任何地方出现 8/9/10px 都是错的。

## 圆角（5 档）

`chip 12`（标签、小控件、头像占位）、`control 16`（按钮、输入框）、`card 24`（卡片、区块、列表行）、
`sheet 32`（弹层、对话框、设备外框）、`pill 999`（胶囊、头像、徽标）。

2026-11-06 收敛：App 端原来有 20 种圆角（2/3/4/5/6/8/9/10/11/12/13/14/16/18/20/22/24/40/66/999），
已全部并入上面 5 档（单处变化 ≤ 4px）；网页端 `radius` 仍保留 control/row/card/sheet/frame，
两边名称不同时以本表含义为准。

## 间距

`4 / 8 / 12 / 16 / 24 / 32`。只允许这六级，不要出现 `13px`、`18px` 这类随手值。

## 组件契约

- **按钮**：网页 4 语义 × 3 尺寸（`primary / secondary / ghost / danger` × `sm/md/lg`，
  `apps/web/src/components/tf/button.tsx`）。App 目前只有 `primary / ghost`，
  **缺 `danger`**（删号这类破坏性操作还在现场拼样式）——已知差距，见下。
- **表单**：输入框凹陷 `0.38` 白，聚焦用 `brand-500` 的 2px 内描边，不用外发光。
- **状态**：空态 / 加载态必须是共享组件（`EmptyState` / `Loading`），不要各页各写一种。

## 动效

只做入场与反馈，不做装饰性循环。缓动用标准 `ease-out`（150–220ms），
**禁止回弹 / 弹性 / 过冲**。任何动画都要有 `prefers-reduced-motion` 兜底。

## 现状与差距（2026-11-05）

已落地：品牌色两端统一 `#0B7FFF`；对比度（`muted`、主按钮底色、浅底强调字）已修；
网页端 7 级字号 + 5 档圆角 token 生效；全站毛玻璃（web `globals.css`、App `Glass.tsx`）。

未完成（按优先级）：

1. 可点区域小于 44 高的**文字链**（例：`Profile visibility`、`Translate`）—— 补 `hitSlop`
   只能治图标按钮；改行高会动列表密度，属于设计决定，还没动。
2. 深色模式下 8–10px 小徽标、图片蒙层、第三方内容（头像/封面）未逐一核对。
3. 600 档同时承担「可读蓝字」与「填充底色」两种用途，深色下靠 class 例外兼得；
   正解是拆成 `content-brand` / `fill-brand` 两个语义 token。

已完成：

- **字号/圆角**：App 从 14 种字号、17 种圆角收到 7 级 + 5 档（`src/design/tokens.ts`）。
- **可点区**：6 个 32/40 的图标按钮补 `hitSlop={10}`，实际可点 44；其余同类按钮本来就有。
- **裸色值**：网页 24 处旧紫蓝换成 brand/accent/neutral token（余下 13 处是注释与
  `themeColor` 元数据）。
- **深色模式（两端，跟随系统）**：
  - 网页：色阶改 CSS 变量（`tailwind.config.ts` 的 `designVars`），
    `globals.css` 的 `@media (prefers-color-scheme: dark)` 覆盖中性/文字/tint/玻璃。
  - App：`theme.ts` 的 `colors` 是 Proxy（渲染时取当前配色），48 个样式表改成
    `themed()` 懒构建（不改调用点）；`userInterfaceStyle: "automatic"`，
    冷启动用 `Appearance.getColorScheme()` 兜底（`useColorScheme()` 首帧可能为 null）。
  - 已验证：真机切 `cmd uimode night yes/no` 两端均跟随；冷启动日志 `hook=dark native=dark`；
    深色下 Me 屏背景中位亮度 38、文字 p95 180（可读）。

## 禁止项（AI 生成感的来源）
- 米色/沙色默认底；紫色→蓝色对角渐变当 hero；回弹缓动；卡片里套卡片；
  彩色底上的低对比灰字；emoji 当图标。
