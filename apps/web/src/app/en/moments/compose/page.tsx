import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import ComposePage from "../../../moments/compose/page";

export const metadata: Metadata = {
  title: t("en", "cm.title"),
  alternates: {
    canonical: "/en/moments/compose",
    languages: { zh: "/moments/compose", en: "/en/moments/compose" },
  },
};

export default function MomentsComposePageEn() {
  return <ComposePage />;
}
