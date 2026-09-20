"use client";

import { useState } from "react";
import Donut from "./donut";
import type { DonutSlice } from "./donut";

type FactionRow = { id: string; name: string; color: string; points: number; share: number; prize?: number };

/**
 * 环形图 + 阵营列表的组合：悬停扇区或列表行时互相高亮，
 * 图中心显示当前阵营的名称与占比，让每个扇区都能对应到阵营。
 */
export default function FactionPanel({ slices, rows, centerValue, hasPrize }: {
  slices: DonutSlice[];
  rows: FactionRow[];
  centerValue: string;
  hasPrize?: boolean;
}) {
  const [active, setActive] = useState<string | null>(null);

  return (
    <div className="faction-panel">
      <Donut slices={slices} centerLabel="总贡献值" centerValue={centerValue} onActive={setActive} />
      <div className="faction-list">
        {rows.map((row) => (
          <div
            key={row.id}
            className={`faction-row${row.points === 0 ? " is-zero" : ""}${active === row.id ? " is-active" : ""}${active && active !== row.id ? " is-dim" : ""}`}
            onMouseEnter={() => setActive(row.id)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="faction-dot" style={{ background: row.color }} />
            <strong>{row.name}</strong>
            <span className="faction-points">{row.points.toLocaleString("zh-CN")}</span>
            <span className="faction-share">{(row.share * 100).toFixed(1)}%</span>
            {hasPrize && <span className="faction-prize">奖金 ¥{(row.prize ?? 0).toLocaleString("zh-CN")}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
