import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import Donut from "../donut";
import { MECHANISM, platformTotals } from "@/lib/contribution";
import "../activities/[slug]/detail.css";
import "./leaderboard.css";

export const metadata: Metadata = { title: "算力榜 · 杭客松" };

const RANK_COLORS = ["#e8d16a", "#c3d6ea", "#ffb46b"];

export default function LeaderboardPage() {
  const totals = platformTotals();
  const maxFactionPoints = totals.factions[0]?.points ?? 0;

  return (
    <main className="detail-page lb-page">
      <header className="detail-top">
        <Link className="detail-back" href="/"><ArrowLeft size={17} /> 返回首页</Link>
        <span className="detail-top-title">算力榜</span>
        <span className="detail-top-note">平台演示数据</span>
      </header>

      <section className="lb-hero">
        <p className="eyebrow">COMPUTE LEADERBOARD</p>
        <h1>算力榜</h1>
        <p className="lb-hero-sub">
          全平台所有活动的阵营贡献与市民贡献总览。阵营贡献 = 阵营成员的个人贡献值之和。
        </p>
        <div className="lb-stats">
          <div className="lb-stat"><strong>{totals.total.toLocaleString("zh-CN")}</strong><span>平台总贡献值</span></div>
          <div className="lb-stat"><strong>{totals.activityCount} 场</strong><span>参与活动</span></div>
          <div className="lb-stat"><strong>{totals.citizenCount} 位</strong><span>数字杭州市民</span></div>
          <div className="lb-stat"><strong>{totals.factions.length} 个</strong><span>上榜阵营</span></div>
        </div>
      </section>

      <section className="lb-section" aria-labelledby="lb-factions">
        <p className="detail-eyebrow">FACTIONS</p>
        <h2 id="lb-factions">阵营贡献</h2>
        <div className="faction-panel">
          <Donut
            slices={totals.factions.map((row) => ({
              id: row.faction.id,
              label: row.faction.name,
              value: row.points,
              color: row.faction.color,
            }))}
            centerLabel="总贡献值"
            centerValue={totals.total.toLocaleString("zh-CN")}
          />
          <div className="faction-list lb-faction-list">
            {totals.factions.map((row) => (
              <div className="faction-row lb-faction-row" key={row.faction.id}>
                <span className="faction-dot" style={{ background: row.faction.color }} />
                <strong>{row.faction.name}</strong>
                <span className="faction-points">{row.points.toLocaleString("zh-CN")}</span>
                <span className="faction-share">{(row.share * 100).toFixed(1)}%</span>
                <div className="detail-bar lb-faction-bar"><i style={{ width: `${maxFactionPoints ? (row.points / maxFactionPoints) * 100 : 0}%`, background: row.faction.color }} /></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lb-section" aria-labelledby="lb-citizens">
        <p className="detail-eyebrow">CITIZENS</p>
        <h2 id="lb-citizens">市民贡献榜</h2>
        <div className="lb-table">
          <div className="lb-row lb-table-head">
            <span>排名</span>
            <span>市民</span>
            <span>阵营</span>
            <span>活动</span>
            <span>贡献值</span>
          </div>
          {totals.users.map((row, index) => (
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
        <p className="detail-placeholder">榜单为跨活动累计的演示数据，正式数据待平台接入后端后开放。</p>
      </section>

      <section className="lb-note">
        <p className="detail-eyebrow">MECHANISM</p>
        <p>
          正式阶段每人每天 ¥{MECHANISM.voucher.base} 算力券（当日有效，每邀请一位新用户 +¥{MECHANISM.voucher.perInvite}，封顶 ¥{MECHANISM.voucher.dailyCap}）；
          产出物 {MECHANISM.review.hours} 小时内按质量审核计入贡献值（{MECHANISM.review.grades.map((grade) => `${grade.label} ${grade.points}`).join(" / ")}）；
          有奖金的活动按「阵营占比 × 个人占比」两层比例分发奖池；
          完赛后按表现折算平台贡献值，升级「数字杭州市民」勋章（★1–★5）。
        </p>
      </section>
    </main>
  );
}
