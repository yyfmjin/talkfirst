import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import BasicInfoPage from "../../../onboarding/profile/page";

export const metadata: Metadata = {
  title: t("en", "onboarding.profile.title"),
  description: t("en", "onboarding.profile.nicknamePlaceholder"),
  alternates: {
    canonical: "/en/onboarding/profile",
    languages: { zh: "/onboarding/profile", en: "/en/onboarding/profile" },
  },
};

export default function BasicInfoPageEn() {
  return <BasicInfoPage />;
}
