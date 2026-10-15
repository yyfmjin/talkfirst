import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import NotificationsPage from "../../notifications/page";

export const metadata: Metadata = {
  title: t("en", "notices.title"),
  description: t("en", "notices.title"),
  alternates: {
    canonical: "/en/notifications",
    languages: { zh: "/notifications", en: "/en/notifications" },
  },
};

export default function NotificationsPageEn() {
  return <NotificationsPage />;
}
