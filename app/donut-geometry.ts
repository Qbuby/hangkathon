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
 * Anchors stay at each sector's own midpoint on the rim, so each leader visibly
 * belongs to its sector. Labels stack per side in anchor order and each leader
 * is a nested elbow — horizontal off the rim, vertical in its own lane, then
 * horizontal into its label. Lanes sit beyond the pie's horizontal extent and
 * step further out the higher the label, so every run stays outside the pie
 * and same-side leaders can never cross or overlap.
 */
export function contributionLabels(segments: ContributionSegment[], width: number) {
  const labelWidth = width < 400 ? 64 : 96;
  const radius = Math.min(144, Math.max(24, (width - 2 * labelWidth - 40) / 2));
  const spots = segments.map((segment) => {
    const mid = (segment.start + segment.end) / 2;
    return {
      ...segment,
      mid,
      side: Math.sin(mid) >= 0 ? "right" as const : "left" as const,
      anchor: { x: 0, y: 0 },
      lane: 0,
      y: 0,
    };
  });
  const sides = [spots.filter((spot) => spot.side === "left"), spots.filter((spot) => spot.side === "right")];
  const gap = 52;
  for (const side of sides) {
    // Top-to-bottom screen order: mid ascending on the right (0→π), descending on the left (2π→π).
    side.sort((a, b) => a.side === "right" ? a.mid - b.mid : b.mid - a.mid);
    // Neighbor anchors keep a little vertical separation so their shelves stay
    // distinct; sub-pixel slivers would otherwise collapse onto shared heights.
    for (let index = 1; index < side.length; index++) {
      const prevY = -Math.cos(side[index - 1].mid) * radius;
      const minAngle = Math.acos(Math.min(1, Math.max(-1, -(prevY + 4) / radius)));
      side[index].mid = side[index].side === "right"
        ? Math.max(side[index].mid, minAngle)
        : Math.min(side[index].mid, TAU - minAngle);
    }
    for (const spot of side) spot.anchor = orbitPoint(spot.mid, radius);
  }
  const cx = width / 2;
  let height = Math.max(340, ...sides.map((side) => {
    if (!side.length) return 340;
    // The stack bottom is driven by whichever anchor pushes its tail down furthest.
    const lowest = Math.max(...side.map((spot, index) => spot.anchor.y + gap * (side.length - 1 - index)));
    return 2 * (lowest + 30);
  }));
  let cy = height / 2;
  // Nudges and the monotonic stack interact — a gap fix can re-collinear a
  // shelf and vice versa — so settle each side at a fixpoint (every correction
  // only pushes down, so it converges), growing the figure if the bottom label
  // outruns the padding instead of clamping it back into the stack.
  for (let iteration = 0; iteration < 12; iteration++) {
    cy = height / 2;
    for (const side of sides) {
        for (let pass = 0; pass < 20; pass++) {
        let changed = false;
        let prevY = 0;
        for (let index = 0; index < side.length; index++) {
          const spot = side[index];
          spot.lane = index;
          let y = Math.max(30, cy + spot.anchor.y, index ? prevY + gap : 30);
          // A label shelf must never run collinear with another label's rim shelf.
          for (const peer of spots) {
            if (peer !== spot && Math.abs(cy + peer.anchor.y - y) < 1) y = cy + peer.anchor.y + 1;
          }
          if (y !== spot.y) changed = true;
          spot.y = y;
          prevY = y;
        }
        if (!changed) break;
      }
    }
    const overflow = Math.max(0, ...sides.map((side) => side.length ? side[side.length - 1].y - (height - 30) : 0));
    if (!overflow) break;
    height += overflow;
  }
  return {
    width, height, cx, cy, radius, labelWidth,
    labels: spots.map((spot) => {
      const endX = spot.side === "right" ? width - labelWidth - 4 : labelWidth + 4;
      const side = sides[spot.side === "left" ? 0 : 1];
      const outward = spot.side === "right" ? 1 : -1;
      const baseX = cx + outward * (radius + 8);
      const room = Math.max(0, Math.abs(baseX - endX) - 6);
      const step = Math.min(6, room / Math.max(1, side.length - 1));
      const laneX = baseX + outward * (side.length - 1 - spot.lane) * step;
      const rimX = cx + spot.anchor.x;
      const rimY = cy + spot.anchor.y;
      return {
        ...spot,
        x: spot.side === "right" ? width - labelWidth : 0,
        leader: `M ${rimX} ${rimY} L ${laneX} ${rimY} L ${laneX} ${spot.y} L ${endX} ${spot.y}`,
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
