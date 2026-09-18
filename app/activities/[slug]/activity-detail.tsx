"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarDays, Coins, MapPin, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  categoryLabel,
  findActivityBySlug,
  formatLabel,
  joinPolicyLabel,
  judgingLabel,
  pricingLabel,
  prizeText,
  submissionLabels,
  visibilityLabel,
  type Activity,
} from "@/lib/activity";
import { DEMO_ACTIVITIES } from "@/lib/demo-activities";
import "./detail.css";

export default function ActivityDetail({ slug, initial }: { slug: string; initial: Activity | null }) {
  const [activity, setActivity] = useState<Activity | null>(initial);
  const [resolved, setResolved] = useState(false);

  // 本机创建的活动只存在 localStorage 里，挂载后再查一次。
  // setState 放进回调，与 scene.tsx 一样避开 set-state-in-effect。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setActivity(findActivityBySlug(slug, DEMO_ACTIVITIES));
      setResolved(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [slug]);

  if (!activity) {
    return (
      <main className="detail-page">
        <header className="detail-top">
          <Link className="detail-back" href="/#activities"><ArrowLeft size={17} /> 返回活动看板</Link>
          <span className="detail-top-title">活动详情</span>
        </header>
        <div className="detail-notfound">
          <div className="detail-notfound-card">
            <p className="eyebrow">NOT FOUND</p>
            <h1>{resolved ? "没有找到这场活动" : "加载中…"}</h1>
            <p>
              {resolved
                ? "这个活动代号下没有活动。它可能已被删除，或者是在另一台设备上创建的——目前活动只保存在创建它的浏览器里。"
                : "正在读取活动信息。"}
            </p>
            <Button asChild className="primary-action"><Link href="/#activities">回到活动看板 <ArrowRight size={17} /></Link></Button>
          </div>
        </div>
      </main>
    );
  }

  const isDemo = DEMO_ACTIVITIES.some((item) => item.id === activity.id);
  const submissions = submissionLabels(activity.submissionTypes);

  return (
    <main className="detail-page">
      <header className="detail-top">
        <Link className="detail-back" href="/#activities"><ArrowLeft size={17} /> 返回活动看板</Link>
        <span className="detail-top-title">活动详情</span>
        <span className="detail-top-note">{isDemo ? "演示数据 · 非真实活动" : "本机创建 · 未同步到服务器"}</span>
      </header>

      <section className="detail-hero">
        <div className="detail-tags">
          <span className="is-category">{categoryLabel(activity.category)}</span>
          <span>{formatLabel(activity)}</span>
          <span>{pricingLabel(activity)}</span>
          <span>{visibilityLabel(activity.visibility)}</span>
        </div>
        <h1>{activity.title}</h1>
        {activity.subtitle && <p className="detail-sub">{activity.subtitle}</p>}
        <p className="detail-host">主办方 · {activity.host || "未填写"}</p>
      </section>

      <div className="detail-body">
        <div className="detail-main">
          <section className="detail-section" aria-labelledby="detail-overview">
            <p className="detail-eyebrow">OVERVIEW</p>
            <h2 id="detail-overview">活动介绍</h2>
            {activity.overview ? (
              <p className="detail-text">{activity.overview}</p>
            ) : (
              <p className="detail-placeholder">主办方还没有填写详细介绍。</p>
            )}
          </section>

          <section className="detail-section" aria-labelledby="detail-criteria">
            <p className="detail-eyebrow">JUDGING</p>
            <h2 id="detail-criteria">评审维度</h2>
            <p className="detail-placeholder">评审方式：{judgingLabel(activity.judging)}</p>
            {activity.criteria.length > 0 ? (
              <div className="detail-criteria">
                {activity.criteria.map((criterion) => (
                  <div className="detail-criterion" key={criterion.name}>
                    <div className="detail-criterion-top">
                      <strong>{criterion.name}</strong>
                      <span>权重 {criterion.weight}%</span>
                    </div>
                    <div className="detail-bar"><i style={{ width: `${Math.min(100, Math.max(0, criterion.weight))}%` }} /></div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="detail-placeholder">还没有设置评审维度。</p>
            )}
          </section>

          <section className="detail-section" aria-labelledby="detail-awards">
            <p className="detail-eyebrow">AWARDS</p>
            <h2 id="detail-awards">奖项</h2>
            {!activity.awardsEnabled || activity.awards.length === 0 ? (
              <p className="detail-placeholder">这场活动不设奖项，{prizeText(activity)}。</p>
            ) : (
              <>
                <div className="detail-awards">
                  {activity.awards.map((award) => (
                    <div className="detail-award" key={award.name}>
                      <strong>{award.name}</strong>
                      <span>{award.slots} 位</span>
                      <p>{award.reward || "奖励待定"}</p>
                    </div>
                  ))}
                </div>
                <p className="detail-placeholder">奖金总额：{prizeText(activity)}</p>
              </>
            )}
          </section>

          {submissions.length > 0 && (
            <section className="detail-section" aria-labelledby="detail-submissions">
              <p className="detail-eyebrow">SUBMISSION</p>
              <h2 id="detail-submissions">提交形式</h2>
              <div className="detail-chips">
                {submissions.map((label) => <span key={label}>{label}</span>)}
              </div>
            </section>
          )}
        </div>

        <aside className="detail-side" aria-label="活动关键信息">
          <div className="detail-facts">
            <h2>关键信息</h2>
            <dl>
              <div><dt><CalendarDays size={14} />时间</dt><dd>{activity.startsAt && activity.endsAt ? `${activity.startsAt} 至 ${activity.endsAt}` : "待定"}</dd></div>
              <div><dt><MapPin size={14} />地点</dt><dd>{activity.format === "offline" ? activity.venue || "待定" : "线上"}</dd></div>
              <div><dt><Users size={14} />队伍</dt><dd>每队最多 {activity.maxTeamSize} 人</dd></div>
              <div><dt><Coins size={14} />奖金</dt><dd>{prizeText(activity)}</dd></div>
              <div><dt>费用</dt><dd>{activity.pricing === "paid" ? activity.fee || "收费" : "免费"}</dd></div>
              <div><dt>组队</dt><dd>{activity.openTeam ? "可自由组队" : "需自行成队"}</dd></div>
              <div><dt>报名</dt><dd>{joinPolicyLabel(activity)}</dd></div>
              <div><dt>活动代号</dt><dd>{activity.slug}</dd></div>
            </dl>
          </div>

          <div className="detail-join">
            <p className="detail-join-title">想参加这场活动？</p>
            <Button className="primary-action" disabled>报名参加</Button>
            <p className="detail-join-note">
              {isDemo
                ? "此活动为虚构的演示数据，不代表已举办或已开放报名，报名功能也尚未开放。"
                : "报名功能尚未开放。这场活动目前只保存在这台设备的浏览器里，换设备或清理数据后会消失。"}
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
