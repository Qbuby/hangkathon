export type DonutSlice = { id: string; label: string; value: number; color: string };
export const TAU = Math.PI * 2;

/** All geometry starts at twelve o'clock and proceeds clockwise. No minimum angle. */
export function contributionSegments(slices: DonutSlice[]) {
  const positive = slices.filter((slice) => Number.isFinite(slice.value) && slice.value > 0);
  const total = positive.reduce((sum, slice) => sum + slice.value, 0);
  let accumulated = 0;
  return positive.map((slice) => {
    const start = accumulated / total * TAU;
    accumulated += slice.value;
    const end = accumulated / total * TAU;
    return { ...slice, share: slice.value / total, start, end };
  });
}

export type ContributionSegment = ReturnType<typeof contributionSegments>[number];

/**
 * Pack each side independently in angular-anchor order; grow vertically rather
 * than hide labels. Anchors are pulled along the arc until each is within half
 * a label gap of its label, then the leader runs as an orthogonal elbow —
 * horizontal at the anchor's y to the label edge, vertical to the label. Both
 * runs are then y-disjoint per side, so same-side leaders cannot cross or
 * overlap. Slivers narrower than the gap collapse onto the same anchor.
 */
export function contributionLabels(segments: ContributionSegment[], width: number) {
  const labelWidth = width < 400 ? 64 : 96;
  const radius = Math.min(144, Math.max(24, (width - 2 * labelWidth - 40) / 2));
  const spots = segments.map((segment) => {
    const mid = (segment.start + segment.end) / 2;
    return { ...segment, mid, side: Math.sin(mid) >= 0 ? "right" as const : "left" as const, anchor: { x: 0, y: 0 }, tie: 0, y: 0 };
  });
  const sides = [spots.filter((spot) => spot.side === "left"), spots.filter((spot) => spot.side === "right")];
  const gap = 52;
  const cap = gap / 2 - 2;
  const height = Math.max(340, Math.max(...sides.map((side) => side.length), 1) * gap + 16);
  const cx = width / 2;
  const cy = height / 2;
  for (const side of sides) {
    // Top-to-bottom screen order: mid ascending on the right (0→π), descending on the left (2π→π).
    side.sort((a, b) => a.side === "right" ? a.mid - b.mid : b.mid - a.mid);
    for (let index = 1; index < side.length; index++) {
      const k = Math.cos(side[index - 1].mid) - 13 / radius;
      const edge = Math.acos(Math.min(1, Math.max(-1, k)));
      side[index].mid = side[index].side === "right" ? Math.max(side[index].mid, edge) : Math.min(side[index].mid, TAU - edge);
    }
    for (const spot of side) spot.anchor = orbitPoint(spot.mid, radius);
    side.forEach((spot, index) => {
      const prev = index ? side[index - 1] : null;
      spot.tie = prev !== null && Math.hypot(spot.anchor.x - prev.anchor.x, spot.anchor.y - prev.anchor.y) < 2 ? 1 : 0;
      spot.y = Math.max(30, cy + spot.anchor.y, index ? side[index - 1].y + gap : 30);
    });
    if (side.length && side[side.length - 1].y > height - 30) {
      side[side.length - 1].y = height - 30;
      for (let index = side.length - 2; index >= 0; index--) {
        side[index].y = Math.min(side[index].y, side[index + 1].y - gap);
      }
    }
    // Pull each anchor along the arc until it sits within `cap` of its label;
    // both leader runs are then y-disjoint per side and cannot cross. When the
    // arc cannot reach (label beyond the pole), the anchor stays at the pole
    // edge with x clamped to the radius.
    for (const spot of side) {
      const targetY = spot.y - cy;
      if (Math.abs(spot.anchor.y - targetY) > cap) {
        const rawY = spot.anchor.y + (targetY > spot.anchor.y ? 1 : -1) * (Math.abs(targetY - spot.anchor.y) - cap);
        // Labels can sit beyond the pole; the anchor never leaves the circle.
        const newY = Math.max(-radius, Math.min(radius, rawY));
        const xAbs = Math.sqrt(Math.max(0, radius * radius - newY * newY));
        spot.anchor.x = (spot.side === "left" ? -1 : 1) * xAbs;
        spot.anchor.y = newY;
      }
    }
  }
  return {
    width, height, cx, cy, radius, labelWidth,
    labels: spots.map((spot) => {
      const endX = spot.side === "right" ? width - labelWidth - 4 : labelWidth + 4;
      return {
        ...spot,
        x: spot.side === "right" ? width - labelWidth : 0,
        leader: `M ${cx + spot.anchor.x} ${cy + spot.anchor.y} L ${endX} ${cy + spot.anchor.y} L ${endX} ${spot.y}`,
      };
    }),
  };
}

export function orbitPoint(angle: number, radius: number) {
  return { x: Math.sin(angle) * radius, y: -Math.cos(angle) * radius };
}

/** 闭合扇形（实心饼图）：圆心起笔到弧起点，保留双 A 弧兼容单阵营 100% 的 SVG 歧义，Z 闭合。 */
export function segmentPath(start: number, end: number, radius: number, center = 160) {
  const a = orbitPoint(start, radius);
  const b = orbitPoint((start + end) / 2, radius);
  const c = orbitPoint(end, radius);
  return `M ${center} ${center} L ${center + a.x} ${center + a.y} A ${radius} ${radius} 0 0 1 ${center + b.x} ${center + b.y} A ${radius} ${radius} 0 0 1 ${center + c.x} ${center + c.y} Z`;
}
