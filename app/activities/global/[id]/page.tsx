import type { Metadata } from "next";
import { hasDatabase } from "@/db";
import { getExternalEventById } from "@/lib/server/external-events";
import GlobalEventDetail from "./global-event-detail";

/**
 * 全球赛事（外部平台抓取内容）的详情页。
 *
 * 这些页面的正文来自 Topcoder / MLH / Kaggle 等第三方平台，中文标题还是机翻的。所以：
 *   1. robots: noindex, follow —— **不收录、不与原站抢排名**，但把链接权重传递给原站。
 *      用户照常能在本站浏览这些赛事（每日聚合 + 中文化 + 按时间与类别筛选是我们的价值），
 *      只是这些页面不占搜索结果。
 *      刻意**不**在 robots.txt 里 Disallow 这条路径：被禁止抓取的页面爬虫拿不到 noindex，
 *      反而可能以「仅限此 URL 使用 robots.txt」的裸链形式出现在结果里。
 *   2. 标题带上赛事名 —— 即便不收录，分享出去的标题也能看懂，不再是全站同一个「详情」。
 */
export const dynamic = "force-dynamic";

async function loadEvent(id: string) {
  if (!hasDatabase()) return null;
  try {
    return await getExternalEventById(id);
  } catch (error) {
    console.error("[seo] 外部赛事读取失败", id, error);
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const event = await loadEvent(id);
  const name = event ? event.titleZh || event.title : "全球赛事";
  return {
    title: `${name} · 全球赛事`,
    description: event
      ? `${event.titleZh || event.title}，来自 ${event.source} 的全球竞赛信息，报名时间与赛程以主办方官网为准。`
      : "来自全球竞赛平台的赛事信息，报名时间与赛程以主办方官网为准。",
    // 不收录第三方内容，但跟随页面上的官网链接，把权重传给原站
    robots: { index: false, follow: true },
  };
}

export default async function GlobalEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GlobalEventDetail id={id} />;
}