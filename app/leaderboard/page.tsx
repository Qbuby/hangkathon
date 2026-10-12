import type { Metadata } from "next";
import Link from "next/link";
import FactionPanel from "../faction-panel";
import PageMotion from "../motion-mount";
import SiteHeader from "../site-header";
import JsonLd from "../json-ld";
import YourEntry from "./your-entry";
import DistrictStats from "./district-stats";
import { platformTotals } from "@/lib/contribution";
import { PUBLISHED_ACTIVITIES } from "@/lib/published-activities";
import { breadcrumbNode, graph, webpageNode } from "@/lib/seo/schema";
import "../activities/[slug]/detail.css";
import "./leaderboard.css";

const DESCRIPTION =
  "杭客松荣誉榜：查看杭州各区 AI 活动数量、个人贡献与战队贡献排行，见证城市 AI 共创的实时进度。";

export const metadata: Metadata = {
  title: "荣誉榜 · 杭州 AI 贡献排行",
  description: DESCRIPTION,
  alternates: { canonical: "/leaderboard" },
  openGraph: {
    title: "荣誉榜 · 杭州 AI 贡献排行 · 杭客松",
    description: "各区活动数量、个人与战队贡献实时排行。",
    url: "/leaderboard",
  },
};

/**
 * 榜单页的结构化数据只声明"这是什么页、挂在哪"（WebPage + 面包屑）。
 *
 * 刻意不生成 ItemList 排行数据：claude-seo 的 schema 规范要求结构化数据必须是
 * **可核验的事实**，而这里的名次与贡献值随活动结算实时变化、且涉及个人收益隐私
 * （用户明确要求过收益不外露）。把易变且敏感的数据写进结构化数据，
 * 既是错误的（摘要会引用过期名次），也越过了用户的隐私线。
 */
const LEADERBOARD_JSON_LD = graph([
  webpageNode({ path: "/leaderboard", name: "荣誉榜 · 杭州 AI 贡献排行", description: DESCRIPTION }),
  breadcrumbNode([
    { name: "首页", path: "/" },
    { name: "荣誉榜", path: "/leaderboard" },
  ]),
]);

export default function LeaderboardPage() {
  const totals = platformTotals();
  const teamTotal = totals.teams.reduce((sum, team) => sum + team.points, 0);

  return (
    <main className="detail-page lb-page">
      <JsonLd data={LEADERBOARD_JSON_LD} />
      <SiteHeader />
      <PageMotion page="leaderboard" />

      <section className="lb-hero">
        <p className="eyebrow" data-reveal="block">LEADERBOARD</p>
        <h1 data-reveal="block">排行榜</h1>
        <p className="lb-hero-sub" data-reveal="block">
          在杭客松<Link href="/activities">参加活动</Link>、完成作品、获得认可，就会积累你的荣誉 ——
          平台里把它叫作「贡献值」。榜单上的数字越高，说明这位参与者做的事情越多、越被认可。
        </p>
        <div className="lb-stats">
          <div className="lb-stat" data-reveal="item"><strong>{totals.total.toLocaleString("zh-CN")}</strong><span>累计荣誉值</span></div>
          <div className="lb-stat" data-reveal="item"><strong>{PUBLISHED_ACTIVITIES.length} 场</strong><span>已发布活动</span></div>
          <div className="lb-stat" data-reveal="item"><strong>{totals.citizenCount} 位</strong><span>参与者</span></div>
          <div className="lb-stat" data-reveal="item"><strong>{totals.teams.length} 支</strong><span>战队</span></div>
        </div>
      </section>

      <section className="lb-section" aria-labelledby="lb-me">
        <p className="detail-eyebrow" data-reveal="block">MY HONOR</p>
        <h2 id="lb-me" data-reveal="block">我的荣誉</h2>
        <YourEntry />
      </section>

      <section className="lb-section" aria-labelledby="lb-districts">
        <p className="detail-eyebrow" data-reveal="block">DISTRICTS</p>
        <h2 id="lb-districts" data-reveal="block">各区统计</h2>
        <p className="lb-explain" data-reveal="block">
          区是活动的归属标签：这里统计各区名下已发布的活动场数。区不计入贡献值。
        </p>
        <DistrictStats />
      </section>

      <section className="lb-section" aria-labelledby="lb-teams">
        <p className="detail-eyebrow" data-reveal="block">TEAMS</p>
        <h2 id="lb-teams" data-reveal="block">战队荣誉</h2>
        <p className="lb-explain" data-reveal="block">
          战队是一起参加活动的队伍：战队荣誉 = 队员贡献之和，大家一起参赛、一起分享荣誉。
        </p>
        <div className="lb-faction-panel">
          <FactionPanel
            slices={totals.teams.map((team) => ({
              id: team.id,
              label: team.name,
              value: team.points,
              color: team.color,
            }))}
            rows={totals.teams.map((team) => ({
              id: team.id,
              name: team.name,
              color: team.color,
              points: team.points,
              share: teamTotal > 0 ? team.points / teamTotal : 0,
            }))}
            centerValue={teamTotal.toLocaleString("zh-CN")}
            nameLabel="战队"
          />
        </div>
        {totals.teams.length === 0 && <p className="detail-placeholder">暂无战队荣誉数据。</p>}
      </section>

      <section className="lb-section" aria-labelledby="lb-citizens">
        <p className="detail-eyebrow" data-reveal="block">CITIZENS</p>
        <h2 id="lb-citizens" data-reveal="block">个人的贡献</h2>
        <p className="lb-explain" data-reveal="block">
          「贡献值」就是你在杭客松参与活动、完成作品和获得认可所积累的荣誉值。
          它同时决定「数字杭州市民」的星级——只升不降。
        </p>
        <details className="lb-rules" data-reveal="block">
          <summary>贡献值怎么涨？</summary>
          <ul>
            <li>报名参加活动 —— 迈出第一步</li>
            <li>完成的作品通过审核后计入：优 +100 · 良 +60 · 合格 +30</li>
            <li>邀请朋友来参加：朋友 +20，你 +50</li>
            <li>活动结束时按表现发放荣誉奖励</li>
          </ul>
        </details>
        <div className="lb-table">
          <div className="lb-row lb-table-head" data-reveal="block">
            <span>排名</span>
            <span>数字市民</span>
            <span>战队</span>
            <span>活动</span>
            <span>贡献值</span>
          </div>
          {totals.users.slice(0, 10).map((row, index) => (
            <div className="lb-row" key={row.name} data-reveal="item">
              <span className="lb-rank">{index + 1}</span>
              <span className="lb-name">{row.name}</span>
              <span className="lb-user-faction">
                {row.team ? (<><i style={{ background: row.team.color }} />{row.team.name}</>) : "—"}
              </span>
              <span className="lb-acts">{row.activities} 场</span>
              <span className="lb-points">{row.points.toLocaleString("zh-CN")}</span>
            </div>
          ))}
        </div>
        {totals.users.length === 0 && <p className="detail-placeholder" data-reveal="block">还没有上榜数据。第一场活动结算后，这里会出现第一批名字。</p>}
      </section>
    </main>
  );
}
