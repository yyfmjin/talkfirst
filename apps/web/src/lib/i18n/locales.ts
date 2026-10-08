/**
 * 语言与 URL 的关系（web 端）。
 *
 * ## 约定：中文是默认语言，URL 不挂前缀；英文在 `/en` 下
 *
 *   `/`          → 中文启动屏          `/en`          → 英文启动屏
 *   `/site`      → 中文官网            `/en/site`     → 英文官网
 *
 * 为什么中文不挂前缀：中文是现在真实在用的语言，已经发出去的链接（用户在用的
 * `/moments`、`/login`）不能因为加了多语言而失效。英文是新加的那一半，它承担
 * 维护前缀的成本。搜索收录上两者都拿得到各自的 canonical，代价是中文侧少一个
 * 「/zh」的显式前缀 —— 这个取舍是刻意的。
 *
 * ## 为什么没有 `[locale]` 动态段
 *
 * 标准做法是把整棵路由树搬到 `app/[locale]/` 下。这里没这么做：那要移动 35 个
 * 路由目录、并改掉散在各处的 `router.push("/moments")` 这类跳转，而线上正在跑。
 * 现在的做法是**每个翻译好的页面各有一个 `en` 兄弟文件**（`app/en/xxx/page.tsx`），
 * 两边都渲染同一个共享组件、只是传入不同的 `locale`。代价是每个页面多一个几行的
 * 包装文件；好处是**中文那棵树一行不动**，风险为零，并且可以一页一页地推进。
 *
 * 什么时候该换成 `[locale]`：当英文路由覆盖到跟中文一样全、且内部跳转都需要
 * 带语言时（那时手写 `localePath()` 的调用点会变得太多）。那是一次独立的重构。
 */

export const LOCALES = ["zh", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** 中文是默认语言（不带前缀的那个）。 */
export const DEFAULT_LOCALE: Locale = "zh";

/** 站内路径 → 带语言前缀的真实地址。中文不加前缀。 */
export function localePath(locale: Locale, path: string): string {
  const clean = path === "/" ? "" : path.startsWith("/") ? path : `/${path}`;
  if (locale === DEFAULT_LOCALE) return clean === "" ? "/" : clean;
  return `/${locale}${clean}`;
}

/** 另一种语言（语言切换用）。 */
export function otherLocale(locale: Locale): Locale {
  return locale === DEFAULT_LOCALE ? "en" : DEFAULT_LOCALE;
}
