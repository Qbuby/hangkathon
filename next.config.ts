import type { NextConfig } from "next";

/**
 * hangkathon.net 指向 Vercel 上那份没有数据库的部署（登录凭据、可见数据都与线上站不同），
 * 整站永久跳到自托管的 hangkathon.com。按请求 host 判定，自托管部署自己不触发。
 */
const CANONICAL_HOST = "hangkathon.com";

/**
 * 内容安全策略：默认只放行同源；图片允许 data: 与 https（外链海报/抖音缩略图），
 * 样式允许 unsafe-inline（Next 的样式标签与 canvas 场景需要），脚本只走同源与
 * 微信授权域。connect-src 加上 open.weixin.qq.com 是为第三方登录跳转前的预连接。
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://open.weixin.qq.com https://res.wx.qq.com",
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

const nextConfig: NextConfig = {
  /* 自托管（Docker）时才产出 standalone 服务端，Vercel / Cloudflare 两个目标的构建保持不变。 */
  ...(process.env.DOCKER_BUILD === "1" ? { output: "standalone" as const } : {}),
  /**
   * 不发送 X-Powered-By: Next.js。
   * 版本号本来就没带，但框架指纹同样没必要主动交出去 —— 攻击者据此可以直接挑
   * Next.js 的已知问题试，而不是从零探测。对抗测试 F 组会断言这个头不存在。
   */
  poweredByHeader: false,
  async redirects() {
    return ["hangkathon.net", "www.hangkathon.net"].map((host) => ({
      source: "/:path*",
      has: [{ type: "host" as const, value: host }],
      destination: `https://${CANONICAL_HOST}/:path*`,
      permanent: true,
    }));
  },
  /**
   * 安全响应头（检查表 8.2 / 10.2e）：HSTS 强制 https、禁止被 iframe 嵌套、
   * 禁止 MIME 嗅探、限制 referrer 与权限 API。frame-ancestors 用 CSP 而不是
   * X-Frame-Options，因为后者在现代浏览器里对嵌套防护弱得多。
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
};

export default nextConfig;
