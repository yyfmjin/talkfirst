import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import InterestsPage from "../../../onboarding/interests/page";

export const metadata: Metadata = {
  title: t("en", "onboarding.interests.title"),
  description: t("en", "onboarding.interests.subtitle", { count: 0 }),
  alternates: {
    canonical: "/en/onboarding/interests",
    languages: { zh: "/onboarding/interests", en: "/en/onboarding/interests" },
  },
};

export default function InterestsPageEn() {
  return <InterestsPage />;
}
