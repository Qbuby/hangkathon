/**
 * 部署后冒烟测试：目标不是"能开"，而是"关键契约没坏"。
 *
 * 每次 CI 部署完成、容器健康检查通过后由 deploy/ci.sh 调用，也可以手动：
 *   node scripts/ci/smoke.mjs                        # 默认打 http://127.0.0.1:3210
 *   TEST_BASE_URL=https://hangkathon.com node scripts/ci/smoke.mjs   # 打线上
 *   SMOKE_MODE=local node scripts/ci/smoke.mjs       # 本地无数据库模式（跳过 registry 相关断言）
 *
 * 覆盖四类：
 *   1. 路由可达性 —— 每个对外页面与 API 的状态码；
 *   2. 响应契约 —— 不只 200，还检查 JSON 字段与类型（字段改名/变 null 要在这里挡住）；
 *   3. 静态资源与 SEO 文件 —— 图片、favicon、robots.txt、sitemap.xml；
 *   4. 安全响应头 —— CSP/HSTS/nosniff 等必须存在，版本号不应外泄。
 */

import { DEFAULT_BASE, check, expect, get, report } from "./lib.mjs";

const BASE = process.env.TEST_BASE_URL ?? DEFAULT_BASE;
/** local = 本地无数据库模式：登录、活动相关接口本来就会返回 503，不做断言。 */
const MODE = process.env.SMOKE_MODE ?? "server";
const WITH_DB = MODE !== "local";
/** 响应时间预算：超过就说明这次部署有性能回归（服务器是 2C2G，给宽松一些）。 */
const SLOW_MS = Number(process.env.SMOKE_SLOW_MS ?? 3000);

const results = [];

async function timed(path, options) {
  const started = Date.now();
  const result = await get(BASE, path, options);
  return { ...result, ms: Date.now() - started };
}

/** 1. 页面路由 */
const PAGES = [
  ["/", 200],
  ["/activities", 200],
  ["/leaderboard", 200],
  ["/about", 200],
  ["/create", 200],
  ["/profile", 200],
];

for (const [path, want] of PAGES) {
  const result = await timed(path);
  check(results, `页面 ${path}`, result.status === want, expect.status(result, want).detail);
  if (result.status === 200) {
    check(results, `页面 ${path} 响应时间`, result.ms < SLOW_MS, `${result.ms}ms（预算 ${SLOW_MS}ms）`);
  }
}

/** 2. API 契约：状态码 + 关键字段，防止字段悄然改名或变 null。 */
const session = await timed("/api/session");
check(results, "GET /api/session 状态码", session.status === 200, expect.status(session, 200).detail);
if (session.status === 200) {
  let data = null;
  try {
    data = JSON.parse(session.body);
  } catch {
    /* 下面统一报错 */
  }
  check(results, "GET /api/session 是合法 JSON", data !== null, data === null ? session.body.slice(0, 80) : "");
  if (data) {
    for (const field of ["configured", "database", "providers"]) {
      check(results, `/api/session 含字段 ${field}`, field in data, JSON.stringify(data).slice(0, 120));
    }
    check(results, "/api/session providers 是数组", Array.isArray(data.providers), typeof data.providers);
    check(
      results,
      "/api/session 匿名访问 user 为 null",
      data.user === null,
      JSON.stringify(data.user),
    );
  }
}

const agentSession = await timed("/api/agent/session");
if (WITH_DB) {
  check(results, "GET /api/agent/session 状态码", agentSession.status === 200, expect.status(agentSession, 200).detail);
  if (agentSession.status === 200) {
    let data = null;
    try {
      data = JSON.parse(agentSession.body);
    } catch {
      /* 统一报错 */
    }
    check(results, "/api/agent/session 含 canPublish 字段", typeof data?.canPublish === "boolean", JSON.stringify(data).slice(0, 120));
    check(results, "/api/agent/session 匿名 canPublish=false", data?.canPublish === false, String(data?.canPublish));
    check(results, "/api/agent/session 匿名不泄漏邮箱", !/@/.test(agentSession.body), agentSession.body.slice(0, 120));
  }
} else {
  check(results, "GET /api/agent/session（本地模式应 503）", agentSession.status === 503, expect.status(agentSession, 503).detail);
}

const activities = await timed("/api/activities");
if (WITH_DB) {
  check(results, "GET /api/activities 状态码", activities.status === 200, expect.status(activities, 200).detail);
  if (activities.status === 200) {
    let data = null;
    try {
      data = JSON.parse(activities.body);
    } catch {
      /* 统一报错 */
    }
    check(results, "GET /api/activities 返回 activities 数组", Array.isArray(data?.activities), typeof data?.activities);
    // 公开列表绝不能漏出未公开/待审核活动：这是隐私与审核流的硬约束
    const leaked = (data?.activities ?? []).filter((item) => item.visibility !== "public" || item.reviewStatus === "pending");
    check(results, "公开列表不含未公开/待审核活动", leaked.length === 0, `泄漏 ${leaked.length} 条`);
  }
} else {
  check(results, "GET /api/activities（本地模式应 503）", activities.status === 503, expect.status(activities, 503).detail);
}

/** 3. 静态资源与 SEO 文件 */
const STATIC = [
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/brand/icon-512.png",
  "/brand/hangkathon-logo.png",
  "/og-image.jpg",
  "/motion-boot.js",
  "/robots.txt",
  "/sitemap.xml",
  "/baidu_verify_codeva-oo0L6Rdfhs.html",
];
for (const path of STATIC) {
  const result = await timed(path);
  check(results, `静态 ${path}`, result.status === 200, expect.status(result, 200).detail);
}

const robots = await get(BASE, "/robots.txt");
if (robots.status === 200) {
  for (const rule of ["/manage", "/profile", "/api/"]) {
    check(results, `robots.txt 禁止抓取 ${rule}`, robots.body.includes(`Disallow: ${rule}`), robots.body.slice(0, 120));
  }
  check(results, "robots.txt 声明 sitemap", robots.body.includes("Sitemap:"), robots.body.slice(0, 160));
}

const sitemap = await get(BASE, "/sitemap.xml");
if (sitemap.status === 200) {
  check(results, "sitemap.xml 是 urlset", sitemap.body.includes("<urlset"), sitemap.body.slice(0, 60));
  check(results, "sitemap.xml 不是索引型", !sitemap.body.includes("<sitemapindex"), "百度拒收 sitemapindex");
  check(results, "sitemap.xml 含首页", sitemap.body.includes("<loc>https://"), "");
  check(results, "sitemap.xml 体积合规（<10MB）", sitemap.body.length < 10 * 1024 * 1024, `${sitemap.body.length} 字节`);
}

/** 4. 安全响应头与信息泄露 */
const home = await get(BASE, "/");
const SECURITY_HEADERS = [
  ["content-security-policy", "frame-ancestors"],
  ["strict-transport-security", "max-age"],
  ["x-content-type-options", "nosniff"],
  ["referrer-policy", "strict-origin"],
  ["x-frame-options", "DENY"],
  ["permissions-policy", "camera"],
];
for (const [header, needle] of SECURITY_HEADERS) {
  check(results, `安全响应头 ${header}`, expect.header(home, header, needle).passed, expect.header(home, header, needle).detail);
}
check(
  results,
  "未泄露 Server 版本细节",
  !/nginx\/[\d.]+/i.test(home.headers.server ?? ""),
  `server: ${home.headers.server ?? "(无)"}`,
);

/** 5. 管理端与用户端必须要求登录（不能匿名进面板） */
const adminApi = await get(BASE, "/api/admin/overview");
check(
  results,
  "GET /api/admin/overview 匿名应为 401/403/503",
  [401, 403, 503].includes(adminApi.status),
  expect.statusIn(adminApi, [401, 403, 503]).detail,
);
check(
  results,
  "匿名访问管理 API 不返回数据",
  !adminApi.body.includes('"totalUsers"') && !adminApi.body.includes('"activities"'),
  adminApi.body.slice(0, 120),
);

const exitCode = report("部署后冒烟（smoke）", results);
process.exit(exitCode);
