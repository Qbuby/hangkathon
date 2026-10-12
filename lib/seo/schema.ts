/**
 * 站点级与页面级结构化数据（schema.org JSON-LD）的构建器。
 *
 * 依据（对照 claude-seo 的 seo-schema / seo-geo 要求逐条落实）：
 *   - 一律 JSON-LD，`@context` 用 https://schema.org（不是 http）
 *   - URL/图片必须绝对地址；日期用 ISO 8601；不留空属性（compact）
 *   - 实体之间用 @id 互指，把 WebSite / Organization / WebPage / Event 连成一张图，
 *     而不是各页面吐几个互不相干的散块 —— 这是 AI 摘要建立实体对应关系的关键
 *   - Event 必须带 name / startDate / endDate / location / organizer / offers
 *   - BreadcrumbList 的每一项要有 position / name / item
 *   - 不生成 HowTo（2023 已移除富结果）、SpecialAnnouncement（2025-07 弃用）、
 *     FAQPage（2026-05 起所有站点都不再有富结果）
 *
 * 测试：scripts/seo-jsonld.test.mjs
 */

import {
  ORG_EMAIL,
  ORG_ID,
  ORG_LEGAL_NAME,
  SITE_LOGO,
  SITE_NAME,
  SITE_NAME_EN,
  SITE_URL,
  WEBSITE_ID,
  absoluteUrl,
  compact,
  isoDate,
} from "./jsonld";

export { ORG_ID, WEBSITE_ID };

/** 组织实体。多处复用，所以 @id 固定，其它块用 { "@id": ORG_ID } 引用它。 */
export function organizationNode() {
  return compact({
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE_NAME,
    alternateName: SITE_NAME_EN,
    legalName: ORG_LEGAL_NAME,
    url: `${SITE_URL}/`,
    logo: {
      "@type": "ImageObject",
      url: SITE_LOGO,
      width: 512,
      height: 512,
    },
    email: ORG_EMAIL,
    contactPoint: compact({
      "@type": "ContactPoint",
      contactType: "customer support",
      email: ORG_EMAIL,
      availableLanguage: ["zh-CN"],
      areaServed: "CN",
    }),
    // 平台自身的对外形象图标集；同样参与实体识别。
    sameAs: [`${SITE_URL}/about`],
  });
}

/** 站点实体。potentialAction 声明站内搜索入口 —— 只有当站点确实有可搜索的列表页时才写。 */
export function websiteNode() {
  return compact({
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: `${SITE_URL}/`,
    name: SITE_NAME,
    alternateName: SITE_NAME_EN,
    inLanguage: "zh-CN",
    description: "连接 AI 创造者、真实需求与城市活动的杭州 AI 活动平台。",
    publisher: { "@id": ORG_ID },
  });
}

/**
 * 页面实体。每页一个、与 canonical 一一对应，并通过 isPartOf / about 挂到站点与组织上。
 * dateModified 用页面的真实最后修改时间（没给就不写 —— schema 里塞假时间会误导抓取）。
 */
export function webpageNode(options: {
  path: string;
  name: string;
  description: string;
  dateModified?: string;
  primaryImage?: string;
  type?: "WebPage" | "CollectionPage" | "AboutPage" | "ProfilePage";
}) {
  return compact({
    "@type": options.type ?? "WebPage",
    "@id": `${absoluteUrl(options.path)}#webpage`,
    url: absoluteUrl(options.path),
    name: options.name,
    description: options.description,
    inLanguage: "zh-CN",
    isPartOf: { "@id": WEBSITE_ID },
    about: { "@id": ORG_ID },
    dateModified: isoDate(options.dateModified),
    primaryImageOfPage: options.primaryImage ? { "@type": "ImageObject", url: absoluteUrl(options.primaryImage) } : undefined,
  });
}

/** 面包屑。item 指向列表第 N 层的绝对地址，最后一项是当前页。 */
export function breadcrumbNode(trail: { name: string; path: string }[]) {
  return {
    "@type": "BreadcrumbList",
    "@id": `${absoluteUrl(trail[trail.length - 1]?.path ?? "/")}#breadcrumb`,
    itemListElement: trail.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

/**
 * 活动列表实体。
 *
 * 为什么值得单独做：列表页本身不带任何结构化数据时，搜索引擎只能靠猜哪些链在一起；
 * ItemList 明确告诉它"这是一组活动的有序清单"，并逐个指向详情页。
 * 只列**公开已发布**的活动（调用方负责过滤），itemListOrder 用升序。
 */
export function itemListNode(options: { path: string; name: string; items: { name: string; path: string }[] }) {
  return compact({
    "@type": "ItemList",
    "@id": `${absoluteUrl(options.path)}#itemlist`,
    name: options.name,
    numberOfItems: options.items.length,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    itemListElement: options.items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      url: absoluteUrl(item.path),
    })),
  });
}

/**
 * 活动（Event）实体。字段与安全检查表里"发布信息"的口径一致：只用库里真实有的值。
 *
 * 几个刻意的处理：
 *   - `eventStatus` 固定 EventScheduled；站点没有"取消/改期"状态，不编造。
 *   - 地点：线上活动用 VirtualLocation；线下用 Place + PostalAddress
 *     （区级粒度，不含门牌，避免把发起人随便填的场地写成可核验地址）。
 *   - `offers` 免费用 price 0 而不是省略 —— "免费"本身是可检索信息；
 *     付费但没有金额时 price 给 0 并省略 priceCurrency 之外的猜测字段。
 *   - `organizer` 用 Organization 节点：有官网时给 url，否则只留名字（不编造 URL）。
 */
export function eventNode(activity: {
  slug: string;
  title: string;
  subtitle?: string;
  overview?: string;
  host?: string;
  image?: string;
  format?: string;
  venue?: string;
  districtName?: string;
  startsAt?: string;
  endsAt?: string;
  pricing?: string;
  fee?: string;
  registrationUrl?: string;
}) {
  const path = `/activities/${encodeURIComponent(activity.slug)}`;
  const url = absoluteUrl(path);
  const online = activity.format === "online";
  const startDate = isoDate(activity.startsAt);
  const endDate = isoDate(activity.endsAt);
  const priceText = (activity.fee ?? "").replace(/[^\d.]/g, "");
  const price = activity.pricing === "free" ? 0 : Number(priceText) || 0;

  return compact({
    "@type": "Event",
    "@id": `${url}#event`,
    name: activity.title,
    alternateName: activity.subtitle,
    description: activity.overview?.trim() || activity.subtitle || activity.title,
    url,
    image: activity.image ? absoluteUrl(activity.image) : `${SITE_URL}/og-image.jpg`,
    startDate,
    endDate,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: online
      ? "https://schema.org/OnlineEventAttendanceMode"
      : "https://schema.org/OfflineEventAttendanceMode",
    inLanguage: "zh-CN",
    location: online
      ? { "@type": "VirtualLocation", url }
      : {
          "@type": "Place",
          name: activity.venue || activity.districtName || "杭州",
          address: compact({
            "@type": "PostalAddress",
            addressLocality: "杭州市",
            // 只到区级：发起人填的"场地"是自由文本，不适合当成可核验的街道地址
            addressRegion: activity.districtName ? `浙江省杭州市${activity.districtName}` : "浙江省杭州市",
            addressCountry: "CN",
          }),
        },
    organizer: compact({
      "@type": "Organization",
      name: activity.host?.trim() || SITE_NAME,
      // 主办方是平台自己时才挂组织官网；第三方主办方不编造 URL
      url: activity.host?.trim() ? undefined : `${SITE_URL}/`,
    }),
    offers: compact({
      "@type": "Offer",
      price,
      priceCurrency: "CNY",
      availability: "https://schema.org/InStock",
      url: activity.registrationUrl ? absoluteUrl(activity.registrationUrl) : url,
    }),
    isPartOf: { "@id": WEBSITE_ID },
  });
}

/** 把一个或多个节点包成带 @context 的文档。多节点时用 @graph。 */
export function graph(nodes: unknown[]) {
  return nodes.length === 1
    ? { "@context": "https://schema.org", ...(nodes[0] as Record<string, unknown>) }
    : { "@context": "https://schema.org", "@graph": nodes };
}
