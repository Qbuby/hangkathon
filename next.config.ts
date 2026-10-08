import type { NextConfig } from "next";

/**
 * hangkathon.net 指向 Vercel 上那份没有数据库的部署（登录凭据、可见数据都与线上站不同），
 * 整站永久跳到自托管的 hangkathon.com。按请求 host 判定，自托管部署自己不触发。
 */
const CANONICAL_HOST = "hangkathon.com";

const nextConfig: NextConfig = {
  /* 自托管（Docker）时才产出 standalone 服务端，Vercel / Cloudflare 两个目标的构建保持不变。 */
  ...(process.env.DOCKER_BUILD === "1" ? { output: "standalone" as const } : {}),
  async redirects() {
    return ["hangkathon.net", "www.hangkathon.net"].map((host) => ({
      source: "/:path*",
      has: [{ type: "host" as const, value: host }],
      destination: `https://${CANONICAL_HOST}/:path*`,
      permanent: true,
    }));
  },
};

export default nextConfig;
