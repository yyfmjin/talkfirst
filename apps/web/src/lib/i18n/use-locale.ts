"use client";

import { usePathname } from "next/navigation";
import { t, type MsgKey, type MsgParams } from "./dictionary";
import { DEFAULT_LOCALE, localeFromPath, type Locale } from "./locales";

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
  /*
   * 由 `localeFromPath` 判定，不在这里重写一遍规则：纯函数（`currentLocale()`，
   * 例如 `friendlyErrorMessage`）用的是同一条规则，两处各写一遍迟早分叉 ——
   * 而分叉的症状是「同一页上两句话是不同语言」，很难查。
   */
  return localeFromPath(usePathname());
}

/**
 * 组件里用这个拿文案。返回的 `t` 已经绑定当前语言，调用点和中文页面写法一样：
 * `t("auth.toRegister")`。
 *
 * ## ⚠️ 不要把 `t` 放进 useEffect / useCallback 的依赖数组
 *
 * 这里的 `t` **每次渲染都是新的函数**。放进去会让 depend on 它的 effect 每轮重跑
 * —— 取数的 effect 就是无限请求。（lint 会提示 `exhaustive-deps` 缺 `t`，那 4 处
 * 提醒是故意的，不是因为没看见。）
 *
 * 代价要说清楚：文案随语言变化而重新取数的 effect 不会自动重跑。目前没这个需求
 * —— 数据与语言无关，界面对文案的重渲染本来就会发生。哪天需要了，正确做法是
 * 把 `t` 用 `useCallback([locale])` 稳定下来，再统一把 `t` 加回依赖。
 */
export function useT(): { locale: Locale; t: (key: MsgKey, params?: MsgParams) => string } {
  const locale = useLocale();
  return {
    locale,
    t: (key: MsgKey, params?: MsgParams) => t(locale, key, params),
  };
}
