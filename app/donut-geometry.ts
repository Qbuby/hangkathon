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

/** Pack each side independently in angular-anchor order; grow vertically rather than hide labels. */
export function contributionLabels(segments: ContributionSegment[], width: number) {
  const labelWidth = width < 400 ? 64 : 96;
  const radius = Math.min(144, Math.max(24, (width - 2 * labelWidth - 40) / 2));
  const spots = segments.map((segment) => {
    const anchor = orbitPoint((segment.start + segment.end) / 2, radius);
    return { ...segment, anchor, side: anchor.x >= 0 ? "right" as const : "left" as const, y: 0 };
  });
  const sides = [spots.filter((spot) => spot.side === "left"), spots.filter((spot) => spot.side === "right")];
  const gap = 52;
  const height = Math.max(340, Math.max(...sides.map((side) => side.length)) * gap + 16);
  const cx = width / 2;
  const cy = height / 2;
  for (const side of sides) {
    side.sort((a, b) => a.anchor.y - b.anchor.y || a.start - b.start);
    side.forEach((spot, index) => {
      spot.y = Math.max(30, cy + spot.anchor.y, index ? side[index - 1].y + gap : 30);
    });
    if (side.length && side[side.length - 1].y > height - 30) {
      side[side.length - 1].y = height - 30;
      for (let index = side.length - 2; index >= 0; index--) {
        side[index].y = Math.min(side[index].y, side[index + 1].y - gap);
      }
    }
  }
  return {
    width, height, cx, cy, radius, labelWidth,
    labels: spots.map((spot) => {
      const direction = spot.side === "right" ? 1 : -1;
      const outer = orbitPoint((spot.start + spot.end) / 2, radius + 12);
      const endX = spot.side === "right" ? width - labelWidth - 4 : labelWidth + 4;
      return {
        ...spot,
        x: spot.side === "right" ? width - labelWidth : 0,
        leader: `M ${cx + spot.anchor.x} ${cy + spot.anchor.y} L ${cx + outer.x} ${cy + outer.y} L ${cx + direction * (radius + 16)} ${spot.y} L ${endX} ${spot.y}`,
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
