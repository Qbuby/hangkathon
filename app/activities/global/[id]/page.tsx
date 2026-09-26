import GlobalEventDetail from "./global-event-detail";

export const metadata = { title: "全球赛事详情 · 杭客松" };

export default async function GlobalEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GlobalEventDetail id={id} />;
}
