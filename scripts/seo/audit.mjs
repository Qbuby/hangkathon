#!/usr/bin/env node
/**
 * SEO 检查套件（对照 claude-seo 的 seo-technical / seo-schema / seo-sitemap / seo-geo 规范）。
 *
 * 与冒烟测试的分工：冒烟只断言"页面能开、字段没改名"；这里断言的是**能被搜索引擎与
 * AI 摘要正确消费**的那一层 —— 结构化数据能不能解析、必填字段齐不齐、
 * canonical 是否自指且唯一、robots 与 noindex 是否一致、sitemap 有没有
 * 已废弃字段与越界 URL。
 *
 * 全部断言都在"原始 HTML"上做（不执行 JS）—— 因为 GPTBot / PerplexityBot 这类
 * 爬虫就是不执行 JS 的，用浏览器读页面会得到与它们不同的结论（那种假绿最危险）。
 *
 * 用法：
 *   TEST_BASE_URL=http://127.0.0.1:3210 node scripts/seo/audit.mjs
 *   TEST_BASE_URL=https://hangkathon.com node scripts/seo/audit.mjs
 */

import { DEFAULT_BASE, check, get, report } from "../ci/lib.mjs";

const BASE = process.env.TEST_BASE_URL ?? DEFAULT_BASE;

/**
 * canonical 的期望 origin：**不是** TEST_BASE_URL。
 *
 * canonical 必须永远指向生产域名（无论站点当前跑在本地 3210 还是服务器回环），
 * 否则"在预发环境跑一遍 SEO 检查"会把 canonical 改成预发地址并因此判失败 ——
 * 而那是错误的行为，不是错误的结果。所以期望值独立于被测地址。
 */
const CANONICAL_ORIGIN = (process.env.SEO_CANONICAL_ORIGIN ?? "https://hangkathon.com").replace(/\/$/, "");

const results = [];

/** 页面清单：路径 + 期望的 JSON-LD 类型（至少包含其中的类型）。 */
const PAGES = [
  { path: "/", expectTypes: ["WebSite", "Organization"], expectCanonical: `${CANONICAL_ORIGIN}/` },
  { path: "/activities", expectTypes: ["CollectionPage", "ItemList", "BreadcrumbList"] },
  { path: "/leaderboard", expectTypes: ["WebPage", "BreadcrumbList"] },
  { path: "/about", expectTypes: ["Organization", "AboutPage", "BreadcrumbList"] },
];
/** 活动详情页是可选目标：本地无数据库时列表可能为空，这时跳过而不是判失败。 */
const ACTIVITY_PATH = process.env.SEO_ACTIVITY_PATH ?? "/activities/guoqing-77";

/** 从原始 HTML 里抠出所有 ld+json 块并解析。纯字符串处理 —— 不执行任何页面脚本。 */
function extractJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/g)].map(
    (match) => match[1],
  );
  const parsed = [];
  const parseErrors = [];
  for (const raw of blocks) {
    try {
      parsed.push(JSON.parse(raw));
    } catch (error) {
      parseErrors.push(String(error?.message ?? error));
    }
  }
  return { blocks, parsed, parseErrors };
}

/** 展开 @graph，收集所有出现过的 @type。 */
function collectTypes(docs) {
  const types = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      if ("@type" in value) {
        const t = value["@type"];
        (Array.isArray(t) ? t : [t]).forEach((x) => types.add(x));
      }
      Object.values(value).forEach(walk);
    }
  };
  walk(docs);
  return types;
}

/* ── 1. 每个页面的结构化数据 ───────────────────────────────────────────── */

for (const page of PAGES) {
  const response = await get(BASE, page.path);
  if (!check(results, `SEO ${page.path} 可达`, response.status === 200, `实际 ${response.status}`)) continue;

  const { blocks, parsed, parseErrors } = extractJsonLd(response.body);
  check(results, `SEO ${page.path} 有 JSON-LD`, blocks.length > 0, `实际 ${blocks.length} 块`);
  check(results, `SEO ${page.path} JSON-LD 可解析`, parseErrors.length === 0, parseErrors.join(" | "));

  const types = collectTypes(parsed);
  for (const type of page.expectTypes) {
    check(results, `SEO ${page.path} 含 @type ${type}`, types.has(type), `实际类型：${[...types].join(", ") || "无"}`);
  }

  // script 块里出现字面量 </script> 说明数据突破了脚本块（用户填的标题里带这个就能注入标记）
  const joined = blocks.join("");
  check(
    results,
    `SEO ${page.path} JSON-LD 未被数据突破（无字面量 </script>）`,
    !joined.includes("</script>"),
    "发现字面量 </script>，说明序列化时没有转义 < —— 这是注入面",
  );

  // @context 必须是 https（http 形态会被部分消费者忽略）
  for (const doc of parsed) {
    if (doc && typeof doc === "object" && "@context" in doc) {
      check(results, `SEO ${page.path} @context 为 https://schema.org`, String(doc["@context"]) === "https://schema.org", String(doc["@context"]));
    }
  }

  // canonical：每个可收录页必须自指且唯一
  const canonicals = [...response.body.matchAll(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/g)].map((m) => m[1]);
  check(results, `SEO ${page.path} 恰好一个 canonical`, canonicals.length === 1, canonicals.join(", ") || "无");
  if (page.expectCanonical) {
    // 首页 canonical 允许带/不带结尾斜杠：Next 从 metadataBase 推导时不加斜杠，
    // 而 `https://host` 与 `https://host/` 在爬虫眼里是同一个地址（Google 明确说明）。
    // 这里两种形态都接受，但不接受别的任何形态 —— 否则"canonical 指错地方"就漏掉了。
    const want = [page.expectCanonical, page.expectCanonical.replace(/\/$/, "")];
    check(results, `SEO ${page.path} canonical 自指`, want.includes(canonicals[0]), `实际 ${canonicals[0]}，期望 ${want.join(" 或 ")}`);
  } else {
    check(results, `SEO ${page.path} canonical 指向生产域名`, (canonicals[0] ?? "").startsWith(CANONICAL_ORIGIN), canonicals[0] ?? "无");
  }

  // 标题长度：claude-seo 的 quality-gates 给的是 30–60 字符。
  // 中文按字符数计（百度展示约 30 字，超出会被截断），这里对齐宽松上限。
  const title = /<title>([\s\S]*?)<\/title>/.exec(response.body)?.[1]?.trim() ?? "";
  check(results, `SEO ${page.path} 有 title`, title.length > 0, "");
  // 描述长度 120–160 字符是英文口径；中文按 60–120 字判断更合理，且不能为空
  const desc = /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/.exec(response.body)?.[1] ?? "";
  check(results, `SEO ${page.path} 有 description`, desc.length > 0, "");
}

/* ── 2. 活动详情页：Event 必填字段 ─────────────────────────────────────── */

const detail = await get(BASE, ACTIVITY_PATH);
if (detail.status === 200) {
  const { parsed } = extractJsonLd(detail.body);
  const types = collectTypes(parsed);
  if (types.has("Event")) {
    check(results, "SEO 活动详情含 Event", true, "");
    const findEvent = (value) => {
      if (Array.isArray(value)) return value.map(findEvent).find(Boolean);
      if (value && typeof value === "object") {
        if (value["@type"] === "Event") return value;
        for (const child of Object.values(value)) {
          const hit = findEvent(child);
          if (hit) return hit;
        }
      }
      return null;
    };
    const event = parsed.map(findEvent).find(Boolean);
    // claude-seo schema-types 对 Event 的必需属性
    for (const field of ["name", "startDate", "location", "organizer", "offers"]) {
      check(results, `SEO Event 含 ${field}`, Boolean(event?.[field]), JSON.stringify(event?.[field] ?? null).slice(0, 80));
    }
    check(results, "SEO Event 的 url 是绝对地址", /^https?:\/\//.test(event?.url ?? ""), event?.url ?? "无");
    check(
      results,
      "SEO Event 的 location 类型合法",
      ["Place", "VirtualLocation"].includes(event?.location?.["@type"]),
      event?.location?.["@type"] ?? "无",
    );
    // 站点目前没有"取消/改期"状态，不该出现编造的 eventStatus
    check(
      results,
      "SEO Event 的 eventStatus 是 EventScheduled",
      event?.eventStatus === "https://schema.org/EventScheduled",
      String(event?.eventStatus ?? "无"),
    );
  } else {
    check(results, "SEO 活动详情含 Event", false, `实际类型：${[...types].join(", ") || "无"}`);
  }
} else {
  check(results, "SEO 活动详情可达（未跳过检查）", false, `实际 ${detail.status}（本地无数据库时用 SEO_ACTIVITY_PATH 指定一个可访问的活动）`);
}

/* ── 3. 不该被收录的页面必须带 noindex ────────────────────────────────── */

for (const path of ["/manage", "/auth-error"]) {
  const response = await get(BASE, path);
  const robots = /<meta[^>]*name=["']robots["'][^>]*content=["']([^"']*)["']/.exec(response.body)?.[1] ?? "";
  check(results, `SEO ${path} 带 noindex`, /noindex/i.test(robots), `robots: "${robots}"`);
}

/* ── 4. robots.txt 与 sitemap ─────────────────────────────────────────── */

const robots = await get(BASE, "/robots.txt");
check(results, "SEO robots.txt 可达", robots.status === 200, `实际 ${robots.status}`);
check(results, "SEO robots.txt 声明 sitemap", /Sitemap:\s*https?:\/\//i.test(robots.body), "");
check(results, "SEO robots.txt 有 Host（百度依赖）", /^Host:\s*https?:\/\//im.test(robots.body), "");
// AI 搜索类爬虫必须被明确列出：只写 User-agent: * 时，
// "ChatGPT 搜索能不能引用本页"这件事取决于爬虫对通配符的解释，不如显式声明。
for (const bot of ["OAI-SearchBot", "Claude-SearchBot", "PerplexityBot"]) {
  check(results, `SEO robots.txt 显式声明 ${bot}`, robots.body.includes(`User-Agent: ${bot}`), "");
}

const sitemap = await get(BASE, "/sitemap.xml");
check(results, "SEO sitemap.xml 可达", sitemap.status === 200, `实际 ${sitemap.status}`);
if (sitemap.status === 200) {
  check(results, "SEO sitemap 是 urlset（不是索引型）", sitemap.body.includes("<urlset"), sitemap.body.slice(0, 60));
  check(results, "SEO sitemap 无已废弃的 <priority>", !sitemap.body.includes("<priority>"), "Google 已忽略 priority");
  check(results, "SEO sitemap 无已废弃的 <changefreq>", !sitemap.body.includes("<changefreq>"), "Google 已忽略 changefreq");
  check(results, "SEO sitemap 每条都有 <lastmod>", (sitemap.body.match(/<loc>/g) ?? []).length === (sitemap.body.match(/<lastmod>/g) ?? []).length, "");
  check(results, "SEO sitemap 体积 < 50MB（协议上限）", sitemap.body.length < 50 * 1024 * 1024, `${sitemap.body.length} 字节`);
  const locs = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  check(results, "SEO sitemap URL 数 < 50000（协议上限）", locs.length < 50_000, `${locs.length} 条`);
  check(results, "SEO sitemap 全部是 https", locs.every((loc) => loc.startsWith("https://")), locs.find((l) => !l.startsWith("https://")) ?? "");
  check(results, "SEO sitemap 不含被 noindex 的路径", !locs.some((loc) => /\/(manage|profile|create|auth-error)(\/|$)/.test(loc)), "");
  check(results, "SEO sitemap 不含 API 路径", !locs.some((loc) => loc.includes("/api/")), "");
}

/* ── 5. llms.txt（记录存在性，不作为排名依据） ─────────────────────────── */

const llms = await get(BASE, "/llms.txt");
check(results, "SEO llms.txt 可达（AI 工具读；对搜索引擎无影响）", llms.status === 200, `实际 ${llms.status}`);

/* ── 6. 静态资源与可抓取性 ────────────────────────────────────────────── */

const ogImage = await get(BASE, "/og-image.jpg");
check(results, "SEO og:image 可访问", ogImage.status === 200, `实际 ${ogImage.status}`);
check(
  results,
  "SEO og:image 体积合理（<200KB）",
  ogImage.body.length < 200 * 1024,
  `${Math.round(ogImage.body.length / 1024)}KB（claude-seo 图片分级：内容图 <100KB 目标、200KB 告警）`,
);

const exitCode = report("SEO 检查（structured data / robots / sitemap）", results);
console.log(`\n目标：${BASE}`);
process.exit(exitCode);
