"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Coins, ExternalLink, MapPin } from "lucide-react";
import SiteHeader from "../../../site-header";
import { categoryLabel, EVENT_SOURCES, type ExternalEvent } from "@/lib/external-events";
import { getGlobalEvent } from "@/lib/api/data";
import "../../[slug]/detail.css";

const SOURCE_LABEL = new Map(EVENT_SOURCES.map((item) => [item.id, item.label]));

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
            <p className="detail-eyebrow" data-reveal="block">GLOBAL EVENT · 全球赛事</p>
            <h1 data-reveal="block">{event.title}</h1>
            <p className="detail-host" data-reveal="block">
              信息来源 · <a href={event.url} target="_blank" rel="noopener noreferrer">{SOURCE_LABEL.get(event.source) ?? event.source}</a>
              （标题与简介为来源平台原文）
            </p>
          </section>

          <div className="detail-body">
            <div className="detail-main">
              <section data-reveal="block" className="detail-section" aria-labelledby="ge-overview">
                <p className="detail-eyebrow">OVERVIEW</p>
                <h2 id="ge-overview">赛事介绍</h2>
                {event.description ? (
                  <p className="detail-text">{event.description}</p>
                ) : (
                  <p className="detail-placeholder">来源平台没有提供简介，参赛要求请见主办方页面。</p>
                )}
              </section>

              <section data-reveal="block" className="detail-section" aria-labelledby="ge-notice">
                <p className="detail-eyebrow">NOTICE</p>
                <h2 id="ge-notice">报名说明</h2>
                <p className="detail-placeholder">
                  本条信息由杭客松每日从来源平台自动抓取，报名方式、费用与评审规则以主办方页面为准。
                  外部赛事不参与杭客松的贡献值与荣誉结算。
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
                  <div><dt>信息来源</dt><dd>{SOURCE_LABEL.get(event.source) ?? event.source}</dd></div>
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
