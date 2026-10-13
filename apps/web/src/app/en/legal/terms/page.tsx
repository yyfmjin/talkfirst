import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import TermsPage from "../../../legal/terms/page";

/**
 * Terms of Use (English, `/en/legal/terms`).
 *
 * A faithful translation of the Chinese original, not a second document: the
 * page carries `legal.translationNote`, and the Chinese text governs. See
 * `app/legal/terms/page.tsx` for why the translation is not independent.
 */
export const metadata: Metadata = {
  title: t("en", "legal.terms.title"),
  description: t("en", "legal.terms.intro"),
  alternates: {
    canonical: "/en/legal/terms",
    languages: { zh: "/legal/terms", en: "/en/legal/terms" },
  },
};

export default function TermsPageEn() {
  return <TermsPage />;
}
