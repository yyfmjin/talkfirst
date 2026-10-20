import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import AttributesPage from "../../../me/attributes/page";

export const metadata: Metadata = {
  title: t("en", "at.title"),
  alternates: {
    canonical: "/en/me/attributes",
    languages: { zh: "/me/attributes", en: "/en/me/attributes" },
  },
};

export default function MeAttributesPageEn() {
  return <AttributesPage />;
}
