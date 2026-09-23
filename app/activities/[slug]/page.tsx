import type { Metadata } from "next";
import { PUBLISHED_ACTIVITIES } from "@/lib/published-activities";
import ActivityDetail from "./activity-detail";

export function generateStaticParams() {
  return PUBLISHED_ACTIVITIES.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const activity = PUBLISHED_ACTIVITIES.find((item) => item.slug === slug);
  return { title: activity ? `${activity.title} · 杭客松` : "活动详情 · 杭客松" };
}

export default async function ActivityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const initial = PUBLISHED_ACTIVITIES.find((item) => item.slug === slug) ?? null;
  return <ActivityDetail slug={slug} initial={initial} />;
}
