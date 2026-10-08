import type { Metadata } from "next";
import { LaunchScreen } from "@/welcome/launch-screen";
import { localePath, t } from "@/lib/i18n";

/**
 * 启动屏（中文，`/`）。
 *
 * 页面本体在 `src/welcome/launch-screen.tsx`；这一层只声明中文的 metadata 并把
 * `locale` 交下去。英文版是 `app/en/page.tsx`。
 *
 * `alternates.languages` 是给搜索引擎的：两个地址各自 canonical 到自己，同时互相
 * 声明对方的地址 —— 少了它，英文页会被当成中文页的重复内容。
 */
export const metadata: Metadata = {
  title: t("zh", "welcome.title"),
  description: t("zh", "welcome.description"),
  alternates: {
    canonical: localePath("zh", "/"),
    languages: {
      zh: localePath("zh", "/"),
      en: localePath("en", "/"),
    },
  },
};

export default function WelcomePage() {
  return <LaunchScreen locale="zh" />;
}
