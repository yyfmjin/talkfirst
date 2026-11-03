export const colors = {
  /**
   * 品牌蓝 = 与图标同一支蓝 `#0B7FFF`（2026-10-28 统一）。
   *
   * 说明：白字压在 `primary` 上是 **3.83**，不到正文级 AA 的 4.5 —— 比之前的
   * `#6B7CFF`（3.53）好，但仍未达标。所以「浅底上要读的蓝字」用 `primaryDark`
   * （#0063E6，对白 5.34），网页端的填充按钮同理走 brand-600。
   * 图标底、选中态、气泡这类「色块本身」用 `primary`。
   */
  primary: "#0B7FFF",
  primaryDark: "#0063E6",
  gradientFrom: "#0B7FFF",
  gradientTo: "#4AA6FF",
  /**
   * 页面画布。2026-11-03 改毛玻璃后这里是 **transparent**：底 wash 由
   * `components/Glass.tsx` 的 `<Wash />` 在 App 根部画一层，各页透明让 wash 透出来。
   * 要把某块面填成实色时用 `bgSolid`。
   */
  bg: "transparent",
  /** 真·不透明的白（原 `bg` 的值）。需要绝对不透明的地方用它。 */
  bgSolid: "#FFFFFF",
  bgSoft: "#F7FAFF",
  bgTint: "#EFF6FF",

  /*
   * 毛玻璃三档 + 边（对齐 web `design/tokens.ts` 的 `glass`）。
   * 不透明度按「离屏幕多远」分：卡片 58% / 浮层 80% / 凹陷 38%。
   * 单靠这几个半透明值只是灰雾，真正让它成玻璃的是 `Glass` 里的 BlurView。
   */
  glass: "rgba(255, 255, 255, 0.58)",
  glassRaised: "rgba(255, 255, 255, 0.80)",
  glassSunken: "rgba(255, 255, 255, 0.38)",
  glassEdge: "rgba(255, 255, 255, 0.66)",
  /** 底 wash 三段（与 web `globals.css` 同一组色）。 */
  washTop: "#F4F8FF",
  washMid: "#EAF2FF",
  washBottom: "#E0EBFF",

  ink: "#1B1B2F",
  /** 次要文字：毛玻璃底上原来的 `#8A8FA3` 只剩 3.1 左右，收到同 web 的 `#5A6478`。 */
  muted: "#5A6478",
  line: "#ECEEF5",
  danger: "#E5484D",
  dangerSoft: "#FDECEC",
  success: "#22A06B",
  white: "#FFFFFF",
} as const;
