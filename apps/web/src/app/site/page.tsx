import type { Metadata } from "next";
import { OfficialSite } from "@/marketing/official-site";
import { localePath, t } from "@/lib/i18n";

/**
 * 官网（中文，`/site`）。
 *
 * 这一层只做三件事：声明中文的 metadata、把 `locale` 交给共享组件、给出两种语言的
 * canonical。页面本体在 `src/marketing/official-site.tsx` —— 中英文是同一份实现，
 * 差别只有文案与几个链接指向哪里。
 *
 * 英文版在 `app/en/site/page.tsx`（同一个组件，`locale="en"`）。
 */
export const metadata: Metadata = {
  title: t("zh", "site.metaTitle"),
  description: t("zh", "site.metaDescription"),
  alternates: {
    canonical: localePath("zh", "/site"),
    languages: {
      zh: localePath("zh", "/site"),
      en: localePath("en", "/site"),
    },
  },
};

export default function OfficialSitePage() {
  return <OfficialSite locale="zh" />;
}
