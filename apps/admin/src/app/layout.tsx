import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TalkFirst 管理后台",
  description: "TalkFirst 独立内容审核与运营控制台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
