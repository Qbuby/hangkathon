import type { Metadata } from "next";
import Link from "next/link";
import FactionPanel from "../faction-panel";
import SiteHeader from "../site-header";
import YourEntry from "./your-entry";
import DistrictStats from "./district-stats";
import { platformTotals } from "@/lib/contribution";
import "../activities/[slug]/detail.css";
import "./leaderboard.css";

export const metadata: Metadata = { title: "排行榜 · 杭客松" };

const RANK_COLORS = ["#e8d16a", "#c3d6ea", "#ffb46b"];

export default function LeaderboardPage() {
  const totals = platformTotals();
  // 饼图与明细同分母：战队贡献合计（个人贡献合计是另一个口径，见个人榜）
  const teamTotal = totals.teams.reduce((sum, team) => sum + team.points, 0);

  return (
    <main className="detail-page lb-page">
      <SiteHeader />

      <section className="lb-hero">
        <p className="eyebrow">LEADERBOARD</p>
        <h1>排行榜</h1>
        <p className="lb-hero-sub">
          杭客松的荣誉从这里结算：参加<Link href="/activities">活动</Link>的数字市民按产出贡献值，
          为自己的战队和「数字杭州市民」勋章累计荣誉。区是活动的归属标签，只统计活动数，不计入贡献。
        </p>
          <div className="lb-stats">
            <div className="lb-stat"><strong>{totals.total.toLocaleString("zh-CN")}</strong><span>平台总贡献值</span></div>
            <div className="lb-stat"><strong>{totals.activityCount} 场</strong><span>活动已产生荣誉</span></div>
            <div className="lb-stat"><strong>{totals.citizenCount} 位</strong><span>数字杭州市民</span></div>
            <div className="lb-stat"><strong>{totals.teams.length} 支</strong><span>战队</span></div>
          </div>
      </section>

      <section className="lb-section" aria-labelledby="lb-districts">
        <p className="detail-eyebrow">DISTRICTS</p>
        <h2 id="lb-districts">区的活动数</h2>
        <DistrictStats />
        <p className="detail-placeholder">区不再计入贡献统计；这里只统计各区名下的活动场数（含本机创建）。</p>
      </section>

      <section className="lb-section" aria-labelledby="lb-teams">
        <p className="detail-eyebrow">TEAMS</p>
        <h2 id="lb-teams">战队的贡献</h2>
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
        <p className="detail-placeholder">贡献数据为演示数据；接入后端后按全部活动实时汇总。</p>
      </section>

      <section className="lb-section" aria-labelledby="lb-citizens">
        <p className="detail-eyebrow">CITIZENS</p>
        <h2 id="lb-citizens">个人的贡献</h2>
        <div className="lb-table">
          <div className="lb-row lb-table-head">
            <span>排名</span>
            <span>数字市民</span>
            <span>主要战队</span>
            <span>活动</span>
            <span>贡献值</span>
          </div>
          {totals.users.slice(0, 10).map((row, index) => (
            <div className="lb-row" key={row.name}>
              <span className="lb-rank" style={index < 3 ? { color: RANK_COLORS[index] } : undefined}>
                {index < 3 ? `No.${index + 1}` : index + 1}
              </span>
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
        <p className="detail-placeholder">榜单为跨活动累计的演示数据，仅展示前十名；正式数据待平台接入后端后开放。</p>
      </section>
    </main>
  );
}
