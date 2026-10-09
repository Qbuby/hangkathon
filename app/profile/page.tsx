import type { Metadata } from "next";
import ProfileClient from "./profile-client";

/** 个人主页只有登录后才有内容，既不收录也不跟随外链。 */
export const metadata: Metadata = {
  title: "个人主页",
  description: "杭客松个人主页：查看你的活动报名与平台贡献值。",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <ProfileClient />;
}