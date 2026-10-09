import type { Metadata } from "next";
import CreateActivityPage from "./create-client";

/**
 * 发活动页只对登录用户有意义，所以 robots 里禁抓、meta 里也不进索引 ——
 * 导航与动效仍在客户端组件里，这里只负责提供服务端可导出的 metadata。
 */
export const metadata: Metadata = {
  title: "发起活动",
  description: "在杭客松发起一场 AI 活动：填写基本信息、赛题与评审规则，提交审核后即可公开发布。",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <CreateActivityPage />;
}