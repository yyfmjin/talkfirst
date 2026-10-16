import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import CompletePage from "../../../onboarding/complete/page";

export const metadata: Metadata = {
  title: t("en", "onboarding.complete.title"),
  description: t("en", "onboarding.complete.subtitle"),
  alternates: {
    canonical: "/en/onboarding/complete",
    languages: { zh: "/onboarding/complete", en: "/en/onboarding/complete" },
  },
};

export default function CompletePageEn() {
  return <CompletePage />;
}
