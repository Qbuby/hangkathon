"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
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
  ...EVENT_CATEGORIES.map((value) => ({ value, label: categoryLabel(value) })),
];

const sourceLabel = new Map(EVENT_SOURCES.map((item) => [item.id, item.label]));

function monthLabel(iso: string) {
  return new Date(iso).toLocaleDateString("zh-CN", { year: "numeric", month: "long", timeZone: "Asia/Shanghai" });
}

function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", timeZone: "Asia/Shanghai" });
}

/** 日期口径：有开始日期显示区间；只有截止日期的目录站条目显示「截止 x月x日」。 */
function dateText(event: ExternalEvent): { month: string; day: string; range: string; deadline: boolean } {
  if (!event.startsAt) {
    const end = event.endsAt ?? event.deadlineAt ?? "";
    return { month: "截止", day: dayLabel(end), range: `${dayLabel(end)} 前报名`, deadline: true };
  }
  const start = dayLabel(event.startsAt);
  const end = event.endsAt ? dayLabel(event.endsAt) : null;
  return { month: dayLabel(event.startsAt).split("/")[0] + "月", day: dayLabel(event.startsAt).split("/")[1], range: end && end !== start ? `${start} – ${end}` : start, deadline: false };
}

function monthKey(event: ExternalEvent): string {
  const iso = event.startsAt ?? event.endsAt ?? event.deadlineAt ?? "";
  return iso.slice(0, 7);
}

export default function GlobalEvents({ events, eventsLoaded }: { events: ExternalEvent[]; eventsLoaded: boolean }) {
  const [category, setCategory] = useState<CategoryFilter>("all");
  const loaded = eventsLoaded;

  const shown = useMemo(
    () => filterByWindow(events).filter((event) => category === "all" || event.category === category),
    [events, category],
  );

  const months = useMemo(() => {
    const groups = new Map<string, ExternalEvent[]>();
    for (const event of shown) {
      const key = monthKey(event);
      const list = groups.get(key) ?? [];
      list.push(event);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [shown]);

  // 没加载完、或没有数据（localStorage 模式 / 抓取还没跑）都整块不渲染，不留空壳。
  if (!loaded || shown.length === 0) return null;

  return (
    <section className="global-events" aria-labelledby="global-events-title">
      <div className="ge-head">
        <div>
          <p className="eyebrow" data-reveal="block">GLOBAL EVENTS</p>
          <h2 id="global-events-title" data-reveal="block">全球赛事</h2>
          <p className="ge-sub" data-reveal="block">每日自动抓取全球竞赛、黑客松与创意赛事：开始日期最早到一周前、最晚到三个月后，信息以主办方页面为准。点击卡片查看中文详情。</p>
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
        <div className="ge-month" key={key}>
          <div className="ge-month-head" data-reveal="item">
            <h3>{monthLabel(list[0].startsAt ?? list[0].endsAt ?? list[0].deadlineAt!)}</h3>
            <span>{list.length} 场</span>
          </div>
          <ul className="ge-list">
            {list.map((event) => {
              const when = dateText(event);
              return (
                <li key={`${event.source}:${event.sourceId}`} data-reveal="item">
                  <span className={`ge-date${when.deadline ? " is-deadline" : ""}`} aria-hidden="true">
                    <span>{when.month}</span>
                    <strong>{when.day}</strong>
                  </span>
                  <div className="ge-body">
                    <Link href={`/activities/global/${event.id}`} className="ge-title">
                      {event.titleZh || event.title}
                    </Link>
                    <p className="ge-meta">
                      <span className="ge-when">{when.range}</span>
                      <span className="ge-sep" aria-hidden="true">·</span>
                      <span className="ge-source">{sourceLabel.get(event.source) ?? event.source}</span>
                      <span className="ge-sep" aria-hidden="true">·</span>
                      {categoryLabel(event.category)}
                      <span className="ge-sep" aria-hidden="true">·</span>
                      <span className="ge-where">
                        <MapPin size={12} aria-hidden="true" />
                        {event.online ? "线上" : (event.location || "地点见官网")}
                      </span>
                      {event.prize && (
                        <>
                          <span className="ge-sep" aria-hidden="true">·</span>
                          <span className="ge-prize">{event.prize}</span>
                        </>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <p className="ge-note">共 {shown.length} 场 · 数据每日抓取自各赛事官网，报名前请以主办方页面为准。</p>
    </section>
  );
}
