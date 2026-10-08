import type { Metadata } from "next";
import { HtmlLang } from "@/components/html-lang";
import { OfficialSite } from "@/marketing/official-site";
import { localePath, t } from "@/lib/i18n";

/**
 * English home page (`/en`) — the same official-site component as the Chinese
 * route, with `locale="en"`.
 *
 * `<HtmlLang>` is here rather than inside the shared component because only the
 * non-default locale needs it (the root layout hard-codes `lang="zh-CN"`; see that
 * component for why it is a client-side patch rather than route groups).
 *
 * `openGraph` is written out because the root layout's is Chinese and a page's
 * `title`/`description` do not override it — without this, sharing the English
 * homepage renders a Chinese card.
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
  openGraph: {
    title: t("en", "welcome.title"),
    description: t("en", "welcome.description"),
    locale: "en_US",
    siteName: "TalkFirst",
    type: "website",
  },
};

export default function HomePageEn() {
  return (
    <>
      <HtmlLang locale="en" />
      <OfficialSite locale="en" />
    </>
  );
}
