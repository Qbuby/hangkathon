import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Exercise the production geometry without adding a runtime/test dependency.
const source = readFileSync(new URL("../app/donut-geometry.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { contributionLabels, contributionSegments, orbitPoint, segmentPath, TAU } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const slices = (values) => values.map((value, id) => ({ id: String(id), value, label: `完整阵营${id}`, color: "#fff" }));
const parseLeader = (d) => [...d.matchAll(/(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/gi)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
const crossDir = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const samePoint = (a, b) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
// Proper crossing, or collinear overlap extending beyond a shared endpoint.
// Two leaders merely fanning out from a common point is not an overlap.
const segsCross = (p1, p2, p3, p4) => {
  const d1 = crossDir(p3, p4, p1), d2 = crossDir(p3, p4, p2), d3 = crossDir(p1, p2, p3), d4 = crossDir(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const col = (a, b, c, d) => {
    if (crossDir(a, b, c) !== 0) return false;
    const dot = (c.x - a.x) * (d.x - b.x) + (c.y - a.y) * (d.y - b.y);
    if (dot > 0) return false; // segments point away from each other
    const touch = samePoint(a, c) || samePoint(a, d) || samePoint(b, c) || samePoint(b, d);
    return !touch;
  };
  return col(p1, p2, p3, p4) || col(p3, p4, p1, p2);
};
// Flatten the elbow polyline (4 points: rim, lane top, lane bottom, label) for containment checks.
const flattenLeader = (d) => {
  const points = parseLeader(d);
  assert.equal(points.length, 4, `four-point elbow leader expected: ${d}`);
  const poly = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      poly.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  poly.push(points.at(-1));
  return poly;
};
const leadersCross = (a, b) => {
  const pa = parseLeader(a), pb = parseLeader(b);
  for (let i = 0; i < pa.length - 1; i++) for (let j = 0; j < pb.length - 1; j++) {
    if (segsCross(pa[i], pa[i + 1], pb[j], pb[j + 1])) return true;
  }
  return false;
};

test("exact shares, including a tiny fraction, no minimum-angle exaggeration", () => {
  const segments = contributionSegments(slices([999999, 1, 0]));
  assert.equal(segments.length, 2);
  assert.equal(segments[0].start, 0);
  assert.equal(segments[1].end, TAU);
  assert.ok(Math.abs((segments[1].end - segments[1].start) / TAU - .000001) < 1e-15);
  assert.equal(segments.reduce((sum, segment) => sum + segment.share, 0), 1);
});
test("twelve o'clock start, clockwise points and full-circle SVG", () => {
  assert.deepEqual(orbitPoint(0, 148), { x: 0, y: -148 });
  assert.ok(Math.abs(orbitPoint(Math.PI / 2, 148).x - 148) < 1e-9);
  const fullCircle = segmentPath(0, TAU, 148);
  assert.ok(fullCircle.startsWith("M 160 160 L "));
  assert.ok(fullCircle.endsWith("Z"));
  assert.equal((fullCircle.match(/ A /g) ?? []).length, 2);
  assert.equal(contributionSegments(slices([0, 0])).length, 0);
  assert.equal(contributionSegments(slices([42]))[0].share, 1);
});
test("elbow leaders anchor at sector midpoints, stay off the pie and never cross", () => {
  const cases = [[], [0, 0], [42], Array(13).fill(1), [999999, ...Array(12).fill(1)], [...Array(12).fill(1), 999999], [1, 7, 19, 5, 9, 3, 4, 10, 6, 8, 2, 11, 15]];
  for (const width of [580, 540, 400, 399, 390 * .88, 320 * .88]) {
    for (const values of cases) {
      const segments = contributionSegments(slices(values));
      const layout = contributionLabels(segments, width);
      assert.equal(layout.labels.length, segments.length);
      for (const label of layout.labels) {
        const mid = (label.start + label.end) / 2;
        // Anchor is the sector's own midpoint on the rim; it may only be nudged
        // along the arc to keep neighbours 4px apart (left packs down, right up).
        assert.ok(Math.abs(Math.hypot(label.anchor.x, label.anchor.y) - layout.radius) < 1e-6);
        assert.ok(label.side === "left" ? label.anchor.x <= 1e-6 : label.anchor.x >= -1e-6);
        if (label.side === "left") assert.ok(label.mid <= mid + 1e-9);
        else assert.ok(label.mid >= mid - 1e-9);
        // Nested elbow: rim -> (lane, rimY) -> (lane, labelY) -> (endX, labelY).
        const endX = label.side === "right" ? width - layout.labelWidth - 4 : layout.labelWidth + 4;
        const [p0, p1, p2, p3] = parseLeader(label.leader);
        assert.ok(Math.abs(p0.x - (layout.cx + label.anchor.x)) < 1e-9 && Math.abs(p0.y - (layout.cy + label.anchor.y)) < 1e-9);
        assert.ok(Math.abs(p1.y - p0.y) < 1e-9, "shelf leaves the rim horizontally");
        assert.ok(Math.abs(p2.x - p1.x) < 1e-9, "vertical drop in one lane");
        assert.ok(Math.abs(p3.y - label.y) < 1e-9 && Math.abs(p3.x - endX) < 1e-9, "ends at the label edge");
        // Lanes sit beyond the pie's horizontal extent, so the drop clears the pie.
        if (label.side === "left") assert.ok(p1.x <= layout.cx - layout.radius - 2);
        else assert.ok(p1.x >= layout.cx + layout.radius + 2);
        // The whole leader stays outside the pie body.
        for (const point of flattenLeader(label.leader)) {
          assert.ok(Math.hypot(point.x - layout.cx, point.y - layout.cy) >= layout.radius - 0.5,
            `leader dips inside the pie at width ${width} ${label.label}`);
        }
        assert.equal(label.label, segments.find((segment) => segment.id === label.id).label);
        assert.ok(label.x >= 0 && label.x + layout.labelWidth <= width);
        assert.ok(label.y - 22 >= 0 && label.y + 22 <= layout.height);
        // Labels stay wholly outside the pie's horizontal extent.
        if (label.side === "left") assert.ok(label.x + layout.labelWidth < layout.cx - layout.radius - 10);
        else assert.ok(label.x > layout.cx + layout.radius + 10);
      }
      for (const side of ["left", "right"]) {
        const labels = layout.labels.filter((label) => label.side === side).sort((a, b) => a.y - b.y);
        labels.forEach((label, index) => {
          if (index) {
            assert.ok(label.y - labels[index - 1].y >= 50 - 1e-9);
            assert.ok(label.anchor.y >= labels[index - 1].anchor.y);
          }
        });
        for (let i = 0; i < labels.length; i++) {
          for (let j = i + 1; j < labels.length; j++) {
            assert.equal(leadersCross(labels[i].leader, labels[j].leader), false, `leaders cross at width ${width} ${side} ${i}/${j}`);
          }
        }
      }
    }
  }
});
test("many factions remain contiguous with exact proportional angles", () => {
  const values = [1, 7, 19, 5, 9, 3, 4, 10, 6, 8, 2, 11, 15];
  const total = values.reduce((sum, value) => sum + value, 0);
  const segments = contributionSegments(slices(values));
  segments.forEach((segment, index) => {
    assert.equal(segment.start, index ? segments[index - 1].end : 0);
    assert.ok(Math.abs((segment.end - segment.start) / TAU - values[index] / total) < 1e-15);
  });
  assert.equal(segments.at(-1).end, TAU);
});
