"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import {
  categoryLabel,
  EVENT_CATEGORIES,
  filterByWindow,
  type EventCategory,
  type ExternalEvent,
} from "@/lib/external-events";
import { EVENT_SOURCES } from "@/lib/external-events";
import "./global-events.css";

type CategoryFilter = "all" | EventCategory;

const CATEGORY_FILTERS: { value: CategoryFilter; label: string }[] = [
  { value: "all", label: "全部" },
  ...EVENT_CATEGORIES.filter((value) => value !== "activity").map((value) => ({ value, label: categoryLabel(value) })),
];

const SOURCE_LABEL = new Map(EVENT_SOURCES.map((item) => [item.id, item.label]));

/** 与看板卡片一致的简介截断长度。 */
const INTRO_CLAMP = 92;

function monthLabel(iso: string) {
  return new Date(iso).toLocaleDateString("zh-CN", { year: "numeric", month: "long", timeZone: "Asia/Shanghai" });
}

function dateBadge(iso?: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!match) return { month: "--", day: "??" };
  return { month: `${Number(match[2])}月`, day: String(Number(match[3])) };
}

function whenText(event: ExternalEvent) {
  if (event.startsAt) {
    const start = dayLabelCn(event.startsAt);
    return event.endsAt ? `${start} – ${dayLabelCn(event.endsAt)}` : `${start} 开始`;
  }
  const end = event.endsAt ?? event.deadlineAt;
  return end ? `截止 ${dayLabelCn(end)} 前报名` : "时间以官网为准";
}

function dayLabelCn(iso: string) {
  const parts = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "Asia/Shanghai" }).formatToParts(new Date(iso));
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${month}月${day}日`;
}

function introText(event: ExternalEvent) {
  return event.detailTextZh || event.detailText || event.descriptionZh || event.description || "";
}

export default function GlobalEvents({ events, eventsLoaded }: { events: ExternalEvent[]; eventsLoaded: boolean }) {
  const router = useRouter();
  const [category, setCategory] = useState<CategoryFilter>("all");
  const shown = useMemo(
    () => filterByWindow(events).filter((event) => category === "all" || event.category === category),
    [events, category],
  );

  const months = useMemo(() => {
    const groups = new Map<string, ExternalEvent[]>();
    for (const event of shown) {
      const key = (event.startsAt ?? event.endsAt ?? event.deadlineAt ?? "").slice(0, 7);
      const list = groups.get(key) ?? [];
      list.push(event);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [shown]);

  // 没加载完、或没有数据（localStorage 模式 / 抓取还没跑）都整块不渲染，不留空壳。
  if (!eventsLoaded || shown.length === 0) return null;

  return (
    <section className="global-events" aria-labelledby="global-events-title">
      <div className="ge-head">
        <div>
          <p className="eyebrow" data-reveal="block">GLOBAL EVENTS</p>
          <h2 id="global-events-title" data-reveal="block">全球赛事</h2>
          <p className="ge-sub" data-reveal="block">每日自动抓取全球竞赛、黑客松与创意赛事：开始日期最早到一周前、最晚到三个月后。点击卡片查看中文详情。</p>
        </div>
        <div className="ge-chips" role="group" aria-label="按类别筛选">
          {CATEGORY_FILTERS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`ge-chip${category === item.value ? " is-active" : ""}`}
              aria-pressed={category === item.value}
              onClick={() => setCategory(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {months.map(([key, list]) => (
        <div className="feed-group" key={key}>
          <div className="feed-group-head" data-reveal="item">
            <h3>{monthLabel(list[0].startsAt ?? list[0].endsAt ?? list[0].deadlineAt!)}</h3>
            <span>{list.length} 场</span>
          </div>
          <div className="feed-list">
            {list.map((event) => {
              const badge = dateBadge(event.startsAt ?? event.endsAt ?? event.deadlineAt);
              const intro = introText(event);
              const introShow = intro.length > INTRO_CLAMP ? `${intro.slice(0, INTRO_CLAMP).trimEnd()}……` : intro;
              return (
                <article
                  className="feed-item"
                  key={`${event.source}:${event.sourceId}`}
                  data-reveal="item"
                  role="link"
                  tabIndex={0}
                  aria-label={`查看${event.titleZh || event.title}详情`}
                  onClick={() => router.push(`/activities/global/${event.id}`)}
                  onKeyDown={(keyboardEvent) => {
                    if (keyboardEvent.key === "Enter") router.push(`/activities/global/${event.id}`);
                  }}
                >
                  <div className="feed-item-top">
                    <div className={`feed-date is-${event.category}`} aria-hidden="true">
                      <span>{badge.month}</span>
                      <strong>{badge.day}</strong>
                    </div>
                    <div className="feed-item-head">
                      <h3>{event.titleZh || event.title}</h3>
                      <p className="feed-when">{whenText(event)}</p>
                    </div>
                  </div>
                  <p className="feed-where">
                    <MapPin size={13} aria-hidden="true" />
                    {event.online ? "线上" : (event.location || "地点见官网")}
                    <span className="feed-sep" aria-hidden="true">·</span>
                    来源 {SOURCE_LABEL.get(event.source) ?? event.source}
                    <span className="feed-sep" aria-hidden="true">·</span>
                    {categoryLabel(event.category)}
                  </p>
                  {introShow && <p className="feed-intro">{introShow}</p>}
                  <p className="feed-meta">
                    {event.prize && <span className="feed-prize">{event.prize}</span>}
                    <span className="feed-cta">查看详情 →</span>
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      ))}

      <p className="ge-note">共 {shown.length} 场 · 数据每日抓取自各赛事官网，报名前请以主办方页面为准。</p>
    </section>
  );
}
