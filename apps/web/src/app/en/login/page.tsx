import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import LoginPage from "../../login/page";

/**
 * Sign in (English, `/en/login`).
 *
 * The page itself is the SAME module as the Chinese route — it reads the locale
 * from the pathname (`useT()`, see `lib/i18n/use-locale.ts`), so there is nothing
 * to duplicate and nothing to keep in sync. This file exists to give the English
 * URL a real page and an English `<title>`.
 *
 * ## 为什么是「包一层」而不是 `export { default } from "…"`
 *
 * 试过重新导出，两个东西同时拒绝：
 *   1. `scripts/static-contract-check.mjs` 报 `page.tsx has no default export`
 *      （守卫是对的）；
 *   2. Next 自己也不认这个路由 —— `/en/login` 直接 **404**，构建日志里却有这条路由。
 * 所以必须有一个**自己的**默认导出函数，哪怕它只干一件事：渲染那个共享页面。
 *
 * ## `metadata` 为什么在这里而不在页面里
 *
 * 页面是客户端组件（`"use client"`），Next 不允许它导出 `metadata`。这个文件是
 * 服务端组件，可以。
 */
export const metadata: Metadata = {
  title: t("en", "auth.login"),
  description: t("en", "welcome.description"),
  alternates: {
    canonical: "/en/login",
    languages: { zh: "/login", en: "/en/login" },
  },
};

export default function LoginPageEn() {
  return <LoginPage />;
}
