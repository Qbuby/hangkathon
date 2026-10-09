import type { Metadata } from "next";
import "./globals.css";
import "./motion.css";
import { MOTION_BOOT } from "./motion";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://hangkathon.com").replace(/\/$/, "");
const SITE_NAME = "杭客松";
const SITE_DESC = "杭客松是一个面向杭州的 AI 活动平台：连接 AI 创造者、真实需求与城市活动，发起活动、报名参赛、提交作品。";

export const metadata: Metadata = {
  // 告诉 Next 所有相对链接（canonical、og:image、sitemap）以哪个域为绝对地址
  metadataBase: new URL(SITE_URL),
  // 子页面只写自己的标题，统一加上品牌后缀；首页给完整的 title
  title: {
    default: `${SITE_NAME} · 世界 AI 上杭州`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESC,
  keywords: ["杭客松", "杭州 AI", "AI 活动", "AI 大赛", "开发者社区", "杭州", "创客", "人工智能"],
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "zh_CN",
    url: "/",
    title: `${SITE_NAME} · 世界 AI 上杭州`,
    description: SITE_DESC,
    images: [{ url: "/og-image.jpg", width: 1200, height: 630, alt: "杭客松 · 世界 AI 上杭州" }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} · 世界 AI 上杭州`,
    description: SITE_DESC,
    images: ["/og-image.jpg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  formatDetection: { telephone: false },
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
      <body>
        {children}
        {/* ICP 备案（法规要求全站可见，链接到工信部备案系统） */}
        <footer className="icp-footer">
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer nofollow">
            浙ICP备2026082561号
          </a>
        </footer>
      </body>
    </html>
  );
}