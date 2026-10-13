import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import ResetPasswordPage from "../../reset/page";

/**
 * Reset password (English, `/en/reset`).
 *
 * The page itself is the SAME module as the Chinese route — it reads the locale
 * from the pathname (`useT()`, see `lib/i18n/use-locale.ts`), so there is
 * nothing to duplicate and nothing to keep in sync. This file exists to give the
 * English URL a real page and an English `<title>`.
 *
 * Why this is a wrapper and not `export { default } from "…"`: see the longer
 * note in `app/en/login/page.tsx` — a re-export 404s and fails the static
 * contract check.
 *
 * `metadata` lives here rather than in the page because the page is a client
 * component (`"use client"`), and Next does not let those export metadata.
 */
export const metadata: Metadata = {
  title: t("en", "reset.title"),
  description: t("en", "reset.subtitle"),
  alternates: {
    canonical: "/en/reset",
    languages: { zh: "/reset", en: "/en/reset" },
  },
};

export default function ResetPasswordPageEn() {
  return <ResetPasswordPage />;
}
