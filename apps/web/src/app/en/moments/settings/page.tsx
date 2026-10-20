import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import MomentsSettingsPage from "../../../moments/settings/page";

export const metadata: Metadata = {
  title: t("en", "ms.title"),
  alternates: {
    canonical: "/en/moments/settings",
    languages: { zh: "/moments/settings", en: "/en/moments/settings" },
  },
};

export default function MomentsSettingsPageEn() {
  return <MomentsSettingsPage />;
}
