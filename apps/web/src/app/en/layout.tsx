import type { Metadata } from "next";
import { t } from "@/lib/i18n";

/**
 * English metadata for `/en/*`.
 *
 * The root layout carries the Chinese title/description, and without this file
 * every `/en` page inherited it — an English reader got a Chinese browser tab
 * and Chinese text in a shared link preview. There is no pathname in
 * `metadata`, so the honest fix is one layout per language rather than trying to
 * guess the locale from headers.
 *
 * Keep the two in sync: same product promise, two voices (see `docs/brand.md`).
 */
export const metadata: Metadata = {
  title: {
    default: t("en", "meta.title"),
    template: "%s · TalkFirst",
  },
  description:
    t("en", "meta.description"),
  applicationName: "TalkFirst",
  openGraph: {
    title: t("en", "meta.title"),
    description: t("en", "meta.ogDescription"),
    siteName: "TalkFirst",
  },
};

export default function EnLayout({ children }: { children: React.ReactNode }) {
  return children;
}
