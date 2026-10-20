import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import InterestsPage from "../../../me/interests/page";

export const metadata: Metadata = {
  title: t("en", "it.title"),
  alternates: {
    canonical: "/en/me/interests",
    languages: { zh: "/me/interests", en: "/en/me/interests" },
  },
};

export default function MeInterestsPageEn() {
  return <InterestsPage />;
}
