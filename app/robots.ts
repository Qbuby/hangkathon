import type { MetadataRoute } from "next";

/**
 * robots.txt：抓取策略。
 * 管理端口、用户页、创建流程与接口对爬虫没有收录价值，放进 Disallow 一是省抓取预算，
 * 二是避免把后台界面收进索引（安全检查里也强调管理面不应对外可见）。
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hangkathon.com";
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/manage", "/profile", "/create", "/api/", "/auth-error"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}