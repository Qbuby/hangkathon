"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarDays, Coins, MapPin, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
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
import { FACTIONS, factionById } from "@/lib/factions";
import Donut from "../../donut";
import {
  MECHANISM,
  factionShares,
  getContribution,
  loadJoin,
  saveJoin,
  type JoinRecord,
} from "@/lib/contribution";
import "./detail.css";

export default function ActivityDetail({ slug, initial }: { slug: string; initial: Activity | null }) {
  const [activity, setActivity] = useState<Activity | null>(initial);
  const [resolved, setResolved] = useState(false);
  const [joinRecord, setJoinRecord] = useState<JoinRecord | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [pickedFaction, setPickedFaction] = useState<string | null>(null);

  // 本机创建的活动只存在 localStorage 里，挂载后再查一次。
  // setState 放进回调，与 scene.tsx 一样避开 set-state-in-effect。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const found = findActivityBySlug(slug, DEMO_ACTIVITIES);
      setActivity(found);
      setJoinRecord(found ? loadJoin(found.id) : null);
      setPickedFaction(null);
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
  const hasPrize = activity.awardsEnabled && activity.prizePool > 0;
  const shares = factionShares(getContribution(activity.id), hasPrize ? activity.prizePool : 0);
  const contributionTotal = shares.reduce((sum, row) => sum + row.points, 0);
  const joinFaction = joinRecord ? factionById(joinRecord.factionId) : undefined;

  function confirmJoin() {
    if (!activity || !pickedFaction) return;
    setJoinRecord(saveJoin(activity.id, pickedFaction));
    setPickedFaction(null);
    setJoinOpen(false);
  }

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
                <p className="detail-placeholder">奖金总额：{prizeText(activity)}。奖项名目为荣誉头衔，现金按下方阵营贡献占比两层分发。</p>
              </>
            )}
          </section>

          <section className="detail-section" aria-labelledby="detail-factions">
            <p className="detail-eyebrow">FACTIONS</p>
            <h2 id="detail-factions">阵营贡献</h2>
            {shares.length > 0 ? (
              <>
                <div className="faction-panel">
                  <Donut
                    slices={shares.map((row) => ({
                      id: row.faction.id,
                      label: row.faction.name,
                      value: row.points,
                      color: row.faction.color,
                    }))}
                    centerLabel="总贡献值"
                    centerValue={contributionTotal.toLocaleString("zh-CN")}
                  />
                  <div className="faction-list">
                    {shares.map((row) => (
                      <div className="faction-row" key={row.faction.id}>
                        <span className="faction-dot" style={{ background: row.faction.color }} />
                        <strong>{row.faction.name}</strong>
                        <span className="faction-points">{row.points.toLocaleString("zh-CN")}</span>
                        <span className="faction-share">{(row.share * 100).toFixed(1)}%</span>
                        {hasPrize && (
                          <span className="faction-prize">奖金 ¥{row.prize.toLocaleString("zh-CN")}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <p className="detail-placeholder">
                  {hasPrize
                    ? "奖金按两层比例分发：阵营奖金 = 奖池 × 阵营占比，阵营内再按个人贡献占比分给成员；贡献数据为演示数据。"
                    : "这场活动不设奖金，阵营贡献只累计荣誉；贡献数据为演示数据。"}
                </p>
              </>
            ) : (
              <p className="detail-placeholder">
                还没有阵营贡献数据。报名开始后，各阵营的贡献值将在这里实时汇总（阵营贡献 = 阵营成员个人贡献之和）。
              </p>
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

          {joinRecord && joinFaction ? (
            <div className="detail-join">
              <p className="detail-join-title">已报名</p>
              <div className="join-badge" style={{ borderColor: `${joinFaction.color}66`, color: joinFaction.color }}>
                <span className="join-badge-dot" style={{ background: joinFaction.color }} />
                {joinFaction.name}阵营
              </div>
              <ul className="join-rules">
                <li>正式阶段每天发 ¥{MECHANISM.voucher.base} 算力券，当日有效</li>
                <li>每邀请 1 位新用户，日面额 +¥{MECHANISM.voucher.perInvite}，封顶 ¥{MECHANISM.voucher.dailyCap}</li>
                <li>产出物 {MECHANISM.review.hours} 小时内审核，按质量计入个人与阵营贡献值</li>
                <li>阵营已锁定，本活动中不可更改</li>
              </ul>
              <p className="detail-join-note">演示环境：报名记录保存在这台设备的浏览器里，贡献值不会真实累计。</p>
            </div>
          ) : (
            <div className="detail-join">
              <p className="detail-join-title">想参加这场活动？</p>
              <Button className="primary-action" onClick={() => setJoinOpen(true)}>报名参加</Button>
              <p className="detail-join-note">
                报名后进入阵营选择阶段，代表一个杭州区县出战（本活动中锁定不可更改），正式阶段每天领取算力券。
                {isDemo ? "此活动为虚构的演示数据。" : "活动目前只保存在这台设备的浏览器里。"}
              </p>
            </div>
          )}
        </aside>
      </div>

      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent className="detail-dialog join-dialog" showCloseButton={false}>
          <DialogClose asChild>
            <Button variant="ghost" className="dialog-close" onClick={() => setJoinOpen(false)}><X size={18} /></Button>
          </DialogClose>
          <p className="eyebrow">JOIN</p>
          <DialogTitle className="dialog-title">选择你的阵营</DialogTitle>
          <DialogDescription className="dialog-description">
            报名后进入阵营选择阶段：选择一个杭州区县，与同阵营市民一起为它出战。阵营贡献值 = 阵营成员个人贡献值之和。
          </DialogDescription>
          <div className="join-factions" role="radiogroup" aria-label="选择阵营">
            {FACTIONS.map((faction) => (
              <button
                key={faction.id}
                type="button"
                role="radio"
                aria-checked={pickedFaction === faction.id}
                className={`join-faction${pickedFaction === faction.id ? " is-selected" : ""}`}
                style={pickedFaction === faction.id ? { borderColor: faction.color, color: faction.color } : undefined}
                onClick={() => setPickedFaction(faction.id)}
              >
                {faction.name}
              </button>
            ))}
          </div>
          <p className="join-lock-note">阵营在本活动中锁定，确认后无法更改。</p>
          <Button className="dialog-done" disabled={!pickedFaction} onClick={confirmJoin}>
            确认报名
          </Button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
