import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import PurposesPage from "../../../onboarding/purposes/page";

export const metadata: Metadata = {
  title: t("en", "onboarding.purposes.title"),
  description: t("en", "onboarding.purposes.question"),
  alternates: {
    canonical: "/en/onboarding/purposes",
    languages: { zh: "/onboarding/purposes", en: "/en/onboarding/purposes" },
  },
};

export default function PurposesPageEn() {
  return <PurposesPage />;
}
