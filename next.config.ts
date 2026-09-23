import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* 自托管（Docker）时才产出 standalone 服务端，Vercel / Cloudflare 两个目标的构建保持不变。 */
  ...(process.env.DOCKER_BUILD === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
