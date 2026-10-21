import { NextResponse } from "next/server";
import { retiredActivitySlugPath } from "./lib/seo/retired-slugs";
import { hostNeedsRedirect, retiredPageHtml } from "./lib/seo/retired-page";

/**
 * CSP nonce 中间件（安全评估 P2#7：去掉 script-src 'unsafe-inline' 的实际豁免），
 * 外加一件事：**已永久下线的活动地址返回 410 Gone**（2026-10-13）。
 *
 * ── CSP 部分 ─────────────────────────────────────────────────────────────
 * 每个文档请求生成一次性 nonce 写进 CSP；支持 CSP3 的浏览器看到 nonce 后会忽略
 * 'unsafe-inline'，内联脚本必须有 nonce 才能执行（Next 的水合脚本会自动从 CSP 头读取
 * nonce；我们自己的引导脚本已外置为 public/motion-boot.js）。'unsafe-inline' 保留为
 * 旧浏览器的回退，现代浏览器上等于不存在。
 *
 * 注意：nonce 逐请求变化，带 nonce 的页面必须动态渲染（根布局 export const dynamic），
 * 静态预渲染的 HTML 无法逐请求注入 nonce——这是刻意放弃静态化的原因，本站体量可接受。
 *
 * ── 410 部分 ────────────────────────────────────────────────────────────
 * 为什么在 middleware 里做，而不是活动详情页：App Router 的 `notFound()`
 * **只能**产出 404，没有把它改成 410 的办法。要在渲染之前决定状态码，只能在这层。
 *
 * 为什么不能靠 404 的 noindex：能 —— 现在的 404 已经带 noindex 了。410 是更明确的
 * 补充信号：它明说"永久没了"，而 404 留了"可能回来"的余地。代价只有这一个判断，
 * 收益是让搜索引擎对"确定的下线"和"可能回来"不再同等对待。
 *
 * 顺序很重要：**先判跳转域名，再判 410**。`hangkathon.net` 是整站 308 到主站的部署，
 * 在它上面把某个路径变成 410 会与"这个域名只做跳转"矛盾。判 host 之后无论
 * Next 内部的路由/redirects 顺序如何变化，.net 的行为都由 next.config 的 redirects 决定。
 */

const CSP = (nonce: string) =>
  [
    "default-src 'self'",
    // modern 浏览器：nonce 生效、unsafe-inline 被忽略；legacy 浏览器：unsafe-inline 兜底
    `script-src 'self' 'nonce-${nonce}' 'unsafe-inline' https://open.weixin.qq.com https://res.wx.qq.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://open.weixin.qq.com",
    "frame-src 'self' https://open.weixin.qq.com",
    "form-action 'self' https://open.weixin.qq.com",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");

export function middleware(request: Request) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = btoa(String.fromCharCode(...bytes));
  const url = new URL(request.url);

  if (!hostNeedsRedirect(request.headers.get("host")) && retiredActivitySlugPath(url.pathname)) {
    /**
     * 410 响应体是自包含 HTML（lib/seo/retired-page.ts，里面写清了它为什么不能有脚本）。
     * 这里仍然挂 CSP：这个页面本身没有脚本，但保持"所有 HTML 响应都带同样的 CSP"
     * 这条不变量，比"这个页面反正不需要所以跳过"更容易在以后演进时不漏。
     * 头部的 robots noindex 已经写在 HTML 里，不在这里重复。
     */
    return new NextResponse(retiredPageHtml(), {
      status: 410,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy": CSP(nonce),
        // 410 是个状态，不是内容：别让 CDN/浏览器把这份响应缓存很久，
        // 也避免它被当成某个中间层的瞬时错误而重试。
        "cache-control": "no-store",
        "x-robots-tag": "noindex",
      },
    });
  }

  // CSP 必须同时挂在请求头上下传：Next 的渲染层从【请求头】的 CSP 里读 nonce，
  // 才会把它注入到水合/flight 内联脚本上（只设响应头的话脚本全部裸奔，实测踩过）。
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", CSP(nonce));
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", CSP(nonce));
  return response;
}

export const config = {
  // 静态资源与 SEO 文件不需要 CSP（也无 nonce 意义），跳过以省一次中间件开销。
  // llms.txt 加进来同理：它是给机器读的纯文本，不带任何脚本。
  //
  // MP_verify_：微信公众平台的域名归属校验文件，必须原样返回纯文本内容。
  // 走中间件虽然不影响响应体，但多一层没必要的路径；更关键的是这类校验文件
  // 一旦被任何中间层改写（加字、转码）就会验证失败，能绕开就绕开。
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|llms.txt|motion-boot.js|baidu_verify|MP_verify_).*)",
  ],
};
