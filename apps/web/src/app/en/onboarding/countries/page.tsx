import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import CountriesPage from "../../../onboarding/countries/page";

export const metadata: Metadata = {
  title: t("en", "onboarding.countries.title"),
  description: t("en", "onboarding.countries.subtitle", { extra: "" }),
  alternates: {
    canonical: "/en/onboarding/countries",
    languages: { zh: "/onboarding/countries", en: "/en/onboarding/countries" },
  },
};

export default function CountriesPageEn() {
  return <CountriesPage />;
}
