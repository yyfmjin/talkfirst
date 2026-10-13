import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import PrivacyPolicyPage from "../../../legal/privacy/page";

/**
 * Privacy Policy (English, `/en/legal/privacy`).
 *
 * A faithful translation of the Chinese original, not a second document: the
 * page carries `legal.translationNote`, and the Chinese text governs. That URL
 * also has a second job — Google's OAuth consent screen requires a publicly
 * reachable privacy-policy URL, and this is the English one.
 */
export const metadata: Metadata = {
  title: t("en", "legal.privacy.title"),
  description: t("en", "legal.privacy.intro"),
  alternates: {
    canonical: "/en/legal/privacy",
    languages: { zh: "/legal/privacy", en: "/en/legal/privacy" },
  },
};

export default function PrivacyPolicyPageEn() {
  return <PrivacyPolicyPage />;
}
