import type { Metadata } from "next";

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
    default: "TalkFirst — talk first, become friends later",
    template: "%s · TalkFirst",
  },
  description:
    "TalkFirst is a language-exchange and cross-cultural social app: get along with a stranger first, then decide whether to become friends. Talk First. Connect Later.",
  applicationName: "TalkFirst",
  openGraph: {
    title: "TalkFirst — talk first, become friends later",
    description: "Start with a hello. If you click, then decide whether to connect.",
    siteName: "TalkFirst",
  },
};

export default function EnLayout({ children }: { children: React.ReactNode }) {
  return children;
}
