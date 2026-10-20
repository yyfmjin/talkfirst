import type { Metadata } from "next";
import { t } from "@/lib/i18n";
import FeedbackPage from "../../../me/feedback/page";

export const metadata: Metadata = {
  title: t("en", "fb.title"),
  alternates: {
    canonical: "/en/me/feedback",
    languages: { zh: "/me/feedback", en: "/en/me/feedback" },
  },
};

export default function MeFeedbackPageEn() {
  return <FeedbackPage />;
}
