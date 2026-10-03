import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionProvider } from "@/lib/session";
import { TFToastProvider } from "@/components/tf";

/**
 * Global metadata.
 *
 * The title now carries a template, so a route that sets its own title gets
 * 「<页面> · TalkFirst」 instead of replacing the brand entirely. A canonical base
 * is declared because several pages are reachable by more than one path
 * (`/moments/user/[id]` vs `/profile/[id]`) and without it a crawler would treat
 * them as unrelated documents.
 */
export const metadata: Metadata = {
  title: {
    default: "TalkFirst 先聊 — 先聊聊，再成为朋友",
    template: "%s · TalkFirst",
  },
  description:
    "TalkFirst 是一个语言交换与跨文化社交应用：先和陌生人聊得来，再决定要不要成为朋友。Talk First. Connect Later.",
  applicationName: "TalkFirst",
  openGraph: {
    title: "TalkFirst 先聊 — 先聊聊，再成为朋友",
    description: "从一句「你好」开始，聊得来，再决定要不要认识。",
    siteName: "TalkFirst",
    locale: "zh_CN",
    type: "website",
  },
};

/**
 * `viewportFit: "cover"` is what makes `env(safe-area-inset-bottom)` resolve to
 * anything on a notched device. The tab bar, the composer's sticky CTA and the
 * toast all depend on that inset, so without this they sit under the home
 * indicator.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F7F9FC",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      {/*
        `bg-surface-canvas` is the page canvas token. The toast provider is mounted
        here, above every page, because a confirmation must survive a route change
        — 「已发布」 appears as the composer navigates away, and a provider inside
        the page would be unmounted by that very navigation.
      */}
      <body className="min-h-screen bg-surface-canvas text-content antialiased">
        <SessionProvider>
          <TFToastProvider>{children}</TFToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
