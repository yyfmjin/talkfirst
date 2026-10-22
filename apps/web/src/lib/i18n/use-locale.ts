"use client";

import { usePathname } from "next/navigation";
import { useCallback } from "react";
import { t as translate, type MsgKey, type MsgParams } from "./dictionary";
import { localeFromPath, type Locale } from "./locales";

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
 * ## `t` 的身份是稳定的（只随语言变）
 *
 * 早先这里每次渲染都返回一个新函数，并立了一条「`t` 不许进依赖数组」的规矩。
 * 规矩守不住：聊天页把它放进了 `loadHistory` 的依赖，而 `loadHistory` 又被
 * `useEffect([loadHistory])` 拉着跑 —— 每次渲染重新取消息、再 setState、再渲染，
 * 成了无限请求循环（React 报 `Maximum update depth exceeded`，断网时最明显）。
 *
 * 治根不治症状：`t` 用 `useCallback([locale])` 固定身份。于是
 *  - `t` 可以正常出现在依赖数组里，`exhaustive-deps` 不再需要豁免；
 *  - 切语言时依赖 `t` 的 effect 会重跑一次（这正是想要的）；
 *  - 同一语言下重渲染不改变 `t`，取数 effect 只跑一次。
 */
export function useT(): { locale: Locale; t: (key: MsgKey, params?: MsgParams) => string } {
  const locale = useLocale();
  const t = useCallback(
    (key: MsgKey, params?: MsgParams) => translate(locale, key, params),
    [locale],
  );
  return { locale, t };
}
