import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import CommunityRulesPage from "../../../legal/rules/page";

/**
 * Community Rules (English, `/en/legal/rules`).
 *
 * A faithful translation of the Chinese original, not a second document: the
 * page carries `legal.translationNote`, and the Chinese text governs.
 */
export const metadata: Metadata = {
  title: t("en", "legal.rules.title"),
  description: t("en", "legal.rules.intro"),
  alternates: {
    canonical: "/en/legal/rules",
    languages: { zh: "/legal/rules", en: "/en/legal/rules" },
  },
};

export default function CommunityRulesPageEn() {
  return <CommunityRulesPage />;
}
