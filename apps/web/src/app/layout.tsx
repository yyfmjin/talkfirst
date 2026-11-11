import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SessionProvider } from "@/lib/session";
import { TFToastProvider } from "@/components/tf";
import { t } from "@/lib/i18n";

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
    default: t("zh", "meta.title"),
    template: "%s · TalkFirst",
  },
  description:
    t("zh", "meta.description"),
  applicationName: "TalkFirst",
  openGraph: {
    title: t("zh", "meta.title"),
    description: t("zh", "meta.ogDescription"),
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
  /* 手机浏览器地址栏的颜色：深色模式跟随系统，两套都要给。 */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F9FC" },
    { media: "(prefers-color-scheme: dark)", color: "#0A1017" },
  ],
  colorScheme: "light dark",
};

/**
 * `"https://api.example.com/api/v1"` → `"https://api.example.com"`。
 *
 * 取不出来（未配置、写错）就返回 `null`，不猜：预热一个不存在的域名只是白开一条连接。
 */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  /**
   * 预热到 API 与 WebSocket 的连接（2026-11-11，针对国内访问慢）。
   *
   * 这两个域名跟页面不同源，所以首次请求要额外付一次 DNS + TLS。实测（国内线）
   * 一次 TLS 握手 1.3–2.3s，而 `GET /users/me` 又在 JS 水合之后才发出 —— 用户看到的是
   * 「HTML → JS → 新连接 → 接口」四段串起来。
   *
   * `preconnect` 让浏览器在解析头部时就把握手做掉，与下载 HTML/JS 重叠。
   * 这里写两种 credentials 模式（带 / 不带 `crossorigin`）：浏览器按
   * (origin, credentials mode) 分开维护连接，而本项目用
   * `fetch(..., { credentials: "include" })` 调接口，与普通导航不是同一条。
   *
   * `dns-prefetch` 兜底：preconnect 被丢弃时，至少 DNS 已经缓存住。
   */
  const apiOrigin = originOf(process.env.NEXT_PUBLIC_API_BASE_URL);
  const socketOrigin = originOf(process.env.NEXT_PUBLIC_SOCKET_BASE_URL);

  return (
    <html lang="zh-CN">
      <head>
        {apiOrigin ? (
          <>
            <link rel="dns-prefetch" href={apiOrigin} />
            <link rel="preconnect" href={apiOrigin} crossOrigin="anonymous" />
            <link rel="preconnect" href={apiOrigin} />
          </>
        ) : null}
        {socketOrigin && socketOrigin !== apiOrigin ? (
          <>
            <link rel="dns-prefetch" href={socketOrigin} />
            <link rel="preconnect" href={socketOrigin} />
          </>
        ) : null}
      </head>
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
