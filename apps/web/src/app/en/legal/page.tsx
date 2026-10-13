import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import LegalPage from "../../legal/page";

/**
 * Consent gate (English, `/en/legal`).
 *
 * Same shared module as the Chinese route; this file gives the English URL a
 * real page and an English `<title>`. See `app/en/login/page.tsx` for why the
 * English route is a wrapper and not a re-export.
 */
export const metadata: Metadata = {
  title: t("en", "legal.gate.title"),
  description: t("en", "legal.gate.intro"),
  alternates: {
    canonical: "/en/legal",
    languages: { zh: "/legal", en: "/en/legal" },
  },
};

export default function LegalPageEn() {
  return <LegalPage />;
}
