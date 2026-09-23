import type { Metadata } from "next";
import "./globals.css";
import "./motion.css";
import { MOTION_BOOT } from "./motion";
export const metadata: Metadata = {
  title: "杭客松 · 世界 AI 上杭州",
  description: "连接 AI 创造者、真实需求与城市活动。",
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        {/* 在应用 JS 之前决定要不要隐藏 [data-reveal] 的初态，避免入场动画先闪一下内容。 */}
        <script dangerouslySetInnerHTML={{ __html: MOTION_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
