import type { Metadata } from "next";
import { hasDatabase } from "@/db";
import { listActivities } from "@/lib/server/activities";
import { PUBLISHED_ACTIVITIES } from "@/lib/published-activities";
import type { ActivityView } from "@/lib/api/data";
import ActivitiesClient from "./activities-client";
import "./activities.css";

/**
 * 活动看板：SEO 的主力页。改成服务端组件，先把活动列表在服务端算出来再交给客户端组件渲染，
 * 这样首屏 HTML 里就带着活动标题、日期、所属区与摘要 —— 之前是客户端取数，
 * 不执行 JS 的爬虫只能看到一个空列表。
 * listActivities(null) 是匿名访客口径：不公开与待审核的活动不会出现在页面与 sitemap 里。
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AI 活动看板 · 杭州",
  description:
    "杭客松 AI 活动看板：浏览杭州正在进行的 AI 赛事、大赛与共创活动，覆盖各区线上线下活动，可直接报名参赛。",
  alternates: { canonical: "/activities" },
  openGraph: {
    title: "AI 活动看板 · 杭州 · 杭客松",
    description: "杭州 AI 赛事与活动大全，正在进行与即将开始的活动都在这里。",
    url: "/activities",
  },
};

/** 没有数据库的部署（Vercel 那份）回落到预置活动，其余走服务端列表。 */
async function loadInitial(): Promise<{ activities: ActivityView[]; mode: "local" | "server" }> {
  if (!hasDatabase()) return { activities: [...PUBLISHED_ACTIVITIES] as ActivityView[], mode: "local" };
  try {
    return { activities: (await listActivities(null)) as ActivityView[], mode: "server" };
  } catch (error) {
    console.error("[seo] 活动列表服务端读取失败，回落预置活动", error);
    return { activities: [...PUBLISHED_ACTIVITIES] as ActivityView[], mode: "server" };
  }
}

export default async function ActivitiesPage() {
  const { activities, mode } = await loadInitial();
  return <ActivitiesClient initialActivities={activities} initialMode={mode} />;
}