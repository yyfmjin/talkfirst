import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import LanguagesPage from "../../../onboarding/languages/page";

export const metadata: Metadata = {
  title: t("en", "onboarding.languages.title"),
  description: t("en", "onboarding.languages.intro"),
  alternates: {
    canonical: "/en/onboarding/languages",
    languages: { zh: "/onboarding/languages", en: "/en/onboarding/languages" },
  },
};

export default function LanguagesPageEn() {
  return <LanguagesPage />;
}
