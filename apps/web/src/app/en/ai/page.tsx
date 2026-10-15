import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import AiPage from "../../ai/page";

export const metadata: Metadata = {
  title: t("en", "ai.title"),
  description: t("en", "ai.setupSubtitle"),
  alternates: {
    canonical: "/en/ai",
    languages: { zh: "/ai", en: "/en/ai" },
  },
};

export default function AiPageEn() {
  return <AiPage />;
}
