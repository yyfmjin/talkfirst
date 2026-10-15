import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import DiscoverPage from "../../discover/page";

export const metadata: Metadata = {
  title: t("en", "discover.title"),
  description: t("en", "discover.subtitle"),
  alternates: {
    canonical: "/en/discover",
    languages: { zh: "/discover", en: "/en/discover" },
  },
};

export default function DiscoverPageEn() {
  return <DiscoverPage />;
}
