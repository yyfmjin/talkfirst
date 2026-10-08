import Link from "next/link";
import { cn } from "@/lib/cn";
import { localePath, otherLocale, t, type Locale } from "@/lib/i18n";

/**
 * 语言切换。
 *
 * ## 为什么是一个链接，不是下拉框
 *
 * 这个站点只有两种语言，而"另一种语言的那一页"就是一个确定的 URL。一个链接
 * 就是一次跳转：不需要状态、不需要 JS、没有"选了但没生效"的中间态，也不需要
 * 用户先点开一个菜单才知道有哪些语言。
 *
 * ## 为什么显示的是另一种语言的名字
 *
 * 界面现在是中文时，写 `English` 而不是 `英文` —— 需要点它的人是看不懂当前
 * 界面语言的人。两种语言各自用**自己的语言**写（中文页显示 `English`，
 * 英文页显示 `中文`），这也是通行做法。
 *
 * ## 服务器组件
 *
 * 没有 `"use client"`：它只渲染一个 `<Link>`，放在静态页面上不会带任何 JS。
 */
export function LocaleSwitcher({
  locale,
  /** 当前页面**不带语言前缀**的路径（`/site`、`/`），转换目标由 `localePath()` 算。 */
  path,
  tone = "muted",
  className,
}: {
  locale: Locale;
  path: string;
  /** `muted` 用在浅色底上，`inverse` 用在深色/品牌色底上。 */
  tone?: "muted" | "inverse";
  className?: string;
}) {
  const target = otherLocale(locale);
  const label = target === "en" ? "English" : "中文";

  return (
    <Link
      href={localePath(target, path)}
      hrefLang={target}
      aria-label={t(locale, "common.switchToOtherLanguage", { language: label })}
      className={cn(
        "inline-flex items-center gap-1.5 text-caption font-medium transition-colors",
        tone === "muted" ? "text-content-muted hover:text-content" : "text-content-inverse/80 hover:text-content-inverse",
        className,
      )}
    >
      <GlobeIcon />
      {label}
    </Link>
  );
}

/** 地球。内联 SVG，不用 emoji（emoji 的字形与基线随系统变，也管不了颜色）。 */
function GlobeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      className="h-3.5 w-3.5"
    >
      <circle cx="8" cy="8" r="6.2" />
      <path d="M1.8 8h12.4M8 1.8c1.7 1.8 2.6 3.9 2.6 6.2S9.7 12.4 8 14.2C6.3 12.4 5.4 10.3 5.4 8S6.3 3.6 8 1.8Z" />
    </svg>
  );
}
