"use client";

import { useEffect } from "react";
import type { Locale } from "@/lib/i18n";

/**
 * 让 `<html lang>` 跟着页面语言走。
 *
 * ## 为什么需要它
 *
 * 根布局写死了 `<html lang="zh-CN">`，而 Next 的 App Router 里 `lang` 只能由**根布局**
 * 设置。所以英文页面的 HTML 上会挂着 `zh-CN` —— 读屏软件会拿中文发音规则去念英文，
 * 这是真实存在的可访问性问题，不是洁癖。
 *
 * ## 为什么是在客户端补，而不是重构
 *
 * 正解是"多个根布局"：把中文路由放进 `app/(zh)/`、英文放进 `app/(en)/`，各自一个
 * 根布局。但那要把现有 35 个路由全部搬进分组目录，而线上正在跑 —— 与
 * `src/lib/i18n/locales.ts` 里记的是同一个取舍。
 *
 * 代价说清楚：**首屏 HTML 里仍然是 `zh-CN`**（水合后才改成 `en`）。所以
 *  - 读屏：打开页面几百毫秒内就修正了，可以接受；
 *  - 搜索引擎：仍然会看到 `zh-CN`。真正的解法就是上面那条重构，等英文路由铺满时一起做。
 */
export function HtmlLang({ locale }: { locale: Locale }) {
  useEffect(() => {
    document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
  }, [locale]);

  return null;
}
