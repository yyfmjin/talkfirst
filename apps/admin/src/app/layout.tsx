import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TalkFirst Admin",
  description: "TalkFirst standalone moderation console",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
