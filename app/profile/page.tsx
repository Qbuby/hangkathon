"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { ArrowLeft, ArrowRight, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HONOR_LEVELS, honorLevel, loadJoins, type JoinRecord } from "@/lib/contribution";
import { inviteCount, loadInviteEvents, type InviteEvent } from "@/lib/invites";
import { factionById } from "@/lib/factions";
import { loadActivities, type Activity } from "@/lib/activity";
import { PUBLISHED_ACTIVITIES } from "@/lib/published-activities";
import { usePageMotion } from "../motion-scope";
import "../activities/[slug]/detail.css";
import "./profile.css";

type SessionState = {
  configured: boolean;
  providers: { id: string; name: string; configured: boolean }[];
  user: { name: string | null; email: string | null } | null;
};

export default function ProfilePage() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [joins, setJoins] = useState<Record<string, JoinRecord>>({});
  const [inviteEvents, setInviteEvents] = useState<InviteEvent[]>([]);

  // 入场动效：勋章区块与报名列表依次淡入上移。登录状态读回来之后再播。
  usePageMotion("profile", { ready: session !== null });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/session");
        const data = (await response.json()) as SessionState;
        if (!cancelled) setSession(data);
      } catch {
        if (!cancelled) setSession({ configured: false, providers: [], user: null });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // 报名记录在本机 localStorage，挂载后再读，避免 set-state-in-effect。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setJoins(loadJoins());
      setInviteEvents(loadInviteEvents());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const user = session?.user ?? null;
  const accountName = user?.name ?? user?.email ?? "本机数字市民";
  // 真实起点：平台贡献值从 0 开始累计（接入后端后由结算写入）。
  const points = 0;
  const level = honorLevel(points);
  const joinedRows = Object.entries(joins)
    .map(([activityId, record]) => {
      const activity: Activity | undefined = [...PUBLISHED_ACTIVITIES, ...loadActivities()].find(
        (item) => item.id === activityId,
      );
      // 参与者不再选阵营；行内展示活动所属区（发起方在发布时设定）。
      const district = activity ? factionById(activity.district) : undefined;
      return activity ? { activity, district, record } : null;
    })
    .filter((row): row is { activity: Activity; district: NonNullable<ReturnType<typeof factionById>> | undefined; record: JoinRecord } => row !== null);

  // 报名记录是本机数据，与登录状态无关，两种状态都展示。
  const joinsSection = (
    <section className="profile-joins" aria-labelledby="profile-joins-title">
      <p className="detail-eyebrow" data-reveal="block">ACTIVITIES</p>
      <h2 id="profile-joins-title" data-reveal="block">我的报名</h2>
      {joinedRows.length > 0 ? (
        <div className="profile-join-list">
          {joinedRows.map((row) => (
            <Link key={row.activity.id} className="profile-join-row" href={`/activities/${row.activity.slug}`} data-reveal="item">
              <span className="join-badge-dot" style={{ background: row.district?.color ?? "#5f7d99" }} />
              <strong>
                {row.activity.title}
                {inviteCount(inviteEvents, row.activity.id, row.activity.district, accountName) > 0 && (
                  <em className="profile-join-leader">已邀请 {inviteCount(inviteEvents, row.activity.id, row.activity.district, accountName)} 人</em>
                )}
              </strong>
              <span className="profile-join-faction" style={{ color: row.district?.color ?? "#8aa4bc" }}>{row.district?.name ?? "未设区"}</span>
              <span className="profile-join-date">{new Date(row.record.joinedAt).toLocaleDateString("zh-CN")}</span>
              <ArrowRight size={15} />
            </Link>
          ))}
        </div>
      ) : (
        <p className="detail-placeholder">
          还没有报名任何活动。<Link className="profile-link" href="/#activities">去活动看板看看</Link>。
        </p>
      )}
    </section>
  );

  return (
    <main className="detail-page profile-page">
      <header className="detail-top" data-reveal="block">
        <Link className="detail-back" href="/"><ArrowLeft size={17} /> 返回首页</Link>
        <span className="detail-top-title">个人主页</span>
        <span className="detail-top-note">{session === null ? "读取中" : user ? "已登录" : "未登录"}</span>
      </header>

      {session === null ? (
        <div className="profile-card" data-reveal="block">
          <p className="eyebrow">HONOR · 数字杭州市民</p>
          <h1>正在读取登录状态…</h1>
          <span className="session-placeholder" aria-hidden="true" />
        </div>
      ) : user ? (
        <div className="profile-body">
          <section className="medal-card" aria-labelledby="medal-title" data-reveal="block">
            <p className="eyebrow">HONOR · 数字杭州市民</p>
            <h1>{user.name ?? user.email}</h1>
            <div className="medal-stars" role="img" aria-label={`数字杭州市民 ${level.stars} 星，${level.title}`}>
              {HONOR_LEVELS.map((item) => (
                <Star
                  key={item.stars}
                  size={26}
                  strokeWidth={1.3}
                  fill="currentColor"
                  className={item.stars <= level.stars ? "is-on" : "is-off"}
                />
              ))}
            </div>
            <p className="medal-title" id="medal-title">{level.stars} 星 · {level.title}</p>
            <div className="medal-points">
              <strong>{points.toLocaleString("zh-CN")}</strong>
              <span>平台贡献值</span>
            </div>
            {level.next ? (
              <div className="medal-progress">
                <div className="detail-bar"><i style={{ width: `${level.progress}%` }} /></div>
                <p>距 ★{level.next.stars} {level.next.title} 还差 {(level.next.min - points).toLocaleString("zh-CN")} 贡献值</p>
              </div>
            ) : (
              <p className="medal-progress">已达最高星级。</p>
            )}
            <p className="detail-placeholder">
              完成活动后按举办身份、个人表现与战队表现折算平台贡献值，勋章星级只升不降；规则见 docs/prize-mechanism.md。
            </p>
          </section>

          {joinsSection}
        </div>
      ) : (
        <>
          <div className="profile-card" data-reveal="block">
            <p className="eyebrow">HONOR · 数字杭州市民</p>
            <h1>登录后查看你的勋章</h1>
            <p>
              「数字杭州市民」是杭客松的平台唯一荣誉勋章：参加活动、提交产出、代表战队出战，都会折算成平台贡献值，
              把勋章从 1 星慢慢升到 5 星。
            </p>
            <div className="provider-list">
              {session.providers.map((provider) => (
                <button
                  key={provider.id}
                  className="provider-button"
                  disabled={!session.configured || !provider.configured}
                  onClick={() => void signIn(provider.id, { callbackUrl: "/profile" })}
                >
                  <span>使用 {provider.name} 登录</span>
                  {!provider.configured && <span className="provider-state">未配置</span>}
                </button>
              ))}
            </div>
            {!session.configured && (
              <p className="detail-placeholder">本环境未配置登录；线上 hangkathon.net 已可通过 GitHub / Google 登录。</p>
            )}
            <Button asChild className="primary-action"><Link href="/">返回首页 <ArrowRight size={17} /></Link></Button>
          </div>
          <div className="profile-body profile-joins-only">{joinsSection}</div>
        </>
      )}
    </main>
  );
}
