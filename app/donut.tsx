"use client";

import { useState } from "react";

export type DonutSlice = { id: string; label: string; value: number; color: string };

type DonutProps = {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel: string;
  centerValue: string;
  onActive?: (id: string | null) => void;
};

/** 阵营名去掉行政区后缀，便于在图外紧凑标注（拱墅区 → 拱墅）。 */
const shortName = (label: string) => label.replace(/[区县市]$/, "");

/**
 * 纯 SVG 环形图：不引第三方图表库，颜色与阵营体系共用。
 * 每个扇区用引线标注阵营简称与占比，颜色与扇区一致，无需悬停即可对应；
 * 悬停扇区时中心显示该阵营详情，并通过 onActive 通知列表联动高亮。
 */
export default function Donut({ slices, size = 220, thickness = 26, centerLabel, centerValue, onActive }: DonutProps) {
  const [active, setActive] = useState<string | null>(null);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const visible = slices.filter((slice) => slice.value > 0);
  const dashes = visible.map((slice) => (total > 0 ? (slice.value / total) * circumference : 0));
  const rings = visible.map((slice, index) => ({
    id: slice.id,
    label: slice.label,
    color: slice.color,
    value: slice.value,
    dash: dashes[index],
    gap: circumference - dashes[index],
    offset: dashes.slice(0, index).reduce((sum, dash) => sum + dash, 0),
  }));
  const label = visible
    .map((slice) => `${slice.label} ${total > 0 ? Math.round((slice.value / total) * 100) : 0}%`)
    .join("，");
  const activeSlice = visible.find((slice) => slice.id === active);
  const activeShare = activeSlice && total > 0 ? (activeSlice.value / total) * 100 : 0;

  // 画布在环形外留出标注区；同侧标注按角度定位后做垂直防重叠，
  // 避免小占比阵营挤在一起时文字叠成一团。
  const pad = 78;
  const full = size + pad * 2;
  const cx = size / 2 + pad;
  const cy = size / 2 + pad;
  const edge = radius + thickness / 2 + 2;
  const raw = rings.map((ring, index) => {
    const before = rings.slice(0, index).reduce((sum, item) => sum + item.value, 0);
    const middle = (before + ring.value / 2) / Math.max(total, 1);
    const angle = middle * 2 * Math.PI - Math.PI / 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      id: ring.id,
      color: ring.color,
      text: `${shortName(ring.label)} ${total > 0 ? Math.round((ring.value / total) * 100) : 0}%`,
      cos,
      lineX1: cx + cos * edge,
      lineY1: cy + sin * edge,
      textX: cx + cos * (edge + 16),
      textY: cy + sin * (edge + 16),
      anchor: (cos >= 0 ? "start" : "end") as "start" | "end",
    };
  });
  // 估算文字宽度后，同侧标注按 y 排序并推开到最小间距，最后夹回画布内。
  const dodge = (items: typeof raw) => {
    const minGap = 18;
    const sorted = items.map((item, i) => ({ ...item, i, estW: item.text.length * 11 })).sort((a, b) => a.textY - b.textY);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].textY - sorted[i - 1].textY < minGap) sorted[i].textY = sorted[i - 1].textY + minGap;
    }
    for (let i = sorted.length - 2; i >= 0; i--) {
      if (sorted[i + 1].textY - sorted[i].textY < minGap) sorted[i].textY = sorted[i + 1].textY - minGap;
    }
    for (const item of sorted) {
      item.textY = Math.min(Math.max(item.textY, 10), full - 10);
      if (item.anchor === "end" && item.textX - item.estW < 4) item.textX = item.estW + 4;
      if (item.anchor === "start" && item.textX + item.estW > full - 4) item.textX = full - item.estW - 4;
    }
    return sorted;
  };
  const placed = [...dodge(raw.filter((item) => item.cos < 0)), ...dodge(raw.filter((item) => item.cos >= 0))];
  const marks = placed.map((item) => ({
    id: item.id,
    color: item.color,
    text: item.text,
    lineX1: item.lineX1,
    lineY1: item.lineY1,
    lineX2: item.textX + (item.anchor === "start" ? -5 : 5),
    lineY2: item.textY,
    textX: item.textX,
    textY: item.textY,
    anchor: item.anchor,
  }));

  const activate = (id: string | null) => {
    setActive(id);
    onActive?.(id);
  };

  return (
    <svg
      className="donut"
      width={full}
      height={full}
      viewBox={`0 0 ${full} ${full}`}
      role="img"
      aria-label={`${centerLabel}：${centerValue}。${label}`}
      onMouseLeave={() => activate(null)}
    >
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#b4d8ff1c" strokeWidth={thickness} />
      <g transform={`rotate(-90 ${cx} ${cy})`}>
        {rings.map((ring) => (
          <circle
            key={ring.id}
            className={`donut-ring${active === ring.id ? " is-active" : ""}${active && active !== ring.id ? " is-dim" : ""}`}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={ring.color}
            strokeWidth={thickness}
            strokeDasharray={`${ring.dash} ${ring.gap}`}
            strokeDashoffset={-ring.offset}
            onMouseEnter={() => activate(ring.id)}
          />
        ))}
      </g>
      {marks.map((mark) => (
        <g key={mark.id} className={`donut-mark${active === mark.id ? " is-active" : ""}${active && active !== mark.id ? " is-dim" : ""}`}>
          <line x1={mark.lineX1} y1={mark.lineY1} x2={mark.lineX2} y2={mark.lineY2} stroke={mark.color} strokeWidth={1.4} />
          <text
            className="donut-mark-text"
            x={mark.textX}
            y={mark.textY}
            textAnchor={mark.anchor}
            dominantBaseline="central"
            fill={mark.color}
          >
            {mark.text}
          </text>
        </g>
      ))}
      {activeSlice ? (
        <>
          <text className="donut-value" x={cx} y={cy - 2} textAnchor="middle">{activeShare.toFixed(1)}%</text>
          <text className="donut-label" x={cx} y={cy + 14} textAnchor="middle">{activeSlice.label}</text>
        </>
      ) : (
        <>
          <text className="donut-value" x={cx} y={cy - 2} textAnchor="middle">{centerValue}</text>
          <text className="donut-label" x={cx} y={cy + 14} textAnchor="middle">{centerLabel}</text>
        </>
      )}
    </svg>
  );
}
