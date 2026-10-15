import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import MomentsPage from "../../moments/page";

export const metadata: Metadata = {
  title: t("en", "moments.title"),
  description: t("en", "moments.subtitle"),
  alternates: {
    canonical: "/en/moments",
    languages: { zh: "/moments", en: "/en/moments" },
  },
};

export default function MomentsPageEn() {
  return <MomentsPage />;
}
