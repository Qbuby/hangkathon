import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PUBLISHED_ACTIVITIES } from "@/lib/published-activities";
import { factionById } from "@/lib/factions";
import type { Activity } from "@/lib/activity";
import { hasDatabase } from "@/db";
import ActivityDetail from "./activity-detail";

/**
 * 活动详情页是本站最重要的收录面，所以它是服务端组件：
 * 首屏 HTML 里直接带完整正文（标题、简介、时间、主办方、联系方式），不依赖浏览器再取一次数据。
 * 预置活动走 generateStaticParams 静态化；用户发起的活动在请求时从库里取，
 * 走 getActivityBySlug(slug, null) —— 传 null 表示匿名访客，不公开与待审核的活动照样取不到，
 * 不会被爬虫抓到未公开内容。
 */

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://hangkathon.com").replace(/\/$/, "");

export function generateStaticParams() {
  return PUBLISHED_ACTIVITIES.map((item) => ({ slug: item.slug }));
}

/** 预置活动优先（无需数据库），否则按公开口径读库。 */
async function loadPublicActivity(slug: string): Promise<Activity | null> {
  const seeded = PUBLISHED_ACTIVITIES.find((item) => item.slug === slug);
  if (seeded) return seeded;
  if (!hasDatabase()) return null;
  try {
    const { getActivityBySlug } = await import("@/lib/server/activities");
    return await getActivityBySlug(slug, null);
  } catch (error) {
    console.error("[seo] 活动详情读取失败", slug, error);
    return null;
  }
}

/** 简介不足时用固定文案补齐，保证每页 description 长度适中且含关键词。 */
function buildDescription(activity: Activity): string {
  const district = factionById(activity.district)?.name;
  const parts = [
    activity.overview?.trim(),
    [district, activity.format === "online" ? "线上" : activity.venue || "线下"].filter(Boolean).join(" · "),
  ].filter(Boolean);
  const text = parts.join(" ").replace(/\s+/g, " ");
  const clipped = text.length > 150 ? `${text.slice(0, 150)}…` : text;
  return clipped || `${activity.title} · 杭客松 AI 活动平台`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const activity = await loadPublicActivity(slug);
  const url = `/activities/${encodeURIComponent(slug)}`;
  if (!activity) {
    return {
      title: "活动详情 · 杭客松",
      robots: { index: false, follow: true },
      alternates: { canonical: url },
    };
  }
  const description = buildDescription(activity);
  const image = activity.image ?? "/og-image.jpg";
  return {
    title: `${activity.title}${activity.subtitle ? ` · ${activity.subtitle}` : ""}`,
    description,
    alternates: { canonical: url },
    keywords: [
      activity.title,
      activity.host,
      "杭州 AI 活动",
      factionById(activity.district)?.name ?? "杭州",
      "杭客松",
    ],
    openGraph: {
      type: "article",
      locale: "zh_CN",
      url,
      title: activity.title,
      description,
      images: [{ url: image, alt: activity.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: activity.title,
      description,
      images: [image],
    },
  };
}

/** schema.org Event：让搜索引擎与 AI 摘要把活动卡片直接读成结构化数据。 */
function eventJsonLd(activity: Activity) {
  const district = factionById(activity.district)?.name;
  const online = activity.format === "online";
  const slugUrl = `${SITE_URL}/activities/${encodeURIComponent(activity.slug)}`;
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: activity.title,
    description: buildDescription(activity),
    url: slugUrl,
    image: `${SITE_URL}${activity.image ?? "/og-image.jpg"}`,
    startDate: activity.startsAt || undefined,
    endDate: activity.endsAt || undefined,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: online
      ? "https://schema.org/OnlineEventAttendanceMode"
      : "https://schema.org/OfflineEventAttendanceMode",
    location: online
      ? { "@type": "VirtualLocation", url: slugUrl }
      : {
          "@type": "Place",
          name: activity.venue || district || "杭州",
          address: {
            "@type": "PostalAddress",
            addressLocality: "杭州市",
            addressRegion: "浙江",
            addressCountry: "CN",
          },
        },
    organizer: { "@type": "Organization", name: activity.host || "杭客松", url: SITE_URL },
    offers: {
      "@type": "Offer",
      price: activity.pricing === "free" ? 0 : Number(activity.fee) || 0,
      priceCurrency: "CNY",
      availability: "https://schema.org/InStock",
      url: slugUrl,
    },
  };
}

export default async function ActivityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const initial = await loadPublicActivity(slug);
  /**
   * 有数据库时，服务端查不到就是真的没有这场活动 —— 必须回 404。
   * 否则任何路径（包括 `/activities/..%2f..%2fpackage.json` 这种穿越尝试）都会拿到
   * HTTP 200 + 一个"没有找到这场活动"的页面：状态码撒谎，爬虫会把无限多的垃圾 URL
   * 当成有效页面收录。无数据库的部署不能这么判 —— 用户自建活动只存在浏览器里，
   * 服务端查不到是正常的，那由客户端接管。
   */
  if (!initial && hasDatabase()) notFound();
  return (
    <>
      {initial ? (
        <script
          type="application/ld+json"
          // 内容是自家库里的活动字段，经 JSON.stringify 转义后嵌入
          dangerouslySetInnerHTML={{ __html: JSON.stringify(eventJsonLd(initial)) }}
        />
      ) : null}
      <ActivityDetail slug={slug} initial={initial} />
    </>
  );
}