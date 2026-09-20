import type { Metadata } from "next";
import Link from "next/link";
import FactionPanel from "../faction-panel";
import SiteHeader from "../site-header";
import YourEntry from "./your-entry";
import { platformTotals } from "@/lib/contribution";
import { FACTIONS } from "@/lib/factions";
import "../activities/[slug]/detail.css";
import "./leaderboard.css";

export const metadata: Metadata = { title: "荣誉榜 · 杭客松" };

const RANK_COLORS = ["#e8d16a", "#c3d6ea", "#ffb46b"];

export default function LeaderboardPage() {
  const totals = platformTotals();

  // 全部 13 个阵营一视同仁，按贡献降序；暂无贡献的排后置灰。
  const allFactions = FACTIONS
    .map((faction) => {
      const row = totals.factions.find((item) => item.faction.id === faction.id);
      return row ?? { faction, points: 0, share: 0, prize: 0 };
    })
    .sort((a, b) => b.points - a.points);

  return (
    <main className="detail-page lb-page">
      <SiteHeader />

      <section className="lb-hero">
        <p className="eyebrow">HONOR LEADERBOARD</p>
        <h1>荣誉榜</h1>
        <p className="lb-hero-sub">
          杭客松的荣誉从这里结算：参加<Link href="/activities">活动</Link>的数字市民按产出贡献值，
          为自己的阵营和「数字杭州市民」勋章累计荣誉。阵营贡献 = 阵营成员的个人贡献值之和；
          个人贡献跨活动累计，只升不降。
        </p>
          <div className="lb-stats">
            <div className="lb-stat"><strong>{totals.total.toLocaleString("zh-CN")}</strong><span>平台总贡献值</span></div>
            <div className="lb-stat"><strong>{totals.activityCount} 场</strong><span>活动已产生荣誉</span></div>
            <div className="lb-stat"><strong>{totals.citizenCount} 位</strong><span>数字杭州市民</span></div>
            <div className="lb-stat"><strong>{FACTIONS.length} 个</strong><span>阵营</span></div>
          </div>
      </section>

      <section className="lb-section" aria-labelledby="lb-factions">
        <p className="detail-eyebrow">FACTIONS</p>
        <h2 id="lb-factions">阵营荣誉</h2>
        <div className="lb-faction-panel">
          <FactionPanel
            slices={allFactions.map((row) => ({
              id: row.faction.id,
              label: row.faction.name,
              value: row.points,
              color: row.faction.color,
            }))}
            rows={allFactions.map((row) => ({
              id: row.faction.id,
              name: row.faction.name,
              color: row.faction.color,
              points: row.points,
              share: row.share,
            }))}
            centerValue={totals.total.toLocaleString("zh-CN")}
          />
        </div>
      </section>

      <section className="lb-section" aria-labelledby="lb-citizens">
        <p className="detail-eyebrow">CITIZENS</p>
        <h2 id="lb-citizens">数字市民荣誉榜</h2>
        <div className="lb-table">
          <div className="lb-row lb-table-head">
            <span>排名</span>
            <span>数字市民</span>
            <span>阵营</span>
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
                <i style={{ background: row.faction.color }} />{row.faction.name}
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
