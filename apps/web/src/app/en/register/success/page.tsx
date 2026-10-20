import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import { RegisterSuccessView } from "@/components/register-success";

export const metadata: Metadata = {
  title: t("en", "rs.title"),
  alternates: {
    canonical: "/en/register/success",
    languages: { zh: "/register/success", en: "/en/register/success" },
  },
};

export default function RegisterSuccessPageEn() {
  return <RegisterSuccessView locale="en" />;
}
