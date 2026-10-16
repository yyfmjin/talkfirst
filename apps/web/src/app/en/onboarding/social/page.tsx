import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import SocialPage from "../../../onboarding/social/page";

export const metadata: Metadata = {
  title: t("en", "onboarding.social.title"),
  description: t("en", "onboarding.social.intro"),
  alternates: {
    canonical: "/en/onboarding/social",
    languages: { zh: "/onboarding/social", en: "/en/onboarding/social" },
  },
};

export default function SocialPageEn() {
  return <SocialPage />;
}
