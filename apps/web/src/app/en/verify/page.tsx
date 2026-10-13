import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import VerifyPage from "../../verify/page";

/**
 * E-mail verification code (English, `/en/verify`).
 *
 * Same shared module as the Chinese route (see `app/en/login/page.tsx` for why
 * the English route is a wrapper and not a re-export); this file gives the
 * English URL a real page and an English `<title>`.
 */
export const metadata: Metadata = {
  title: t("en", "verify.title"),
  description: t("en", "verify.metaDescription"),
  alternates: {
    canonical: "/en/verify",
    languages: { zh: "/verify", en: "/en/verify" },
  },
};

export default function VerifyPageEn() {
  return <VerifyPage />;
}
