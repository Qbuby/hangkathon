import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "杭客松 · 在杭州，把 AI 想法做出来。",
  description: "连接 AI 创造者、企业真实需求和黑客松活动。杭客松可交互 3D 首页演示。",
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
