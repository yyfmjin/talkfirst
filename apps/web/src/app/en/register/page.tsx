import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import RegisterPage from "../../register/page";

/**
 * Create an account (English, `/en/register`).
 *
 * Same arrangement as `/en/login`: the Chinese route's module IS the page, and it
 * figures out its language from the pathname. This file wraps it so the English
 * URL has a page with its own default export (a re-export 404s — see the note in
 * `/en/login/page.tsx`) and an English `<title>`.
 */
export const metadata: Metadata = {
  title: t("en", "auth.register"),
  description: t("en", "auth.registerSubtitle"),
  alternates: {
    canonical: "/en/register",
    languages: { zh: "/register", en: "/en/register" },
  },
};

export default function RegisterPageEn() {
  return <RegisterPage />;
}
