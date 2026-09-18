import type { Metadata } from "next";
import { DEMO_ACTIVITIES } from "@/lib/demo-activities";
import ActivityDetail from "./activity-detail";

export function generateStaticParams() {
  return DEMO_ACTIVITIES.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const demo = DEMO_ACTIVITIES.find((item) => item.slug === slug);
  return { title: demo ? `${demo.title} · 杭客松` : "活动详情 · 杭客松" };
}

export default async function ActivityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const demo = DEMO_ACTIVITIES.find((item) => item.slug === slug) ?? null;
  return <ActivityDetail slug={slug} initial={demo} />;
}
