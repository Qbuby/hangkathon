import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import "./motion.css";
import { MOTION_BOOT } from "./motion";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://hangkathon.com").replace(/\/$/, "");
const SITE_NAME = "杭客松";
// 标题与描述是百度搜索结果卡片上唯一完全由我们控制的两行字：标题塞进真实搜索词
// （地域 + 品类），描述写成"平台是什么 + 能做什么"，末尾带行动号召。百度标题展示约 30 字。
const SITE_TITLE = "杭客松 - 杭州AI活动与赛事平台 · 世界 AI 上杭州";
const SITE_DESC =
  "杭客松是杭州的 AI 活动与赛事平台：在这里发布 AI 大赛、开发者活动与训练营，支持在线报名、作品提交与荣誉榜。发现杭州正在进行的 AI 活动，登录即可参与。";

export const metadata: Metadata = {
  // 告诉 Next 所有相对链接（canonical、og:image、sitemap）以哪个域为绝对地址
  metadataBase: new URL(SITE_URL),
  // 子页面只写自己的标题，统一加上品牌后缀；首页给完整的 title
  title: {
    default: SITE_TITLE,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESC,
  keywords: ["杭客松", "杭州 AI 活动", "AI 大赛", "杭州 AI 赛事", "开发者活动", "杭州", "人工智能", "创客", "AI 训练营"],
  applicationName: SITE_NAME,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "zh_CN",
    url: "/",
    title: SITE_TITLE,
    description: SITE_DESC,
    images: [{ url: "/og-image.jpg", width: 1200, height: 630, alt: "杭客松 · 世界 AI 上杭州" }],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
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
        {/*
          备案信息（法规要求全站可见）。顺序由公安部门要求：**公安备案在最左，且必须带统一的公安标志**，
          ICP 备案紧随其后。图标用官方 ghs.png（/beian.png），尺寸由 CSS 控制、不随头像缩放。
        */}
        <footer className="icp-footer">
          <a
            className="icp-footer-link icp-footer-beian"
            href="https://beian.mps.gov.cn/#/query/webSearch?code=33010502013637"
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            {/* 官方图标是外部内容，用原生 img 而不是 next/image：不参与优化管线、原样输出 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="icp-footer-badge" src="/beian.png" alt="公安备案" width={20} height={20} />
            浙公网安备33010502013637号
          </a>
          <a
            className="icp-footer-link"
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            浙ICP备2026082561号
          </a>
          <Link className="icp-footer-link" href="/about">关于杭客松</Link>
        </footer>
      </body>
    </html>
  );
}