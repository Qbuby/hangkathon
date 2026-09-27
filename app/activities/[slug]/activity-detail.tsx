"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { ArrowRight, CalendarDays, Coins, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  categoryLabel,
  joinPolicyLabel,
  judgingLabel,
  prizeText,
  submissionLabels,
  type Activity,
} from "@/lib/activity";
import { factionById } from "@/lib/factions";
import SiteHeader from "../../site-header";
import { revealOnce, usePageMotion } from "../../motion-scope";
import {
  MECHANISM,
  getContribution,
  teamByCaptain,
  type JoinRecord,
} from "@/lib/contribution";
import {
  inviteCount,
  type InviteEvent,
} from "@/lib/invites";
import { isValidDouyinUrl, type SubmissionRecord } from "@/lib/submission";
import {
  getActivity,
  joinActivity,
  listMyInviteEvents,
  listMySubmissions,
  recordInvite,
  refreshSubmission,
  submitWork as submitWorkRemote,
} from "@/lib/api/data";
import { hasServerData } from "@/lib/api/client";
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

/** 抖音的互动数动辄六位，用「万」比一串数字好读。 */
function formatCount(value: number): string {
  return value >= 10000 ? `${(value / 10000).toFixed(1)}万` : String(value);
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
  const [joinError, setJoinError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** 正在刷新的那条作品链接（一次只刷一条，按钮上转圈用）。 */
  const [refreshingUrl, setRefreshingUrl] = useState<string | null>(null);
  const [mode, setMode] = useState<"local" | "server">("local");

  // 入场动效：标签行 → 标题 → 各区块依次淡入上移。活动数据要等 effect 读出来再播。
  usePageMotion("detail", { ready: Boolean(activity) });

  useEffect(() => {
    void hasServerData().then((server) => setMode(server ? "server" : "local"));
  }, []);

  /** 新提交的一条单独入场，不动整段列表。 */
  const submitListRef = useRef<HTMLUListElement | null>(null);
  const pendingReveal = useRef(false);

  useLayoutEffect(() => {
    if (!pendingReveal.current) return;
    pendingReveal.current = false;
    const last = submitListRef.current?.lastElementChild;
    if (last instanceof HTMLElement) revealOnce(last);
  }, [submissions]);

  // 活动详情按数据模式取：有数据库走 /api/activities/<slug>（含报名状态），否则读本机。
  // 邀请链接 ?invite=<阵营>&by=<用户名> 也在这里解析。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const detail = await getActivity(slug);
      if (cancelled) return;
      const found = detail?.activity ?? null;
      setActivity(found);
      setJoinRecord(detail?.joined ? { joinedAt: detail.joinedAt ?? new Date().toISOString() } : null);
      setSubmissions(found ? await listMySubmissions(found) : []);
      if (cancelled) return;
      setSubmitUrl("");
      setSubmitError(null);
      setSubmitDone(false);
      setInviteEvents(await listMyInviteEvents());
      if (cancelled) return;
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
    })().catch(() => {
      if (!cancelled) {
        setActivity(null);
        setResolved(true);
      }
    });
    return () => {
      cancelled = true;
    };
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
            <Button asChild className="primary-action"><Link href="/#activities">返回活动列表 <ArrowRight size={17} /></Link></Button>
          </div>
        </div>
      </main>
    );
  }

  const isLocalActivity = mode === "local" && activity.id.startsWith("a_");
  const submissionTypeLabels = submissionLabels(activity.submissionTypes);
  const accountName = account?.user?.name ?? account?.user?.email ?? "本机数字市民";
  const district = factionById(activity.district);
  const activityTeams = getContribution(activity.id)?.teams ?? [];
  // 只有战队的队长可以邀请用户加入战队
  const myTeam = teamByCaptain(activityTeams, accountName);
  const myInvites = inviteCount(inviteEvents, activity.id, activity.district, accountName);

  /** 个人参赛：点击即报名。服务端模式需要先登录。 */
  async function confirmJoin() {
    if (!activity) return;
    if (mode === "server" && !account?.user) {
      setJoinError("这个部署把报名记录存在服务端，请先用右上角入口登录，再回来报名。");
      return;
    }
    setJoinError(null);
    try {
      await joinActivity(activity, invite && invite !== "refused" ? invite.by : undefined);
      setJoinRecord({ joinedAt: new Date().toISOString() });
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : "报名失败，请稍后重试。");
    }
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
    try {
      await joinActivity(activity, invite.by);
      await recordInvite({
        activityId: activity.id,
        factionId: activity.district,
        teamId: invite.teamId,
        inviter: invite.by,
        invitee: accountName,
        at: new Date().toISOString(),
      });
      setJoinRecord({ joinedAt: new Date().toISOString() });
      setInviteEvents(await listMyInviteEvents());
      setInvite(null);
      setInviteNeedsLogin(false);
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : "接受邀请失败，请稍后重试。");
    }
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

  /** 提交抖音视频分享链接；校验不过时行内报错，过了才写入记录。服务端模式需要先登录。 */
  async function submitWork() {
    if (!activity) return;
    if (mode === "server" && !account?.user) {
      setSubmitError("这个部署把作品记录存在服务端，请先用右上角入口登录，再回来提交。");
      return;
    }
    if (!isValidDouyinUrl(submitUrl)) {
      setSubmitError("请输入有效的抖音视频分享链接，如 https://v.douyin.com/xxxx 或 https://www.douyin.com/video/数字ID");
      return;
    }
    setSubmitting(true);
    try {
      await submitWorkRemote(activity, submitUrl);
      pendingReveal.current = true;
      setSubmissions(await listMySubmissions(activity));
      setSubmitUrl("");
      setSubmitError(null);
      setSubmitDone(true);
      window.setTimeout(() => setSubmitDone(false), 2500);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "提交失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  /** 刷新一条作品的数据。抖音的数字会变，所以给手动按钮而不是轮询。 */
  async function refreshWork(url: string) {
    if (!activity || refreshingUrl) return;
    setRefreshingUrl(url);
    try {
      setSubmissions(await refreshSubmission(activity, url));
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "刷新失败，请稍后重试。");
    } finally {
      setRefreshingUrl(null);
    }
  }

  return (
    <main className="detail-page">
      <SiteHeader />
      <div className="detail-top-tags" data-reveal="block">{isLocalActivity && <span className="detail-top-note">仅保存在此设备</span>}</div>

      <section className="detail-hero">
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
            <p className="detail-eyebrow">WHAT YOU DO</p>
            <h2 id="detail-overview">你要做什么</h2>
            {activity.overview ? (
              <p className="detail-text">{activity.overview}</p>
            ) : (
              <p className="detail-placeholder">主办方还没有填写任务说明。可以先报名，任务公布后再开工。</p>
            )}
          </section>

          <section data-reveal="block" className="detail-section" aria-labelledby="detail-how">
            <p className="detail-eyebrow">HOW TO JOIN</p>
            <h2 id="detail-how">怎么参加</h2>
            <ol className="detail-steps">
              <li>
                <strong>报名参赛</strong>
                <span>点「报名参赛」按钮，个人一键参加</span>
              </li>
              <li>
                <strong>完成作品或任务</strong>
                <span>照上面「你要做什么」的要求做即可</span>
              </li>
              <li>
                <strong>提交作品</strong>
                <span>报名后在下方「作品提交」粘贴抖音视频链接</span>
              </li>
              <li>
                <strong>获得荣誉</strong>
                <span>作品审核通过后累计贡献值，优秀作品赢得奖项</span>
              </li>
            </ol>
          </section>

          <section data-reveal="block" className="detail-section" aria-labelledby="detail-awards">
            <p className="detail-eyebrow">REWARDS</p>
            <h2 id="detail-awards">能获得什么</h2>
            {!activity.awardsEnabled || activity.awards.length === 0 ? (
              <p className="detail-placeholder">这场活动不设奖项（{prizeText(activity)}）；参加并完成作品，同样能积累贡献值与荣誉。</p>
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
                <p className="detail-placeholder">奖金总额：{prizeText(activity)}。奖项为荣誉头衔，现金在活动结算后按平台规则发放。</p>
              </>
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
                  <form className="submit-form" onSubmit={(event) => { event.preventDefault(); void submitWork(); }}>
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
                    <Button type="submit" className="primary-action" disabled={submitting}>
                      {submitting ? "提交中…" : "提交作品"}
                    </Button>
                  </form>
                  {submitError && <p className="submit-error" role="alert">{submitError}</p>}
                  {submitDone && (
                    <p className="submit-ok">已提交。作品将在 {MECHANISM.review.hours} 小时内审核，按质量计入你的贡献值。</p>
                  )}
                  {submissions.length > 0 ? (
                    <ul className="submit-list" ref={submitListRef}>
                      {submissions.map((record, index) => (
                        <li key={`${record.submittedAt}-${index}`}>
                          <div className="submit-head">
                            <a href={record.url} target="_blank" rel="noopener noreferrer">{shortenUrl(record.url)}</a>
                            <span>{new Date(record.submittedAt).toLocaleString("zh-CN")}</span>
                          </div>
                          {record.caption && (
                            <p className="submit-caption">
                              {record.authorName && <strong>{record.authorName}</strong>}
                              {record.caption}
                            </p>
                          )}
                          {(record.diggCount !== undefined || record.commentCount !== undefined) && (
                            <p className="submit-metrics">
                              {record.diggCount !== undefined && <span>点赞 <b>{formatCount(record.diggCount)}</b></span>}
                              {record.commentCount !== undefined && <span>评论 <b>{formatCount(record.commentCount)}</b></span>}
                              {record.shareCount !== undefined && <span>转发 <b>{formatCount(record.shareCount)}</b></span>}
                              {record.collectCount !== undefined && <span>收藏 <b>{formatCount(record.collectCount)}</b></span>}
                            </p>
                          )}
                          {mode === "server" && (
                            <p className="submit-foot">
                              <span>
                                {record.fetchedAt
                                  ? `数据抓取于 ${new Date(record.fetchedAt).toLocaleString("zh-CN")}`
                                  : record.metricsError ?? "还没有抓到作品数据"}
                              </span>
                              <button
                                type="button"
                                className="submit-refresh"
                                disabled={refreshingUrl !== null}
                                onClick={() => void refreshWork(record.url)}
                              >
                                {refreshingUrl === record.url ? "刷新中…" : "刷新数据"}
                              </button>
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="detail-placeholder">还没有提交过作品。可以反复提交，每次提交都会进入审核队列。</p>
                  )}
                  <p className="detail-join-note">
                    {mode === "server" ? "提交记录保存在平台，只有你自己能看到。" : "提交记录保存在此设备。"}
                  </p>
                </>
              ) : (
                <>
                  <p className="detail-placeholder">报名参赛后，即可在这里提交抖音视频分享链接作为参赛作品。</p>
                  <Button className="primary-action" onClick={() => void confirmJoin()}>报名参赛</Button>
                  {joinError && <p className="submit-error" role="alert">{joinError}</p>}
                </>
              )}
            </section>
          )}
        </div>

        <aside className="detail-side" aria-label="活动关键信息">
          <div className="detail-facts" data-reveal="block">
            <h2>关键信息</h2>
            <dl>
              <div><dt>类别</dt><dd>{categoryLabel(activity.category)}</dd></div>
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
              </ul>
              <p className="detail-join-note">
                {mode === "server"
                  ? "报名记录保存在平台。贡献值将在平台支持后累计。"
                  : "报名记录保存在此设备。贡献值将在平台支持后累计。"}
              </p>
            </div>
          ) : (
            <div className="detail-join">
              <p className="detail-join-title">想参加这场活动？</p>
              <Button className="primary-action" onClick={() => void confirmJoin()}>报名参赛</Button>
              {joinError && <p className="submit-error" role="alert">{joinError}</p>}
              <p className="detail-join-note">
                个人一键报名。报名后照着「怎么参加」四步走就行；正式阶段每天可领算力券。
                {isLocalActivity ? "活动记录保存在此设备。" : ""}
              </p>
            </div>
          )}
        </aside>
      </div>

    </main>
  );
}
