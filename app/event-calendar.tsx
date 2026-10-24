"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight, MapPin } from "lucide-react";
import {
  categoryLabel,
  EVENT_CATEGORIES,
  eventScope,
  filterByWindow,
  isCuratedSource,
  sourceLabel,
  type EventCategory,
  type ExternalEvent,
} from "@/lib/external-events";
import "./event-calendar.css";

/**
 * 赛事日历：所有**站外报名**的赛事共用一条时间线。
 *
 * 为什么合并：原来的页面按「数据从哪来」分层（本地赛事尾部挂国内平台活动、
 * 精选单独一块、全球赛事又一块），用户看到的是四种板块、三种卡片。
 * 现在按「用户动作」分层：能在杭客松报名的在上面看板里，要去外面报名的都在这里——
 *
 *   · 杭客松精选（编辑背书）置顶，保留海报大卡；
 *   · 互动吧（江浙沪线下）与全球抓取赛事共用同一张卡片、同一条月度时间线，
 *     来源靠卡片上的「来源 互动吧 / Topcoder」标注，地域靠筛选片；
 *   · 站内不代报名，卡片与详情页都指向主办方页面。
 */

type ScopeFilter = "all" | "local" | "global";
type CategoryFilter = "all" | EventCategory;

const SCOPE_FILTERS: { value: ScopeFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "local", label: "杭州·江浙沪" },
  { value: "global", label: "全球" },
];

const CATEGORY_FILTERS: { value: CategoryFilter; label: string }[] = [
  { value: "all", label: "全部" },
  ...EVENT_CATEGORIES.map((value) => ({ value, label: categoryLabel(value) })),
];

/** 与看板卡片一致的简介截断长度。 */
const INTRO_CLAMP = 92;

/** 首屏与每次「展开更多」的条数：103 条互动吧全量铺开会把页面拉到无限长。 */
const PAGE_SIZE = 30;

function monthKey(event: ExternalEvent) {
  return (event.startsAt ?? event.endsAt ?? event.deadlineAt ?? "").slice(0, 7);
}

function monthLabel(key: string) {
  return new Date(`${key}-01T00:00:00Z`).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    timeZone: "Asia/Shanghai",
  });
}

function dateBadge(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!match) return { month: "--", day: "??" };
  return { month: `${Number(match[2])}月`, day: String(Number(match[3])) };
}

function dayLabelCn(iso: string) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    timeZone: "Asia/Shanghai",
  }).formatToParts(new Date(iso));
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = parts.find((part) => part.type === "day")?.value ?? "";
  return `${month}月${day}日`;
}

function whenText(event: ExternalEvent) {
  if (event.startsAt) {
    const start = dayLabelCn(event.startsAt);
    return event.endsAt ? `${start} – ${dayLabelCn(event.endsAt)}` : `${start} 开始`;
  }
  const end = event.endsAt ?? event.deadlineAt;
  return end ? `截止 ${dayLabelCn(end)} 前报名` : "时间以官网为准";
}

function introText(event: ExternalEvent) {
  const text = event.descriptionZh || event.description || event.detailTextZh || event.detailText || "";
  return text.length > INTRO_CLAMP ? `${text.slice(0, INTRO_CLAMP).trimEnd()}……` : text;
}

export default function EventCalendar({ events, loaded }: { events: ExternalEvent[]; loaded: boolean }) {
  const router = useRouter();
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const curated = useMemo(() => events.filter((event) => isCuratedSource(event.source)), [events]);
  const aggregated = useMemo(() => events.filter((event) => !isCuratedSource(event.source)), [events]);

  const shown = useMemo(
    () =>
      filterByWindow(aggregated).filter(
        (event) =>
          (scope === "all" || eventScope(event.source) === scope) &&
          (category === "all" || event.category === category),
      ),
    [aggregated, scope, category],
  );

  // 换筛选后从头翻页，避免停在「第 3 页」却只剩 1 条
  const visible = useMemo(() => shown.slice(0, visibleCount), [shown, visibleCount]);
  const months = useMemo(() => {
    const groups = new Map<string, ExternalEvent[]>();
    for (const event of visible) {
      const key = monthKey(event);
      const list = groups.get(key) ?? [];
      list.push(event);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [visible]);
  const hasMore = shown.length > visible.length;

  // 精选没加载完、或什么都没有（localStorage 模式 / 抓取还没跑）整块不渲染，不留空壳
  if (!loaded || (curated.length === 0 && shown.length === 0)) return null;

  return (
    <section className="calendar" aria-labelledby="calendar-title">
      <div className="ge-head">
        <div>
          <p className="eyebrow" data-reveal="block">EVENT CALENDAR</p>
          <h2 id="calendar-title" data-reveal="block">赛事日历</h2>
          <p className="ge-sub" data-reveal="block">
            站外赛事一站看全：江浙沪线下活动、全球竞赛，以及编辑精选。杭客松不代报名，报名与规则以主办方页面为准。
          </p>
        </div>
        <div className="ge-chips-wrap">
          <div className="ge-chips" role="group" aria-label="按地域筛选">
            {SCOPE_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`ge-chip${scope === item.value ? " is-active" : ""}`}
                aria-pressed={scope === item.value}
                onClick={() => { setScope(item.value); setVisibleCount(PAGE_SIZE); }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="ge-chips" role="group" aria-label="按类型筛选">
            {CATEGORY_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={`ge-chip${category === item.value ? " is-active" : ""}`}
                aria-pressed={category === item.value}
                onClick={() => { setCategory(item.value); setVisibleCount(PAGE_SIZE); }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {curated.length > 0 && (
        <div className="calendar-pinned" aria-label="杭客松精选">
          {curated.map((event) => (
            <article className="curated-card" key={event.id ?? event.sourceId}>
              {event.imageUrl && (
                /* eslint-disable-next-line @next/next/no-img-element -- 精选海报可能是站内静态资源，也可能是主办方 CDN，统一用 img */
                <img className="curated-cover" src={event.imageUrl} alt={`${event.titleZh || event.title} 海报`} loading="lazy" />
              )}
              <div className="curated-body">
                <p className="curated-meta">
                  <span className="curated-tag">精选</span>
                  {event.prize && <span className="curated-prize">{event.prize}</span>}
                </p>
                <h3>
                  {event.id ? (
                    <Link href={`/activities/global/${event.id}`}>{event.titleZh || event.title}</Link>
                  ) : (
                    event.titleZh || event.title
                  )}
                </h3>
                {event.titleZh && <p className="curated-original">原文 · {event.title}</p>}
                <p className="curated-when">{whenText(event)}</p>
                {(event.descriptionZh || event.description) && (
                  <p className="curated-intro">{event.descriptionZh || event.description}</p>
                )}
                <div className="curated-actions">
                  {event.id && (
                    <Link className="curated-detail" href={`/activities/global/${event.id}`}>
                      查看详情 <ArrowUpRight size={16} aria-hidden="true" />
                    </Link>
                  )}
                  <a className="curated-official" href={event.url} target="_blank" rel="noopener noreferrer">
                    前往官网 <ArrowUpRight size={15} aria-hidden="true" />
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {months.map(([key, list]) => (
        <div className="feed-group" key={key}>
          <div className="feed-group-head" data-reveal="item">
            <h3>{monthLabel(key)}</h3>
            <span>{list.length} 场</span>
          </div>
          <div className="feed-list">
            {list.map((event) => {
              const badge = dateBadge(event.startsAt ?? event.endsAt ?? event.deadlineAt ?? "");
              const where = event.online
                ? (event.location && !/^online$/i.test(event.location) ? event.location : "线上")
                : (event.location || "地点见官网");
              const intro = introText(event);
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
                    {where}
                    <span className="feed-sep" aria-hidden="true">·</span>
                    来源 {sourceLabel(event.source)}
                    <span className="feed-sep" aria-hidden="true">·</span>
                    {categoryLabel(event.category)}
                  </p>
                  {intro && <p className="feed-intro">{intro}</p>}
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

      {hasMore && (
        <div className="calendar-more">
          <button
            type="button"
            className="calendar-more-btn"
            onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
          >
            展开更多（已显示 {visible.length} / {shown.length} 场）
          </button>
        </div>
      )}

      <p className="ge-note">
        共 {shown.length + curated.length} 场 · 抓取与精选数据均来自各赛事官网，报名前请以主办方页面为准。
      </p>
    </section>
  );
}
