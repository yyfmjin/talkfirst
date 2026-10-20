import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import SocialPage from "../../../me/social/page";

export const metadata: Metadata = {
  title: t("en", "me.social"),
  alternates: {
    canonical: "/en/me/social",
    languages: { zh: "/me/social", en: "/en/me/social" },
  },
};

export default function MeSocialPageEn() {
  return <SocialPage />;
}
