"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Coins, ExternalLink, MapPin } from "lucide-react";
import SiteHeader from "../../../site-header";
import { categoryLabel, eventScope, isCuratedSource, sourceLabel, type ExternalEvent } from "@/lib/external-events";
import { getGlobalEvent } from "@/lib/api/data";
import "../../[slug]/detail.css";
import "../../../event-calendar.css";

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("zh-CN", { month: "long", day: "numeric", timeZone: "Asia/Shanghai" });
}

function timeText(event: ExternalEvent) {
  if (event.startsAt) {
    return event.endsAt ? `${fmtDay(event.startsAt)} 至 ${fmtDay(event.endsAt)}` : `${fmtDay(event.startsAt)} 开始`;
  }
  const end = event.endsAt ?? event.deadlineAt;
  return end ? `截止 ${fmtDay(end)} 前报名` : "以主办方页面为准";
}

export default function GlobalEventDetail({ id }: { id: string }) {
  const [event, setEvent] = useState<ExternalEvent | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getGlobalEvent(id)
      .then((result) => {
        if (!cancelled) setEvent(result);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <main className="detail-page">
      <SiteHeader />
      {!loaded ? (
        <div className="detail-notfound">
          <div className="detail-notfound-card">
            <p className="eyebrow">GLOBAL EVENT</p>
            <h1>加载中…</h1>
          </div>
        </div>
      ) : !event ? (
        <div className="detail-notfound">
          <div className="detail-notfound-card">
            <p className="eyebrow">NOT FOUND</p>
            <h1>没有找到这条赛事</h1>
            <p>它可能已被来源平台下架，或本期抓取未收录。可以到活动页的「全球赛事」板块查看当前收录的赛事。</p>
            <Link className="detail-back" href="/activities">← 返回活动列表</Link>
          </div>
        </div>
      ) : (
        <>
          <section className="detail-hero">
            <p className="detail-eyebrow" data-reveal="block">
              {isCuratedSource(event.source)
                ? "CURATED · 杭客松精选"
                : eventScope(event.source) === "local"
                  ? "LOCAL EVENT · 本地赛事"
                  : "GLOBAL EVENT · 全球赛事"}
            </p>
            <h1 data-reveal="block">{event.titleZh || event.title}</h1>
            {event.titleZh && (
              <p className="detail-host" data-reveal="block">原文标题 · {event.title}</p>
            )}
            <p className="detail-host" data-reveal="block">
              信息来源 · <a href={event.url} target="_blank" rel="noopener noreferrer">{sourceLabel(event.source)}</a>
              {isCuratedSource(event.source) ? "（杭客松人工收录，中文为人工翻译）" : "（中文为机器翻译，可能有出入）"}
            </p>
          </section>

          <div className="detail-body">
            <div className="detail-main">
              {event.imageUrl && (
                /* eslint-disable-next-line @next/next/no-img-element -- 来源 CDN 域名不固定，直接用 img */
                <img
                  className="ge-hero-img"
                  src={event.imageUrl}
                  alt={`${event.title} 海报`}
                  referrerPolicy="no-referrer"
                  onError={(e) => { e.currentTarget.style.display = "none"; }}
                />
              )}
              <section data-reveal="block" className="detail-section" aria-labelledby="ge-overview">
                <p className="detail-eyebrow">OVERVIEW</p>
                <h2 id="ge-overview">赛事介绍与规则</h2>
                {event.detailTextZh && <p className="detail-text">{event.detailTextZh}</p>}
                {event.detailText && (
                  event.detailTextZh ? (
                    <details className="ge-original" open>
                      <summary>查看来源平台原文（完整介绍与规则）</summary>
                      <p className="detail-text ge-original-text">{event.detailText}</p>
                    </details>
                  ) : (
                    <p className="detail-text">{event.detailText}</p>
                  )
                )}
                {!event.detailText && (
                  event.descriptionZh ? (
                    <p className="detail-text">{event.descriptionZh}</p>
                  ) : event.description ? (
                    <p className="detail-text">{event.description}</p>
                  ) : (
                    <p className="detail-placeholder">正文还在抓取中，或来源平台没有提供简介。报名要求请见主办方页面。</p>
                  )
                )}
              </section>

              <section data-reveal="block" className="detail-section" aria-labelledby="ge-notice">
                <p className="detail-eyebrow">NOTICE</p>
                <h2 id="ge-notice">报名说明</h2>
                <p className="detail-placeholder">
                  {isCuratedSource(event.source)
                    ? "本条由杭客松编辑人工核对官网后收录，日期中的具体日可能与官网略有出入，请以主办方页面为准。杭客松不代办报名，外部赛事也不参与杭客松的贡献值与荣誉结算。"
                    : "本条信息由杭客松每日从来源平台自动抓取，报名方式、费用与评审规则以主办方页面为准。外部赛事不参与杭客松的贡献值与荣誉结算。"}
                </p>
              </section>
            </div>

            <aside className="detail-side" aria-label="赛事关键信息">
              <div className="detail-facts" data-reveal="block">
                <h2>关键信息</h2>
                <dl>
                  <div><dt>类别</dt><dd>{categoryLabel(event.category)}</dd></div>
                  <div><dt><CalendarDays size={14} />时间</dt><dd>{timeText(event)}</dd></div>
                  <div><dt><MapPin size={14} />地点</dt><dd>{event.online ? "线上" : (event.location || "地点见官网")}</dd></div>
                  <div><dt><Coins size={14} />奖金</dt><dd>{event.prize || "以主办方页面为准"}</dd></div>
                  <div><dt>信息来源</dt><dd>{sourceLabel(event.source)}</dd></div>
                </dl>
              </div>
              <div className="detail-join" data-reveal="block">
                <p className="detail-join-title">想参加？</p>
                <a className="ge-official" href={event.url} target="_blank" rel="noopener noreferrer">
                  前往官方页面 <ExternalLink size={15} aria-hidden="true" />
                </a>
                <p className="detail-join-note">报名入口、费用与规则以主办方页面为准。</p>
              </div>
            </aside>
          </div>

          <div className="ge-back">
            <Link className="detail-back" href="/activities"><ArrowLeft size={15} /> 返回活动列表</Link>
          </div>
        </>
      )}
    </main>
  );
}
