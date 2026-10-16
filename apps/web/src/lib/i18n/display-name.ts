import type { Locale } from "./locales";

/**
 * 同一份数据里带两种语言的名字时（`/meta/interests`、`/meta/purposes` 都是
 * `{ name, nameZh }`），按界面语言挑一个。
 *
 * ## 为什么需要它
 *
 * 这些名字以前一律写 `nameZh ?? name`：中文页面对，但**英文页面上显示中文**
 * （「游戏」「日本旅行」）。这不是漏翻，而是取了错的字段 —— 所以修法也不是往
 * 字典里加词条。
 *
 * ## 兜底方向
 *
 * 对面那一侧：只有一个名字时宁可显示另一种语言，也不显示空白。
 */
export function displayName(
  locale: Locale,
  row: { name: string; nameZh?: string | null },
): string {
  const zh = row.nameZh?.trim() || null;
  if (locale === "zh") return zh ?? row.name;
  return row.name.trim() || zh || "";
}
