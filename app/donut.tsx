"use client";

import { useState } from "react";
import { PieChart } from "react-minimal-pie-chart";

export type DonutSlice = { id: string; label: string; value: number; color: string };

type DonutProps = {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel: string;
  centerValue: string;
  onActive?: (id: string | null) => void;
};

/**
 * 环形图（react-minimal-pie-chart）：
 * 入场展开动画、圆角扇区、扇区间隙带来动态感；
 * 标签渲染在扇区几何中点，天然跟随扇区不错位；
 * 悬停扇区径向外移并联动列表，中心显示该阵营名称与占比。
 */
export default function Donut({ slices, size = 220, thickness = 22, centerLabel, centerValue, onActive }: DonutProps) {
  const [active, setActive] = useState<string | null>(null);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const visible = slices.filter((slice) => slice.value > 0);
  const activeIndex = visible.findIndex((slice) => slice.id === active);
  const activeSlice = activeIndex >= 0 ? visible[activeIndex] : null;
  const activeShare = activeSlice && total > 0 ? (activeSlice.value / total) * 100 : 0;
  const shift = 4;

  const activate = (id: string | null) => {
    setActive(id);
    onActive?.(id);
  };

  return (
    <div className="donut-wrap" style={{ width: size, height: size }}>
      <PieChart
        data={visible.map((slice) => ({
          key: slice.id,
          title: slice.label,
          value: slice.value,
          color: slice.color,
        }))}
        lineWidth={thickness / 2}
        radius={44}
        paddingAngle={2}
        rounded
        startAngle={-90}
        animate
        animationDuration={900}
        animationEasing="ease-out"
        label={({ dataEntry }) => {
          const share = total > 0 ? Math.round((dataEntry.value / total) * 100) : 0;
          if (share < 5) return null;
          return `${Math.round(share)}%`;
        }}
        labelPosition={100 - thickness / 2 - 6}
        labelStyle={(index) => ({
          fontSize: "5.5",
          fontWeight: 600,
          letterSpacing: "0.3",
          pointerEvents: "none",
          fill: "#eaf3ff",
          opacity: active === null || active === visible[index]?.id ? 1 : 0.25,
        })}
        segmentsShift={activeIndex >= 0 ? () => shift : 0}
        segmentsStyle={activeIndex >= 0 ? (index) => (index === activeIndex ? { filter: "brightness(1.25)" } : { opacity: 0.35 }) : undefined}
        onMouseOver={(e, index) => activate(visible[index]?.id ?? null)}
        onMouseOut={() => activate(null)}
        aria-label={`${centerLabel}：${centerValue}。${visible.map((slice) => `${slice.label} ${total > 0 ? Math.round((slice.value / total) * 100) : 0}%`).join("，")}`}
      >
        <defs>
          <radialGradient id="donut-fade" cx="50%" cy="50%" r="70%">
            <stop offset="55%" stopColor="#0a1c2e" stopOpacity="0" />
            <stop offset="100%" stopColor="#0a1c2e" stopOpacity="0.35" />
          </radialGradient>
        </defs>
      </PieChart>
      <div className="donut-center" aria-hidden>
        {activeSlice ? (
          <>
            <strong className="donut-center-value">{activeShare.toFixed(1)}%</strong>
            <span className="donut-center-label">{activeSlice.label}</span>
          </>
        ) : (
          <>
            <strong className="donut-center-value">{centerValue}</strong>
            <span className="donut-center-label">{centerLabel}</span>
          </>
        )}
      </div>
    </div>
  );
}
