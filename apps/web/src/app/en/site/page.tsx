import type { Metadata } from "next";
import { HtmlLang } from "@/components/html-lang";
import { OfficialSite } from "@/marketing/official-site";
import { localePath, t } from "@/lib/i18n";

/**
 * Official site (English, `/en/site`).
 *
 * The body is the same component the Chinese route renders — `locale="en"` is what
 * changes the copy and the internal links. Two files this small are the price of not
 * moving all 35 routes under `app/[locale]/` (see `src/lib/i18n/locales.ts` for why
 * that trade was made). `<HtmlLang>` is here rather than inside the shared component
 * because only the non-default locale needs it.
 */
export const metadata: Metadata = {
  title: t("en", "site.metaTitle"),
  description: t("en", "site.metaDescription"),
  alternates: {
    canonical: localePath("en", "/site"),
    languages: {
      zh: localePath("zh", "/site"),
      en: localePath("en", "/site"),
    },
  },
  // 与 `/en` 同一理由：页面只改 title/description 盖不住根布局里那份中文的 openGraph。
  openGraph: {
    title: t("en", "site.metaTitle"),
    description: t("en", "site.metaDescription"),
    locale: "en_US",
    siteName: "TalkFirst",
    type: "website",
  },
};

export default function OfficialSitePageEn() {
  return (
    <>
      {/* 根布局写死 `lang="zh-CN"`，英文页在客户端改成 `en`（取舍见该组件说明）。 */}
      <HtmlLang locale="en" />
      <OfficialSite locale="en" />
    </>
  );
}
