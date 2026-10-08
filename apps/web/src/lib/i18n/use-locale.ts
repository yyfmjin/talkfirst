"use client";

import { usePathname } from "next/navigation";
import { t, type MsgKey, type MsgParams } from "./dictionary";
import { DEFAULT_LOCALE, type Locale } from "./locales";

/**
 * 客户端组件怎么知道自己是哪个语言。
 *
 * ## 为什么从路径读，而不是一路传 prop
 *
 * 英文页面的地址是 `/en/...`（见 `locales.ts` 的约定），所以**路径本身就是语言**。
 * 让每个需要文案的组件自己读一次，比把 `locale` 从页面一路传到第 4 层的表单、
 * 按钮、错误提示要稳得多 —— 少一层就少一次「有人忘了传、于是显示中文」的机会。
 *
 * 服务端组件拿不到 `usePathname()`，所以那边仍然把 `locale` 当参数传
 * （见 `marketing/official-site.tsx`）。
 *
 * ## 只有两种语言，所以规则简单
 *
 * `/en` 与 `/en/...` 是英文，其余是默认语言。没有第三种情况 —— 加语言时这里和
 * `locales.ts` 一起改。
 */
export function useLocale(): Locale {
  const pathname = usePathname();
  if (!pathname) return DEFAULT_LOCALE;
  return pathname === "/en" || pathname.startsWith("/en/") ? "en" : DEFAULT_LOCALE;
}

/**
 * 组件里用这个拿文案。返回的 `t` 已经绑定当前语言，调用点和中文页面写法一样：
 * `t("auth.toRegister")`。
 */
export function useT(): { locale: Locale; t: (key: MsgKey, params?: MsgParams) => string } {
  const locale = useLocale();
  return {
    locale,
    t: (key: MsgKey, params?: MsgParams) => t(locale, key, params),
  };
}
