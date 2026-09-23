import type { Metadata } from "next";
import Link from "next/link";
import FactionPanel from "../faction-panel";
import PageMotion from "../motion-mount";
import SiteHeader from "../site-header";
import YourEntry from "./your-entry";
import DistrictStats from "./district-stats";
import { platformTotals } from "@/lib/contribution";
import { PUBLISHED_ACTIVITIES } from "@/lib/published-activities";
import "../activities/[slug]/detail.css";
import "./leaderboard.css";

export const metadata: Metadata = { title: "排行榜 · 杭客松" };

export default function LeaderboardPage() {
  const totals = platformTotals();
  const teamTotal = totals.teams.reduce((sum, team) => sum + team.points, 0);

  return (
    <main className="detail-page lb-page">
      <SiteHeader />
      <PageMotion page="leaderboard" />

      <section className="lb-hero">
        <p className="eyebrow" data-reveal="block">LEADERBOARD</p>
        <h1 data-reveal="block">排行榜</h1>
        <p className="lb-hero-sub" data-reveal="block">
          杭客松的荣誉从这里结算：参加<Link href="/activities">活动</Link>的数字市民按产出贡献值，
          为自己的战队和「数字杭州市民」勋章累计荣誉。区是活动的归属标签，只统计活动数，不计入贡献。
        </p>
        <div className="lb-stats">
          <div className="lb-stat" data-reveal="item"><strong>{totals.total.toLocaleString("zh-CN")}</strong><span>平台总贡献值</span></div>
          <div className="lb-stat" data-reveal="item"><strong>{PUBLISHED_ACTIVITIES.length} 场</strong><span>已发布活动</span></div>
          <div className="lb-stat" data-reveal="item"><strong>{totals.citizenCount} 位</strong><span>数字杭州市民</span></div>
          <div className="lb-stat" data-reveal="item"><strong>{totals.teams.length} 支</strong><span>战队</span></div>
        </div>
      </section>

      <section className="lb-section" aria-labelledby="lb-districts">
        <p className="detail-eyebrow" data-reveal="block">DISTRICTS</p>
        <h2 id="lb-districts" data-reveal="block">区的活动数</h2>
        <DistrictStats />
        <p className="detail-placeholder" data-reveal="block">区不计入贡献统计；这里只统计各区名下已发布与本机活动的场数。</p>
      </section>

      <section className="lb-section" aria-labelledby="lb-teams">
        <p className="detail-eyebrow" data-reveal="block">TEAMS</p>
        <h2 id="lb-teams" data-reveal="block">战队的贡献</h2>
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
        {totals.teams.length === 0 && <p className="detail-placeholder">暂无战队贡献数据。</p>}
      </section>

      <section className="lb-section" aria-labelledby="lb-citizens">
        <p className="detail-eyebrow" data-reveal="block">CITIZENS</p>
        <h2 id="lb-citizens" data-reveal="block">个人的贡献</h2>
        <div className="lb-table">
          <div className="lb-row lb-table-head" data-reveal="block">
            <span>排名</span>
            <span>数字市民</span>
            <span>主要战队</span>
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
        <YourEntry />
        {totals.users.length === 0 && <p className="detail-placeholder" data-reveal="block">暂无个人贡献数据。</p>}
      </section>
    </main>
  );
}
