"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { ArrowRight, CalendarDays, Coins, MapPin, X } from "lucide-react";
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
import {
  createCustomFaction,
  loadCustomFactions,
  validateCustomFactionName,
  type CustomFaction,
} from "@/lib/custom-factions";
import FactionPanel from "../../faction-panel";
import SiteHeader from "../../site-header";
import {
  MECHANISM,
  factionShares,
  getContribution,
  loadJoin,
  saveJoin,
  type JoinRecord,
} from "@/lib/contribution";
import {
  inviteCount,
  loadInviteEvents,
  recordInviteEvent,
  settleFactionLeaders,
  type InviteEvent,
} from "@/lib/invites";
import {
  addSubmission,
  isValidDouyinUrl,
  loadActivitySubmissions,
  type SubmissionRecord,
} from "@/lib/submission";
import "./detail.css";

type AccountState = {
  configured: boolean;
  providers: { id: string; name: string; configured: boolean }[];
  user: { name: string | null; email: string | null } | null;
};

type Invite = { factionId: string; by: string } | "refused" | null;

/** 剪贴板 API 不可用（无用户手势/权限）时的兜底复制。 */
function legacyCopy(text: string) {
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(area);
  return ok;
}

/** 列表里展示链接时压掉协议头并截断。 */
function shortenUrl(url: string) {
  const text = url.replace(/^https?:\/\//i, "");
  return text.length > 52 ? `${text.slice(0, 52)}…` : text;
}

export default function ActivityDetail({ slug, initial }: { slug: string; initial: Activity | null }) {
  const [activity, setActivity] = useState<Activity | null>(initial);
  const [resolved, setResolved] = useState(false);
  const [joinRecord, setJoinRecord] = useState<JoinRecord | null>(null);
  const [joinOpen, setJoinOpen] = useState(false);
  const [pickedFaction, setPickedFaction] = useState<string | null>(null);
  const [invite, setInvite] = useState<Invite>(null);
  const [inviteNeedsLogin, setInviteNeedsLogin] = useState(false);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [submitUrl, setSubmitUrl] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitDone, setSubmitDone] = useState(false);
  const [inviteEvents, setInviteEvents] = useState<InviteEvent[]>([]);
  const [customFactions, setCustomFactions] = useState<CustomFaction[]>([]);
  const [customName, setCustomName] = useState("");
  const [customError, setCustomError] = useState<string | null>(null);

  // 本机创建的活动只存在 localStorage 里，挂载后再查一次；
  // 邀请链接 ?invite=<阵营>&by=<用户名> 也在此时解析。
  // setState 放进回调，与 scene.tsx 一样避开 set-state-in-effect。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const found = findActivityBySlug(slug, DEMO_ACTIVITIES);
      setActivity(found);
      setJoinRecord(found ? loadJoin(found.id) : null);
      setSubmissions(found ? loadActivitySubmissions(found.id) : []);
      setSubmitUrl("");
      setSubmitError(null);
      setSubmitDone(false);
      setInviteEvents(loadInviteEvents());
      setCustomFactions(loadCustomFactions());
      setPickedFaction(null);
      const params = new URLSearchParams(window.location.search);
      const inviteFaction = params.get("invite");
      const by = params.get("by");
      if (inviteFaction && by && factionById(inviteFaction) && found) {
        setInvite({ factionId: inviteFaction, by });
      } else {
        setInvite(null);
      }
      setResolved(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/session");
        const data = (await response.json()) as AccountState;
        if (!cancelled) setAccount(data);
      } catch {
        /* 未登录时保持 null，不影响自由报名 */
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!activity) {
    return (
      <main className="detail-page">
        <SiteHeader />
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
  const submissionTypeLabels = submissionLabels(activity.submissionTypes);
  const hasPrize = activity.awardsEnabled && activity.prizePool > 0;
  const shares = factionShares(getContribution(activity.id), hasPrize ? activity.prizePool : 0);
  const contributionTotal = shares.reduce((sum, row) => sum + row.points, 0);
  const joinFaction = joinRecord ? factionById(joinRecord.factionId) : undefined;
  const accountName = account?.user?.name ?? account?.user?.email ?? "本机数字市民";
  const settledLeaders = settleFactionLeaders(inviteEvents, activity.id);
  const myInvites = joinRecord ? inviteCount(inviteEvents, activity.id, joinRecord.factionId, accountName) : 0;
  const activityEnded = activity.endsAt ? new Date(activity.endsAt) < new Date() : false;

  function confirmJoin() {
    if (!activity || !pickedFaction) return;
    setJoinRecord(saveJoin(activity.id, pickedFaction));
    setPickedFaction(null);
    setJoinOpen(false);
  }

  /** 校验并注册自建阵营：名字需包含杭州地标，通过后直接选中。 */
  function createCustomAndPick() {
    const existing = [...FACTIONS.map((faction) => faction.name), ...customFactions.map((faction) => faction.name)];
    const error = validateCustomFactionName(customName, existing);
    if (error) {
      setCustomError(error);
      return;
    }
    const faction = createCustomFaction(customName);
    setCustomFactions([...customFactions, faction]);
    setPickedFaction(faction.id);
    setCustomName("");
    setCustomError(null);
  }

  /** 被邀请者接受邀请：需先登录，接受后只能加入邀请人所在阵营，双方各得贡献值激励。 */
  async function acceptInvite() {
    if (!activity || !invite || invite === "refused") return;
    if (!account?.user) {
      try {
        const response = await fetch("/api/session");
        const data = (await response.json()) as AccountState;
        setAccount(data);
        if (!data.user) {
          setInviteNeedsLogin(true);
          return;
        }
      } catch {
        setInviteNeedsLogin(true);
        return;
      }
    }
    setJoinRecord(saveJoin(activity.id, invite.factionId, { invitedBy: invite.by }));
    setInviteEvents(recordInviteEvent({
      activityId: activity.id,
      factionId: invite.factionId,
      inviter: invite.by,
      invitee: accountName,
      at: new Date().toISOString(),
    }));
    setInvite(null);
    setInviteNeedsLogin(false);
  }

  function copyInviteLink(link: string) {
    const done = () => {
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 2000);
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(link).then(done, () => {
        if (legacyCopy(link)) done();
      });
    } else if (legacyCopy(link)) {
      done();
    }
  }

  /** 提交抖音视频分享链接；校验不过时行内报错，过了才写入本机记录。 */
  function submitWork() {
    if (!activity) return;
    if (!isValidDouyinUrl(submitUrl)) {
      setSubmitError("请输入有效的抖音视频分享链接，如 https://v.douyin.com/xxxx 或 https://www.douyin.com/video/数字ID");
      return;
    }
    setSubmissions(addSubmission(activity.id, submitUrl));
    setSubmitUrl("");
    setSubmitError(null);
    setSubmitDone(true);
    window.setTimeout(() => setSubmitDone(false), 2500);
  }

  return (
    <main className="detail-page">
      <SiteHeader />
      <div className="detail-top-tags"><span className="detail-top-note">{isDemo ? "演示数据 · 非真实活动" : "本机创建 · 未同步到服务器"}</span></div>

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
        {activity.contact && <p className="detail-contact">联系方式 · {activity.contact}</p>}
      </section>

      {invite && invite !== "refused" && !joinRecord && (() => {
        const faction = factionById(invite.factionId);
        if (!faction) return null;
        return (
          <div className="invite-banner" role="region" aria-label="阵营邀请">
            <p className="invite-banner-title">
              <strong>{invite.by}</strong> 邀请你加入 <strong style={{ color: faction.color }}>{faction.name}</strong> 阵营
            </p>
            <p className="invite-banner-sub">
              接受后将直接加入该阵营，阵营在本活动中锁定、不可更改；你和 {invite.by} 都将获得 +{MECHANISM.invite.inviteeBonus} / +{MECHANISM.invite.inviterBonus} 贡献值激励。
              也可以拒绝邀请，之后仍可自由报名。
            </p>
            {inviteNeedsLogin ? (
              <div className="invite-login">
                <p>请先登录后再接受邀请：</p>
                <div className="provider-list">
                  {(account?.providers ?? []).map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      className="provider-button"
                      disabled={!account?.configured || !provider.configured}
                      onClick={() => void signIn(provider.id, { callbackUrl: window.location.href })}
                    >
                      <span>使用 {provider.name} 登录</span>
                      {!provider.configured && <span className="provider-state">未配置</span>}
                    </button>
                  ))}
                </div>
                <button type="button" className="invite-refuse invite-refuse-quiet" onClick={() => { setInvite("refused"); setInviteNeedsLogin(false); }}>拒绝邀请</button>
                {!account?.configured && (
                  <p className="invite-banner-sub">本环境未配置登录；线上 hangkathon.net 已可通过 GitHub / Google 登录。</p>
                )}
              </div>
            ) : (
              <div className="invite-banner-actions">
                <button type="button" className="invite-accept" onClick={() => void acceptInvite()}>加入{faction.name}</button>
                <button type="button" className="invite-refuse" onClick={() => { setInvite("refused"); setInviteNeedsLogin(false); }}>拒绝</button>
              </div>
            )}
          </div>
        );
      })()}

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
                <FactionPanel
                  slices={shares.map((row) => ({
                    id: row.faction.id,
                    label: row.faction.name,
                    value: row.points,
                    color: row.faction.color,
                  }))}
                  rows={shares.map((row) => ({
                    id: row.faction.id,
                    name: row.faction.name,
                    color: row.faction.color,
                    points: row.points,
                    share: row.share,
                    prize: row.prize,
                  }))}
                  centerValue={contributionTotal.toLocaleString("zh-CN")}
                  hasPrize={hasPrize}
                />
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

          <section className="detail-section" aria-labelledby="detail-leaders">
            <p className="detail-eyebrow">LEADERS</p>
            <h2 id="detail-leaders">数字区长结算</h2>
            {activityEnded ? (
              Object.keys(settledLeaders).length > 0 ? (
                <>
                  <div className="leader-board">
                    {Object.entries(settledLeaders).map(([factionId, standing]) => {
                      const faction = factionById(factionId);
                      if (!faction) return null;
                      return (
                        <div className="leader-board-row" key={factionId}>
                          <span className="join-badge-dot" style={{ background: faction.color }} />
                          <strong>{faction.name}</strong>
                          <span className="leader-board-name">{standing.name}</span>
                          <span>邀请 {standing.invites} 人</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="detail-placeholder">
                    以上为本场活动各阵营的数字区长（成功邀请人数最多，并列时以最早受邀加入者胜）。区长个人贡献值额外 +{Math.round(MECHANISM.leaderBonusPct * 100)}%，结算时计入。
                  </p>
                </>
              ) : (
                <p className="detail-placeholder">本场活动没有受邀加入记录，各阵营暂无结算区长。</p>
              )
            ) : (
              <p className="detail-placeholder">
                活动期间任何报名成员都可分享邀请链接，对方接受加入后双方各得 +{MECHANISM.invite.inviteeBonus} / +{MECHANISM.invite.inviterBonus} 贡献值。
                活动结束（{activity.endsAt || "日期待定"}）后，各阵营成功邀请人数最多的成员将结算为数字区长，区长个人贡献值额外 +{Math.round(MECHANISM.leaderBonusPct * 100)}%。
              </p>
            )}
          </section>

          {submissionTypeLabels.length > 0 && (
            <section className="detail-section" aria-labelledby="detail-submissions">
              <p className="detail-eyebrow">SUBMISSION</p>
              <h2 id="detail-submissions">提交形式</h2>
              <div className="detail-chips">
                {submissionTypeLabels.map((label) => <span key={label}>{label}</span>)}
              </div>
            </section>
          )}

          {activity.submissionTypes.includes("video") && (
            <section className="detail-section" aria-labelledby="detail-submit">
              <p className="detail-eyebrow">SUBMISSIONS</p>
              <h2 id="detail-submit">作品提交</h2>
              {joinRecord ? (
                <>
                  <form className="submit-form" onSubmit={(event) => { event.preventDefault(); submitWork(); }}>
                    <input
                      type="text"
                      inputMode="url"
                      className="submit-input"
                      placeholder="粘贴抖音视频分享链接，如 https://v.douyin.com/…"
                      value={submitUrl}
                      aria-label="抖音视频分享链接"
                      aria-invalid={submitError ? true : undefined}
                      onChange={(event) => {
                        setSubmitUrl(event.target.value);
                        if (submitError) setSubmitError(null);
                      }}
                    />
                    <Button type="submit" className="primary-action">提交作品</Button>
                  </form>
                  {submitError && <p className="submit-error" role="alert">{submitError}</p>}
                  {submitDone && (
                    <p className="submit-ok">已提交。作品将在 {MECHANISM.review.hours} 小时内审核，按质量计入你的个人与阵营贡献值。</p>
                  )}
                  {submissions.length > 0 ? (
                    <ul className="submit-list">
                      {submissions.map((record, index) => (
                        <li key={`${record.submittedAt}-${index}`}>
                          <a href={record.url} target="_blank" rel="noopener noreferrer">{shortenUrl(record.url)}</a>
                          <span>{new Date(record.submittedAt).toLocaleString("zh-CN")}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="detail-placeholder">还没有提交过作品。可以反复提交，每次提交都会进入审核队列。</p>
                  )}
                  <p className="detail-join-note">演示环境：提交记录保存在这台设备的浏览器里。</p>
                </>
              ) : (
                <>
                  <p className="detail-placeholder">报名并选择阵营后，即可在这里提交抖音视频分享链接作为参赛作品。</p>
                  <Button className="primary-action" onClick={() => setJoinOpen(true)}>报名参加</Button>
                </>
              )}
            </section>
          )}
        </div>

        <aside className="detail-side" aria-label="活动关键信息">
          <div className="detail-facts">
            <h2>关键信息</h2>
            <dl>
              <div><dt><CalendarDays size={14} />时间</dt><dd>{activity.startsAt && activity.endsAt ? `${activity.startsAt} 至 ${activity.endsAt}` : "待定"}</dd></div>
              <div><dt><MapPin size={14} />地点</dt><dd>{activity.format === "offline" ? activity.venue || "待定" : "线上"}</dd></div>
              <div><dt><Coins size={14} />奖金</dt><dd>{prizeText(activity)}</dd></div>
              <div><dt>费用</dt><dd>{activity.pricing === "paid" ? activity.fee || "收费" : "免费"}</dd></div>
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
              {joinRecord.invitedBy && (
                <p className="join-invitedby">由 {joinRecord.invitedBy} 的邀请链接加入 · 邀请激励 +{MECHANISM.invite.inviteeBonus} 贡献值</p>
              )}
              <div className="leader-invite">
                <p className="leader-invite-title">邀请链接 · 活动期间随时可邀请</p>
                {typeof window !== "undefined" && (
                  <div className="leader-invite-row">
                    <code>{
                      `${window.location.origin}/activities/${activity.slug}?invite=${joinRecord.factionId}&by=${encodeURIComponent(accountName)}`
                    }</code>
                    <button type="button" onClick={() => copyInviteLink(
                      `${window.location.origin}/activities/${activity.slug}?invite=${joinRecord.factionId}&by=${encodeURIComponent(accountName)}`,
                    )}>{inviteCopied ? "已复制" : "复制"}</button>
                  </div>
                )}
                <p className="leader-invite-note">
                  任何报名成员都可分享。打开链接的数字市民接受后加入你的阵营（需登录，阵营锁定）；对方 +{MECHANISM.invite.inviteeBonus}、你 +{MECHANISM.invite.inviterBonus} 贡献值。
                  你已邀请 {myInvites} 人 · 累计 +{myInvites * MECHANISM.invite.inviterBonus} 贡献值。活动结束时邀请人数最多的成员即为本阵营数字区长。
                </p>
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
                报名后进入阵营选择阶段，从杭州 13 个县级行政区中选一个阵营出战（本活动中锁定不可更改），正式阶段每天领取算力券。
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
            报名后进入阵营选择阶段：从杭州 13 个县级行政区中选择一个阵营，与同阵营数字市民一起为它出战。阵营贡献值 = 阵营成员个人贡献值之和。
          </DialogDescription>
          <div className="join-factions" role="radiogroup" aria-label="选择阵营">
            {[...FACTIONS, ...customFactions].map((faction) => (
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
          <div className="join-custom">
            <p className="join-custom-title">找不到心仪阵营？自建一个——名称需包含杭州地标（西湖、断桥、钱塘江、良渚……）</p>
            <div className="join-custom-row">
              <input
                type="text"
                className="join-custom-input"
                placeholder="例如：西湖侠客"
                value={customName}
                aria-label="自建阵营名称"
                aria-invalid={customError ? true : undefined}
                onChange={(event) => {
                  setCustomName(event.target.value);
                  if (customError) setCustomError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    createCustomAndPick();
                  }
                }}
              />
              <button type="button" className="join-custom-create" disabled={!customName.trim()} onClick={createCustomAndPick}>
                创建并选中
              </button>
            </div>
            {customError && <p className="join-custom-error" role="alert">{customError}</p>}
          </div>
          <p className="join-lock-note">阵营在本活动中锁定，确认后无法更改。</p>
          <p className="join-leader-note">
            报名后随时可分享邀请链接；对方接受加入后双方各得 +{MECHANISM.invite.inviteeBonus} / +{MECHANISM.invite.inviterBonus} 贡献值。
            活动结束时邀请人数最多的成员将结算为本阵营数字区长，区长个人贡献值额外 +{Math.round(MECHANISM.leaderBonusPct * 100)}%。
          </p>
          <Button className="dialog-done" disabled={!pickedFaction} onClick={confirmJoin}>
            确认报名
          </Button>
        </DialogContent>
      </Dialog>
    </main>
  );
}
