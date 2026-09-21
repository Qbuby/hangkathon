"use client";

import { useState } from "react";
import Donut from "./donut";
import type { DonutSlice } from "./donut";

type FactionRow = { id: string; name: string; color: string; points: number; share: number; prize?: number };

/**
 * 环形图 + 阵营列表的组合：悬停扇区或列表行时互相高亮，
 * 父组件统一交互状态；明细保留完整名称、占比、贡献值及零值阵营。
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
      <Donut slices={slices} centerLabel="总贡献值" centerValue={centerValue} active={active} onActive={setActive} />
      <div className="faction-list">
        <div className="faction-list-header" aria-hidden="true">
          <span className="faction-name-heading">分区</span>
          <span>贡献值</span>
          <span>占比</span>
        </div>
        {rows.map((row) => (
          <button
            type="button"
            key={row.id}
            className={`faction-row${row.points === 0 ? " is-zero" : ""}${active === row.id ? " is-active" : ""}`}
            aria-pressed={active === row.id}
            aria-label={`${row.name}，${(row.share * 100).toFixed(1)}%，贡献值 ${row.points.toLocaleString("zh-CN")}${hasPrize ? `，奖金 ${row.prize ?? 0} 元` : ""}`}
            onPointerEnter={(event) => { if (event.pointerType !== "touch") setActive(row.id); }}
            onPointerLeave={(event) => { if (event.pointerType !== "touch" && document.activeElement !== event.currentTarget) setActive(null); }}
            onFocus={() => setActive(row.id)}
            onBlur={() => setActive(null)}
            onClick={() => setActive(row.id)}
          >
            <span className="faction-dot" style={{ background: row.color }} />
            <strong>{row.name}</strong>
            <span className="faction-points">{row.points.toLocaleString("zh-CN")}</span>
            <span className="faction-share">{(row.share * 100).toFixed(1)}%</span>
            {hasPrize && <span className="faction-prize">奖金 ¥{(row.prize ?? 0).toLocaleString("zh-CN")}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
