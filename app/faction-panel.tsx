"use client";

import { useState } from "react";
import Donut from "./donut";
import type { DonutSlice } from "./donut";

type FactionRow = { id: string; name: string; color: string; points: number; share: number; prize?: number };

/**
 * 饼图 + 明细列表的组合：悬停扇区或列表行时互相高亮，
 * 父组件统一交互状态；明细保留完整名称、占比、贡献值及零值项。
 * 用于战队贡献（详情页与排行榜），nameLabel 是明细列表第一列表头。
 */
export default function FactionPanel({ slices, rows, centerValue, hasPrize, nameLabel = "分区" }: {
  slices: DonutSlice[];
  rows: FactionRow[];
  centerValue: string;
  hasPrize?: boolean;
  nameLabel?: string;
}) {
  const [active, setActive] = useState<string | null>(null);

  return (
    <div className="faction-panel">
      <div className="faction-chart">
        <figcaption className="donut-total">
          <strong>{centerValue}</strong>
          <span>总贡献值</span>
          {!slices.some((slice) => Number.isFinite(slice.value) && slice.value > 0) && <span>暂无贡献</span>}
        </figcaption>
        <Donut slices={slices} active={active} onActive={setActive} />
      </div>
      <div className="faction-list">
        <div className="faction-list-header" aria-hidden="true">
          <span className="faction-name-heading">{nameLabel}</span>
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
