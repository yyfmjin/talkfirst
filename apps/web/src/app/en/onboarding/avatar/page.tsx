import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import AvatarPage from "../../../onboarding/avatar/page";

export const metadata: Metadata = {
  title: t("en", "onboarding.avatar.title"),
  description: t("en", "onboarding.avatar.hint"),
  alternates: {
    canonical: "/en/onboarding/avatar",
    languages: { zh: "/onboarding/avatar", en: "/en/onboarding/avatar" },
  },
};

export default function AvatarPageEn() {
  return <AvatarPage />;
}
