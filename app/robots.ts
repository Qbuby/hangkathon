import type { MetadataRoute } from "next";

/**
 * robots.txt：抓取策略。
 *
 * 三条原则：
 *
 *  1. **不放 Disallow 的路径不能靠 robots 保密**。管理端（/manage）、个人页、创建页
 *     都是"不该被收录"而不是"不该被访问" —— 它们的访问控制由服务端鉴权负责
 *     （/api/admin/* 全部 requireAdmin），robots 只是省抓取预算。
 *     页面本身另有 meta robots noindex 兜底。
 *
 *  2. **AI 爬虫按用途分开对待**，不写成一条 `User-agent: *`。
 *     容易被混为一谈的两组（claude-seo 的 GEO 规范专门强调）：
 *       · OAI-SearchBot 决定 ChatGPT 搜索能否引用本页；GPTBot 只管模型训练。
 *       · Claude-SearchBot 决定 Claude 搜索能否引用；ClaudeBot 只管模型训练。
 *     本站希望被 AI 搜索引用（活动信息本来就该被发现），所以**放行搜索类爬虫**；
 *     训练类爬虫保持默认放行 —— 这是内容方的选择，不是技术必需，写清楚以免被误读。
 *     注意：`Google-Extended` 只影响 Gemini/Vertex 的训练与 grounding，
 *     **不影响** Google 搜索收录与 AI Overviews（那些走 Googlebot）。
 *
 *  3. **显式声明，不留默认猜测**。所有条目都写出来，任何人 diff 这份文件都能看懂站点意图。
 *
 * Host 指令只被 Yandex 认，保留是因为百度对 Host 有历史依赖（国内站点惯例）。
 */
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://hangkathon.com").replace(/\/$/, "");

  // 管理与私人路径：不该被收录。用 allow 列表表达"整体开放、这些除外"。
  const privatePaths = ["/manage", "/profile", "/create", "/api/", "/auth-error"];

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: privatePaths,
      },
      // ── AI 搜索类爬虫：放行（希望活动信息能被 AI 摘要引用）──────────────
      { userAgent: "OAI-SearchBot", allow: "/", disallow: privatePaths },
      { userAgent: "Claude-SearchBot", allow: "/", disallow: privatePaths },
      { userAgent: "PerplexityBot", allow: "/", disallow: privatePaths },
      // 用户触发的抓取（用户主动让 AI 读这一页）：同样放行
      { userAgent: "ChatGPT-User", allow: "/", disallow: privatePaths },
      { userAgent: "Claude-User", allow: "/", disallow: privatePaths },
      // ── 训练类爬虫：保持放行（内容方选择，不是技术必需）─────────────────
      { userAgent: "GPTBot", allow: "/", disallow: privatePaths },
      { userAgent: "ClaudeBot", allow: "/", disallow: privatePaths },
      { userAgent: "Google-Extended", allow: "/", disallow: privatePaths },
      { userAgent: "CCBot", allow: "/", disallow: privatePaths },
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
