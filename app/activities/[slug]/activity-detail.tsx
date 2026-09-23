"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { ArrowRight, CalendarDays, Coins, MapPin } from "lucide-react";
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
import { PUBLISHED_ACTIVITIES } from "@/lib/published-activities";
import { factionById } from "@/lib/factions";
import FactionPanel from "../../faction-panel";
import SiteHeader from "../../site-header";
import { revealOnce, usePageMotion } from "../../motion-scope";
import {
  MECHANISM,
  getContribution,
  loadJoin,
  saveJoin,
  teamByCaptain,
  teamShares,
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

type Invite = { factionId: string; teamId?: string; by: string } | "refused" | null;

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
  const [invite, setInvite] = useState<Invite>(null);
  const [inviteNeedsLogin, setInviteNeedsLogin] = useState(false);
  const [account, setAccount] = useState<AccountState | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [submissions, setSubmissions] = useState<SubmissionRecord[]>([]);
  const [submitUrl, setSubmitUrl] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitDone, setSubmitDone] = useState(false);
  const [inviteEvents, setInviteEvents] = useState<InviteEvent[]>([]);

  // 入场动效：标签行 → 标题 → 各区块依次淡入上移。活动数据要等 effect 读出来再播。
  usePageMotion("detail", { ready: Boolean(activity) });

  /** 新提交的一条单独入场，不动整段列表。 */
  const submitListRef = useRef<HTMLUListElement | null>(null);
  const pendingReveal = useRef(false);

  useLayoutEffect(() => {
    if (!pendingReveal.current) return;
    pendingReveal.current = false;
    const last = submitListRef.current?.lastElementChild;
    if (last instanceof HTMLElement) revealOnce(last);
  }, [submissions]);

  // 本机创建的活动只存在 localStorage 里，挂载后再查一次；
  // 邀请链接 ?invite=<阵营>&by=<用户名> 也在此时解析。
  // setState 放进回调，与 scene.tsx 一样避开 set-state-in-effect。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const found = findActivityBySlug(slug, PUBLISHED_ACTIVITIES);
      setActivity(found);
      setJoinRecord(found ? loadJoin(found.id) : null);
      setSubmissions(found ? loadActivitySubmissions(found.id) : []);
      setSubmitUrl("");
      setSubmitError(null);
      setSubmitDone(false);
      setInviteEvents(loadInviteEvents());
      const params = new URLSearchParams(window.location.search);
      const inviteDistrict = params.get("invite");
      const by = params.get("by");
      const inviteTeam = params.get("team");
      // 邀请链接由战队队长生成：?invite=<区id>&by=<名字>&team=<战队id>
      const team = inviteTeam && found
        ? (getContribution(found.id)?.teams ?? []).find((item) => item.id === inviteTeam)
        : undefined;
      if (inviteDistrict && by && factionById(inviteDistrict) && found) {
        setInvite({ factionId: inviteDistrict, teamId: team?.id, by });
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

  const isLocalActivity = activity.id.startsWith("a_");
  const submissionTypeLabels = submissionLabels(activity.submissionTypes);
  const hasPrize = activity.awardsEnabled && activity.prizePool > 0;
  const shares = teamShares(getContribution(activity.id), hasPrize ? activity.prizePool : 0);
  const contributionTotal = shares.reduce((sum, row) => sum + row.points, 0);
  const accountName = account?.user?.name ?? account?.user?.email ?? "本机数字市民";
  const district = factionById(activity.district);
  const activityTeams = getContribution(activity.id)?.teams ?? [];
  // 只有战队的队长可以邀请用户加入战队
  const myTeam = teamByCaptain(activityTeams, accountName);
  const settledLeaders = settleFactionLeaders(inviteEvents, activity.id);
  const districtLeader = district ? settledLeaders[district.id] : undefined;
  const myInvites = inviteCount(inviteEvents, activity.id, activity.district, accountName);
  const activityEnded = activity.endsAt ? new Date(activity.endsAt) < new Date() : false;

  /** 个人参赛：无需选择阵营，点击即报名。 */
  function confirmJoin() {
    if (!activity) return;
    setJoinRecord(saveJoin(activity.id));
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
    setJoinRecord(saveJoin(activity.id, { invitedBy: invite.by }));
    setInviteEvents(recordInviteEvent({
      activityId: activity.id,
      factionId: activity.district,
      teamId: invite.teamId,
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
    pendingReveal.current = true;
    setSubmissions(addSubmission(activity.id, submitUrl));
    setSubmitUrl("");
    setSubmitError(null);
    setSubmitDone(true);
    window.setTimeout(() => setSubmitDone(false), 2500);
  }

  return (
    <main className="detail-page">
      <SiteHeader />
      <div className="detail-top-tags" data-reveal="block">{isLocalActivity && <span className="detail-top-note">仅保存在此设备</span>}</div>

      <section className="detail-hero">
        <div className="detail-tags" data-reveal="block">
          <span className="is-category">{categoryLabel(activity.category)}</span>
          {district && <span style={{ borderColor: `${district.color}55`, color: district.color }}>{district.name}</span>}
          <span>{formatLabel(activity)}</span>
          <span>{pricingLabel(activity)}</span>
          <span>{visibilityLabel(activity.visibility)}</span>
        </div>
        <h1 data-reveal="block">{activity.title}</h1>
        {activity.subtitle && <p className="detail-sub" data-reveal="block">{activity.subtitle}</p>}
        <p className="detail-host" data-reveal="block">主办方 · {activity.host || "未填写"}</p>
        {activity.contact && <p className="detail-contact" data-reveal="block">联系方式 · {activity.contact}</p>}
      </section>

      {invite && invite !== "refused" && !joinRecord && (() => {
        const inviteDistrict = factionById(invite.factionId);
        if (!inviteDistrict) return null;
        const inviteTeam = invite.teamId ? activityTeams.find((team) => team.id === invite.teamId) : undefined;
        return (
          <div className="invite-banner" role="region" aria-label="战队邀请" data-reveal="block">
            <p className="invite-banner-title">
              <strong>{invite.by}</strong> {inviteTeam ? <>邀请你加入 <strong style={{ color: inviteTeam.color }}>{inviteTeam.name}</strong> 战队</> : "邀请你"} 一起参加这场活动
              {district ? <>（所属区 · <strong style={{ color: inviteDistrict.color }}>{inviteDistrict.name}</strong>）</> : null}
            </p>
            <p className="invite-banner-sub">
              接受后你将加入{inviteTeam ? `${inviteTeam.name} 战队、` : ""}以个人账户报名本场活动；你和 {invite.by} 都将获得 +{MECHANISM.invite.inviteeBonus} / +{MECHANISM.invite.inviterBonus} 贡献值激励。
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
                <button type="button" className="invite-accept" onClick={() => void acceptInvite()}>接受邀请</button>
                <button type="button" className="invite-refuse" onClick={() => { setInvite("refused"); setInviteNeedsLogin(false); }}>拒绝</button>
              </div>
            )}
          </div>
        );
      })()}

      <div className="detail-body">
        <div className="detail-main">
          <section data-reveal="block" className="detail-section" aria-labelledby="detail-overview">
            <p className="detail-eyebrow">OVERVIEW</p>
            <h2 id="detail-overview">活动介绍</h2>
            {activity.overview ? (
              <p className="detail-text">{activity.overview}</p>
            ) : (
              <p className="detail-placeholder">主办方还没有填写详细介绍。</p>
            )}
          </section>

          <section data-reveal="block" className="detail-section" aria-labelledby="detail-criteria">
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

          <section data-reveal="block" className="detail-section" aria-labelledby="detail-awards">
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

          <section data-reveal="block" className="detail-section" aria-labelledby="detail-factions">
            <p className="detail-eyebrow">TEAMS</p>
            <h2 id="detail-factions">战队贡献</h2>
            {shares.length > 0 ? (
              <>
                <FactionPanel
                  slices={shares.map((row) => ({
                    id: row.team.id,
                    label: row.team.name,
                    value: row.points,
                    color: row.team.color,
                  }))}
                  rows={shares.map((row) => ({
                    id: row.team.id,
                    name: row.team.name,
                    color: row.team.color,
                    points: row.points,
                    share: row.share,
                    prize: row.prize,
                  }))}
                  centerValue={contributionTotal.toLocaleString("zh-CN")}
                  hasPrize={hasPrize}
                  nameLabel="战队"
                />
                <p className="detail-placeholder">
                  {hasPrize
                    ? "奖金按战队贡献占比及战队内个人贡献占比分配。"
                    : "这场活动不设奖金，战队贡献只累计荣誉。"}
                </p>
              </>
            ) : (
              <p className="detail-placeholder">
                还没有战队贡献数据。报名开始后，各战队的贡献值将在这里实时汇总（战队贡献 = 战队成员个人贡献之和）。
              </p>
            )}
          </section>

      {district && activityEnded && (
        <section data-reveal="block" className="detail-section" aria-labelledby="detail-leaders">
          <p className="detail-eyebrow">DISTRICT LEADER</p>
          <h2 id="detail-leaders">所属区区长结算</h2>
          {districtLeader ? (
            <>
              <div className="leader-board">
                <div className="leader-board-row">
                  <span className="join-badge-dot" style={{ background: district.color }} />
                  <strong>{district.name}</strong>
                  <span className="leader-board-name">{districtLeader.name}</span>
                  <span>邀请 {districtLeader.invites} 人</span>
                </div>
              </div>
              <p className="detail-placeholder">
                成功邀请人数最多者结算为本场活动所属区的区长；并列时以最早受邀加入者胜。个人贡献值额外 +{Math.round(MECHANISM.leaderBonusPct * 100)}%。
              </p>
            </>
          ) : (
            <p className="detail-placeholder">本场活动没有受邀报名记录，所属区（{district.name}）暂无区长。</p>
          )}
        </section>
      )}

          {submissionTypeLabels.length > 0 && (
            <section data-reveal="block" className="detail-section" aria-labelledby="detail-submissions">
              <p className="detail-eyebrow">SUBMISSION</p>
              <h2 id="detail-submissions">提交形式</h2>
              <div className="detail-chips">
                {submissionTypeLabels.map((label) => <span key={label}>{label}</span>)}
              </div>
            </section>
          )}

          {activity.submissionTypes.includes("video") && (
            <section data-reveal="block" className="detail-section" aria-labelledby="detail-submit">
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
                    <ul className="submit-list" ref={submitListRef}>
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
                  <p className="detail-join-note">提交记录保存在此设备。</p>
                </>
              ) : (
                <>
                  <p className="detail-placeholder">报名参赛后，即可在这里提交抖音视频分享链接作为参赛作品。</p>
                  <Button className="primary-action" onClick={confirmJoin}>报名参赛</Button>
                </>
              )}
            </section>
          )}
        </div>

        <aside className="detail-side" aria-label="活动关键信息">
          <div className="detail-facts" data-reveal="block">
            <h2>关键信息</h2>
            <dl>
              <div><dt><CalendarDays size={14} />时间</dt><dd>{activity.startsAt && activity.endsAt ? `${activity.startsAt} 至 ${activity.endsAt}` : "待定"}</dd></div>
              <div><dt>所属区</dt><dd>{district ? <span className="fact-district"><i style={{ background: district.color }} />{district.name}</span> : "未设置"}</dd></div>
              <div><dt><MapPin size={14} />地点</dt><dd>{activity.format === "offline" ? activity.venue || "待定" : "线上"}</dd></div>
              <div><dt><Coins size={14} />奖金</dt><dd>{prizeText(activity)}</dd></div>
              <div><dt>费用</dt><dd>{activity.pricing === "paid" ? activity.fee || "收费" : "免费"}</dd></div>
              <div><dt>报名</dt><dd>{joinPolicyLabel(activity)}</dd></div>
              <div><dt>活动代号</dt><dd>{activity.slug}</dd></div>
            </dl>
          </div>

          {joinRecord ? (
            <div className="detail-join">
              <p className="detail-join-title">已报名 · 个人参赛</p>
              <div className="join-badge">
                <span className="join-badge-dot" />
                个人参赛
              </div>
              {district && (
                <p className="join-district">本场活动所属区 · <i style={{ background: district.color }} />{district.name}</p>
              )}
              {joinRecord.invitedBy && (
                <p className="join-invitedby">由 {joinRecord.invitedBy} 邀请报名 · 获得 +{MECHANISM.invite.inviteeBonus} 贡献值</p>
              )}
              {myTeam && (
                <div className="leader-invite">
                  <p className="leader-invite-title">邀请链接 · 你是「{myTeam.name}」队长，活动期间随时可邀请新队员</p>
                  {typeof window !== "undefined" && (
                    <div className="leader-invite-row">
                      <code>{`${window.location.origin}/activities/${activity.slug}?invite=${activity.district}&by=${encodeURIComponent(accountName)}&team=${myTeam.id}`}</code>
                      <button type="button" onClick={() => copyInviteLink(
                        `${window.location.origin}/activities/${activity.slug}?invite=${activity.district}&by=${encodeURIComponent(accountName)}&team=${myTeam.id}`,
                      )}>{inviteCopied ? "已复制" : "复制"}</button>
                    </div>
                  )}
                  <p className="leader-invite-note">
                    只有战队队长可以邀请用户加入战队。打开链接的数字市民接受后加入你的战队、以个人账户报名本场活动（需登录）；对方 +{MECHANISM.invite.inviteeBonus}、你 +{MECHANISM.invite.inviterBonus} 贡献值。
                    你已邀请 {myInvites} 人 · 累计 +{myInvites * MECHANISM.invite.inviterBonus} 贡献值。活动结束时邀请人数最多的成员即结算为本活动所属区的数字区长。
                  </p>
                </div>
              )}
              <ul className="join-rules">
                <li>正式阶段每天发 ¥{MECHANISM.voucher.base} 算力券，当日有效</li>
                <li>算力券面额上限为 ¥{MECHANISM.voucher.dailyCap}/天</li>
                <li>产出物 {MECHANISM.review.hours} 小时内审核，按质量计入个人贡献值</li>
                <li>以个人账户参赛，无需选择阵营；战队由平台统一组织</li>
              </ul>
              <p className="detail-join-note">报名记录保存在此设备。贡献值将在平台支持后累计。</p>
            </div>
          ) : (
            <div className="detail-join">
              <p className="detail-join-title">想参加这场活动？</p>
              <Button className="primary-action" onClick={confirmJoin}>报名参赛</Button>
              <p className="detail-join-note">
                以个人账户报名参赛，无需选择阵营，正式阶段每天领取算力券。战队由平台统一组织。
                {isLocalActivity ? "活动记录保存在此设备。" : ""}
              </p>
            </div>
          )}
        </aside>
      </div>

    </main>
  );
}
