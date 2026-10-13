import { RETIRED_ACTIVITY_SLUGS } from "./retired-slugs";

/**
 * 已下线活动地址的 410 响应体。
 *
 * 为什么用手写 HTML 而不是复用 `app/not-found.tsx` 的组件：
 * App Router 里 `notFound()` **只能**产出 404，没有办法把它变成 410；
 * 410 必须在渲染之前由 middleware 直接返回 Response。所以这里是一段自包含的 HTML，
 * 代价是它不会跟着站点的视觉改版一起变 —— 可以接受：这是一个错误页，
 * 而且它比任何正常页面都更少被看到。
 *
 * 三条硬约束（都是踩过的坑，别改）：
 *   1. **不写任何内联 `<script>`**：middleware 的 410 走的是独立响应，没有 CSP nonce，
 *      任何内联脚本都会被 `script-src` 拦掉。纯静态 HTML 没有这个问题。
 *   2. **自带 `<meta name="robots" content="noindex">`**：410 本身已经表达了"别收录"，
 *      但万一中间有代理改写状态码，noindex 是留在文档里的第二道。
 *   3. **备案信息必须在**：法规要求全站可见，错误页也是"全站"的一部分。
 *
 * 正文刻意**不复述原活动内容**（不放标题、不放简介）。一个已经下线的地址
 * 不该再携带任何关于那场活动的文本 —— 搜索摘要里出现旧文案正是这次要修的问题。
 */
export function retiredPageHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>活动已下线 · 杭客松</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;
background:#0b0d12;color:#e8eaf0;font:16px/1.7 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;padding:32px}
main{max-width:34rem;text-align:center}
p.eyebrow{margin:0 0 8px;letter-spacing:.28em;font-size:12px;color:#8b93a7}
h1{margin:0 0 12px;font-size:26px;font-weight:700}
p.body{margin:0 0 24px;color:#a8b0c2}
p.actions{margin:0;display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
a.primary,a.secondary{padding:10px 20px;border-radius:999px;text-decoration:none;font-weight:600}
a.primary{background:#3b82f6;color:#fff}
a.secondary{border:1px solid #39415a;color:#c8cee0}
footer{margin-top:40px;display:flex;gap:16px;flex-wrap:wrap;justify-content:center;font-size:12px;color:#6f778c}
footer a{color:#6f778c;text-decoration:none}
footer a:hover{color:#a8b0c2}
</style>
</head>
<body>
<main>
<p class="eyebrow">GONE</p>
<h1>这场活动已经下线</h1>
<p class="body">它不会再重新开放，这个地址也不会再指向任何内容。可以去活动看板看看正在进行的活动。</p>
<p class="actions">
<a class="primary" href="/activities">去活动看板</a>
<a class="secondary" href="/">返回首页</a>
</p>
</main>
<footer>
<a href="https://beian.mps.gov.cn/#/query/webSearch?code=33010502013637" target="_blank" rel="noopener noreferrer nofollow">浙公网安备33010502013637号</a>
<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer nofollow">浙ICP备2026082561号</a>
<a href="/about">关于杭客松</a>
</footer>
</body>
</html>
`;
}

/**
 * 自检：这份 HTML 里不允许出现会破坏上述约束的东西。
 *
 * 放在源码里而不是只写进测试：因为它约束的是"这段字符串永远不许带脚本"，
 * 而这个约束一旦被后来的编辑无意打破（比如为了加个统计代码），
 * 线上表现是"页面白屏或样式失效"，很难联想到 middleware。
 * `scripts/seo-retired.test.mjs` 会调用它。
 */
export const RETIRED_PAGE_FORBIDDEN: readonly { label: string; pattern: RegExp }[] = [
  { label: "内联 <script>", pattern: /<script/i },
  /**
   * 内联事件属性（onclick= 等）。必须限定在**标签内部且前面有空白**，
   * 否则 `content=`（<meta name="viewport" content="…">）会被误判 —— 它的
   * "content" 里就含 "on"，宽松写法 `on[a-z]+\s*=` 会直接命中。
   * 这条正则看着啰嗦，但它拦的正是"为了加统计代码而破例"的那种改动。
   */
  { label: "内联事件属性", pattern: /<[a-z][^>]*\son[a-z]+\s*=/i },
  { label: "javascript: 伪协议", pattern: /javascript:/i },
];

/**
 * middleware 只对"已下线的活动详情"放行 410，并且**只在非跳转域名上**。
 *
 * 为什么要判 host：`hangkathon.net` 是整站 308 到主站的部署（next.config 的 redirects）。
 * 如果 middleware 在它之前跑，那些域名上的已下线地址就会变成 410 而不是 308 ——
 * 一个只做跳转的站点突然对某个路径返回 410，是不一致的状态。
 * 判 host 之后，无论 Next 的路由顺序怎么变，`.net` 的行为都由 redirects 决定。
 */
export const REDIRECT_ONLY_HOSTS = ["hangkathon.net", "www.hangkathon.net"] as const;

export function hostNeedsRedirect(host: string | null): boolean {
  if (!host) return false;
  // host 可能带端口（本地 127.0.0.1:3210），比对前剥掉
  const bare = host.toLowerCase().replace(/:\d+$/, "");
  return (REDIRECT_ONLY_HOSTS as readonly string[]).includes(bare);
}

/** 名单里的 slug 绝不能再出现在已发布列表里。 */
export function retiredSlugsArePublishable(publishedSlugs: readonly string[]): string[] {
  return RETIRED_ACTIVITY_SLUGS.filter((slug) => publishedSlugs.includes(slug));
}
