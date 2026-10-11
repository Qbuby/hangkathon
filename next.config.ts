import type { NextConfig } from "next";

/**
 * hangkathon.net 指向 Vercel 上那份没有数据库的部署（登录凭据、可见数据都与线上站不同），
 * 整站永久跳到自托管的 hangkathon.com。按请求 host 判定，自托管部署自己不触发。
 */
const CANONICAL_HOST = "hangkathon.com";

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
   * 安全响应头（检查表 8.2 / 10.2e）。CSP 已移到 middleware.ts 逐请求生成 nonce
   * （安全评估 P2#7）：这里的 CSP 若与 middleware 的并存，浏览器会同时执行两份策略
   * （交集生效），缺 nonce 的那份会把所有内联脚本拦掉，页面直接挂。
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
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
