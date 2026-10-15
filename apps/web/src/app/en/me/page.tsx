import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import MePage from "../../me/page";

export const metadata: Metadata = {
  title: t("en", "me.myCard"),
  description: t("en", "me.myCard"),
  alternates: {
    canonical: "/en/me",
    languages: { zh: "/me", en: "/en/me" },
  },
};

export default function MePageEn() {
  return <MePage />;
}
