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
  bg: "#FFFFFF",
  bgSoft: "#F7FAFF",
  bgTint: "#EFF6FF",
  ink: "#1B1B2F",
  muted: "#8A8FA3",
  line: "#ECEEF5",
  danger: "#E5484D",
  dangerSoft: "#FDECEC",
  success: "#22A06B",
  white: "#FFFFFF",
} as const;
