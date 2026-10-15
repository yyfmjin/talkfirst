import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import MessagesPage from "../../messages/page";

export const metadata: Metadata = {
  title: t("en", "messages.title"),
  description: t("en", "messages.subtitle"),
  alternates: {
    canonical: "/en/messages",
    languages: { zh: "/messages", en: "/en/messages" },
  },
};

export default function MessagesPageEn() {
  return <MessagesPage />;
}
