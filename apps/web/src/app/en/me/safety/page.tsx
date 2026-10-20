import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import SafetyPage from "../../../me/safety/page";

export const metadata: Metadata = {
  title: t("en", "sf.title"),
  alternates: {
    canonical: "/en/me/safety",
    languages: { zh: "/me/safety", en: "/en/me/safety" },
  },
};

export default function MeSafetyPageEn() {
  return <SafetyPage />;
}
