"use client";

import { useState } from "react";

export type DonutSlice = { id: string; label: string; value: number; color: string };

type DonutProps = {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel: string;
  centerValue: string;
};

/**
 * 纯 SVG 环形图：不引第三方图表库，颜色与阵营体系共用。
 * 悬停扇区时中心显示该阵营的名称与占比，并通过 onActive 通知列表联动高亮。
 */
export default function Donut({ slices, size = 176, thickness = 22, centerLabel, centerValue, onActive }: DonutProps & { onActive?: (id: string | null) => void }) {
  const [active, setActive] = useState<string | null>(null);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const visible = slices.filter((slice) => slice.value > 0);
  const dashes = visible.map((slice) => (total > 0 ? (slice.value / total) * circumference : 0));
  const rings = visible.map((slice, index) => ({
    id: slice.id,
    color: slice.color,
    dash: dashes[index],
    gap: circumference - dashes[index],
    offset: dashes.slice(0, index).reduce((sum, dash) => sum + dash, 0),
  }));
  const label = visible
    .map((slice) => `${slice.label} ${total > 0 ? Math.round((slice.value / total) * 100) : 0}%`)
    .join("，");
  const activeSlice = visible.find((slice) => slice.id === active);
  const activeShare = activeSlice && total > 0 ? (activeSlice.value / total) * 100 : 0;

  const activate = (id: string | null) => {
    setActive(id);
    onActive?.(id);
  };

  return (
    <svg
      className="donut"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${centerLabel}：${centerValue}。${label}`}
      onMouseLeave={() => activate(null)}
    >
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#b4d8ff1c" strokeWidth={thickness} />
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {rings.map((ring) => (
          <circle
            key={ring.id}
            className={`donut-ring${active === ring.id ? " is-active" : ""}${active && active !== ring.id ? " is-dim" : ""}`}
            cx={size / 2}
            cy={size / 2}
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
      {activeSlice ? (
        <>
          <text className="donut-value" x="50%" y="47%" textAnchor="middle">{activeShare.toFixed(1)}%</text>
          <text className="donut-label" x="50%" y="60%" textAnchor="middle">{activeSlice.label}</text>
        </>
      ) : (
        <>
          <text className="donut-value" x="50%" y="47%" textAnchor="middle">{centerValue}</text>
          <text className="donut-label" x="50%" y="60%" textAnchor="middle">{centerLabel}</text>
        </>
      )}
    </svg>
  );
}
