"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { contributionLabels, contributionSegments, segmentPath, type DonutSlice } from "./donut-geometry";
export type { DonutSlice } from "./donut-geometry";

type DonutProps = {
  slices: DonutSlice[];
  centerLabel: string;
  centerValue: string;
  active: string | null;
  onActive: (id: string | null) => void;
};

/** Exact SVG angles, persistent full labels and one shared interaction state. */
export default function Donut({ slices, centerLabel, centerValue, active, onActive }: DonutProps) {
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(580);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const segments = useMemo(() => contributionSegments(slices), [slices]);
  const layout = useMemo(() => contributionLabels(segments, width), [segments, width]);
  const events = (id: string) => ({
    onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType !== "touch") onActive(id); },
    onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType !== "touch" && document.activeElement !== e.currentTarget) onActive(null); },
    onClick: () => onActive(id),
    onFocus: () => onActive(id),
    onBlur: () => onActive(null),
  });

  return (
    <figure ref={ref} className="donut-wrap" style={{ height: layout.height }}>
      <svg className="donut-ring" viewBox={`0 0 ${width} ${layout.height}`} role="group" aria-label="阵营贡献占比，十二点起顺时针">
        <g transform={`translate(${layout.cx} ${layout.cy})`}>
          <circle r={layout.radius} fill="none" stroke="#b4d8ff25" strokeWidth="14" />
          {segments.map((slice) => (
            <path key={slice.id} d={segmentPath(slice.start, slice.end, layout.radius, 0)} fill="none" stroke={slice.color}
              strokeWidth={active === slice.id ? 20 : 14} strokeLinecap="butt" className="donut-segment"
              role="button" tabIndex={0} aria-pressed={active === slice.id}
              aria-label={`${slice.label}，${(slice.share * 100).toFixed(1)}%，贡献值 ${slice.value.toLocaleString("zh-CN")}`}
              {...events(slice.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onActive(slice.id); } }} />
          ))}
        </g>
        {layout.labels.map((spot) => (
          <path key={spot.id} d={spot.leader} fill="none" stroke={spot.color}
            strokeWidth={active === spot.id ? 2 : 1} className="donut-leader" aria-hidden="true" />
        ))}
      </svg>
      {layout.labels.map((spot) => (
        <button type="button" key={spot.id}
          className={`donut-label${active === spot.id ? " is-active" : ""}`}
          style={{ left: spot.x, top: spot.y - 22, width: layout.labelWidth }}
          aria-pressed={active === spot.id} {...events(spot.id)}>
          <span className="donut-label-name"><i style={{ background: spot.color }} />{spot.label}</span>
          <span className="donut-label-share">{(spot.share * 100).toFixed(1)}%</span>
        </button>
      ))}
      <figcaption className="donut-total" style={{ left: layout.cx, top: layout.cy, width: Math.max(48, layout.radius * 2 - 24) }}>
        <strong>{centerValue}</strong>
        <span>{centerLabel}</span>
        {segments.length === 0 && <span>暂无贡献</span>}
      </figcaption>
    </figure>
  );
}
