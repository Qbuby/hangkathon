"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { isCuratedSource, type ExternalEvent } from "@/lib/external-events";
import "./curated-events.css";

/**
 * 「杭客松精选」：人工收录的第三方赛事，展示在自动抓取内容之前。
 *
 * 为什么单独一块而不是混进「全球赛事」：抓取内容是每日自动汇入的流水，
 * 精选是编辑核对过官网的少数几条；混在一起用户分不清哪个是平台推荐。
 * 点击进站内详情页（/activities/global/<id>），详情页再给「前往官网」——
 * 站内不代报名，也不参与贡献值与荣誉结算。
 */
export default function CuratedEvents({
  events,
  loaded,
}: {
  events: ExternalEvent[];
  loaded: boolean;
}) {
  const curated = events.filter((event) => isCuratedSource(event.source));
  // 没加载完或没有精选时整块不渲染，不留空壳（与 GlobalEvents 同一约定）
  if (!loaded || curated.length === 0) return null;

  return (
    <section className="curated" aria-labelledby="curated-title">
      <div className="curated-head">
        <p className="eyebrow" data-reveal="block">CURATED</p>
        <h2 id="curated-title" data-reveal="block">杭客松精选</h2>
        <p className="curated-sub" data-reveal="block">
          编辑逐条核对过官网后收录的赛事，重点推荐但不代报名 —— 报名与规则以主办方页面为准。
        </p>
      </div>

      <div className="curated-list">
        {curated.map((event) => (
          <article className="curated-card" key={event.id ?? event.sourceId} data-reveal="item">
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
              <p className="curated-when">{curatedWhenText(event)}</p>
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
    </section>
  );
}

/** 与详情页同一口径：有结束日期就写区间，否则写「截止…」。 */
function curatedWhenText(event: ExternalEvent) {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Shanghai" });
  if (event.startsAt && event.endsAt) return `${fmt(event.startsAt)} – ${fmt(event.endsAt)}`;
  if (event.startsAt) return `${fmt(event.startsAt)} 开始`;
  const end = event.endsAt ?? event.deadlineAt;
  return end ? `截止 ${fmt(end)}` : "时间以官网为准";
}
