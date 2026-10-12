import type { Metadata } from "next";
import ManageClient from "./manage-client";

/**
 * 管理端口（/manage）：无公开导航入口，直达 URL。
 *
 * 这一层薄壳只为导出 metadata —— 页面本身必须是客户端组件（要读会话、拉管理数据），
 * 而**客户端组件导不出 metadata**，管理页又必须带 noindex：否则一张
 * "无管理员权限"的界面会被搜索结果收录。
 * robots.txt 里的 Disallow 只管抓取、不管收录（被禁止抓取的页面，爬虫也看不到它的
 * noindex），所以两道一起上：robots 省抓取，meta 管收录。
 */
export const metadata: Metadata = {
  title: "管理端口",
  robots: { index: false, follow: false },
};

export default function ManagePage() {
  return <ManageClient />;
}
