import type { MetadataRoute } from "next";
import { listActivities } from "@/lib/server/activities";
import { hasDatabase } from "@/db";
import { isoDate } from "@/lib/seo/jsonld";

/**
 * sitemap.xml：静态页 + 所有**公开已发布**的活动详情页。
 * 用 listActivities(null) 取 —— 传 null 表示匿名访客，服务端会按公开口径过滤
 * （unlisted 与待审核的活动不会进 sitemap，避免把未公开内容暴露给抓取）。
 *
 * 两条对照 sitemap 规范的修正：
 *
 *  1. **去掉 priority 与 changefreq**。Google 明确说两者都被忽略；
 *     它们还会占体积、并给人"设置过优先级"的错觉（实际没有）。
 *
 *  2. **lastmod 用真实性**。原先所有静态页都写 `now`、所有活动页都写"24 小时前"——
 *     每次请求都变。Google 只在 lastmod 一贯准确时才采信它，一直撒谎等于没有。
 *     现在：活动页用库里的 createdAt（真实入库时间）；静态页用构建/发布期固定的
 *     时间戳（由模块加载时取一次，而不是每次请求取 now）。
 *
 * 三条 Sitemap 协议红线（任一超标都会被判不可用）：
 *   单个文件 ≤ 50,000 条 URL、≤ 50MB 未压缩；只放 canonical、可索引、非重定向的 URL。
 *   本站活动量远小于上限，但仍显式截断并留日志，避免将来批量导入时静默越界。
 */
export const dynamic = "force-dynamic";

/** 协议上限，留出余量：50,000 条上限按 45,000 截断。 */
const MAX_URLS = 45_000;

/** 模块加载时取一次：同一次构建/进程内保持稳定，不会每次请求都变（lastmod 说谎的根源）。 */
const BUILD_STAMP = new Date().toISOString();

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://hangkathon.com").replace(/\/$/, "");

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: BUILD_STAMP },
    { url: `${base}/activities`, lastModified: BUILD_STAMP },
    { url: `${base}/leaderboard`, lastModified: BUILD_STAMP },
    { url: `${base}/about`, lastModified: BUILD_STAMP },
  ];

  if (!hasDatabase()) return staticRoutes;

  try {
    const activities = await listActivities(null);
    const dynamicRoutes: MetadataRoute.Sitemap = activities
      // 与页面上"能访问到"的口径完全一致：公开且非待审核
      .filter((activity) => activity.visibility === "public" && activity.reviewStatus !== "pending")
      .slice(0, MAX_URLS - staticRoutes.length)
      .map((activity) => ({
        url: `${base}/activities/${encodeURIComponent(activity.slug)}`,
        // 真实入库时间；解析不出来就退回构建戳（不给假日期）
        lastModified: isoDate(activity.createdAt) ?? BUILD_STAMP,
      }));

    if (activities.length + staticRoutes.length > MAX_URLS) {
      console.warn(
        `[sitemap] 活动数（${activities.length}）超出单文件上限，已截断到 ${MAX_URLS} 条 —— 需要改造成 sitemapindex`,
      );
    }

    return [...staticRoutes, ...dynamicRoutes];
  } catch (error) {
    console.error("[sitemap] 活动列表读取失败，退回静态页", error);
    return staticRoutes;
  }
}
