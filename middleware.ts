import { NextResponse } from "next/server";

/**
 * CSP nonce 中间件（安全评估 P2#7：去掉 script-src 'unsafe-inline' 的实际豁免）。
 *
 * 每个文档请求生成一次性 nonce 写进 CSP；支持 CSP3 的浏览器看到 nonce 后会忽略
 * 'unsafe-inline'，内联脚本必须有 nonce 才能执行（Next 的水合脚本会自动从 CSP 头读取
 * nonce；我们自己的引导脚本已外置为 public/motion-boot.js）。'unsafe-inline' 保留为
 * 旧浏览器的回退，现代浏览器上等于不存在。
 *
 * 注意：nonce 逐请求变化，带 nonce 的页面必须动态渲染（根布局 export const dynamic），
 * 静态预渲染的 HTML 无法逐请求注入 nonce——这是刻意放弃静态化的原因，本站体量可接受。
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

  // CSP 必须同时挂在请求头上下传：Next 的渲染层从【请求头】的 CSP 里读 nonce，
  // 才会把它注入到水合/flight 内联脚本上（只设响应头的话脚本全部裸奔，实测踩过）。
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", CSP(nonce));
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", CSP(nonce));
  return response;
}

export const config = {
  // 静态资源与 SEO 文件不需要 CSP（也无 nonce 意义），跳过以省一次中间件开销
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|motion-boot.js|baidu_verify).*)"],
};
