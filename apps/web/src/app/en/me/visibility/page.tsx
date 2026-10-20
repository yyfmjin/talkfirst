import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import VisibilityPage from "../../../me/visibility/page";

export const metadata: Metadata = {
  title: t("en", "pv.title"),
  alternates: {
    canonical: "/en/me/visibility",
    languages: { zh: "/me/visibility", en: "/en/me/visibility" },
  },
};

export default function MeVisibilityPageEn() {
  return <VisibilityPage />;
}
