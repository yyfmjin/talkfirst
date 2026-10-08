import type { Metadata } from "next";
import { HtmlLang } from "@/components/html-lang";
import { LaunchScreen } from "@/welcome/launch-screen";
import { localePath, t } from "@/lib/i18n";

/**
 * Launch screen (English, `/en`).
 *
 * Same component as the Chinese route with `locale="en"`. The two buttons currently
 * lead to the Chinese sign-in pages because those have no English version yet —
 * that is spelled out where the links are built, in
 * `src/welcome/launch-screen.tsx`.
 */
export const metadata: Metadata = {
  title: t("en", "welcome.title"),
  description: t("en", "welcome.description"),
  alternates: {
    canonical: localePath("en", "/"),
    languages: {
      zh: localePath("zh", "/"),
      en: localePath("en", "/"),
    },
  },
};

export default function WelcomePageEn() {
  return (
    <>
      {/* 根布局写死 `lang="zh-CN"`，英文页要在客户端把它改成 `en`（见该组件里的取舍说明）。 */}
      <HtmlLang locale="en" />
      <LaunchScreen locale="en" />
    </>
  );
}
