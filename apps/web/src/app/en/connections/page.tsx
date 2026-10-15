import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import ConnectionsPage from "../../connections/page";

export const metadata: Metadata = {
  title: t("en", "connections.title"),
  description: t("en", "connections.subtitle"),
  alternates: {
    canonical: "/en/connections",
    languages: { zh: "/connections", en: "/en/connections" },
  },
};

export default function ConnectionsPageEn() {
  return <ConnectionsPage />;
}
