import type { MetadataRoute } from "next";
import { listActivities } from "@/lib/server/activities";
import { hasDatabase } from "@/db";

/**
 * sitemap.xml：静态页 + 所有**公开已发布**的活动详情页。
 * 用 listActivities(null) 取 —— 传 null 表示匿名访客，服务端会按公开口径过滤
 * （unlisted 与待审核的活动不会进 sitemap，避免把未公开内容暴露给抓取）。
 */
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://hangkathon.com").replace(/\/$/, "");
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/activities`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/leaderboard`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
  ];

  if (!hasDatabase()) return staticRoutes;

  try {
    const activities = await listActivities(null);
    const nowIso = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    return [
      ...staticRoutes,
      ...activities.map((activity) => ({
        url: `${base}/activities/${encodeURIComponent(activity.slug)}`,
        lastModified: nowIso,
        changeFrequency: "weekly" as const,
        priority: activity.seeded ? 0.8 : 0.7,
      })),
    ];
  } catch (error) {
    console.error("[sitemap] 活动列表读取失败，退回静态页", error);
    return staticRoutes;
  }
}