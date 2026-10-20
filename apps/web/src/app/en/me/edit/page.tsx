import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import EditProfilePage from "../../../me/edit/page";

export const metadata: Metadata = {
  title: t("en", "ed.title"),
  alternates: {
    canonical: "/en/me/edit",
    languages: { zh: "/me/edit", en: "/en/me/edit" },
  },
};

export default function MeEditPageEn() {
  return <EditProfilePage />;
}
