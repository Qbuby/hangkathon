import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Exercise the production geometry without adding a runtime/test dependency.
const source = readFileSync(new URL("../app/donut-geometry.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { contributionLabels, contributionSegments, orbitPoint, segmentPath, TAU } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const slices = (values) => values.map((value, id) => ({ id: String(id), value, label: `完整阵营${id}`, color: "#fff" }));

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
  assert.equal((segmentPath(0, TAU, 148).match(/ A /g) ?? []).length, 2);
  assert.equal(contributionSegments(slices([0, 0])).length, 0);
  assert.equal(contributionSegments(slices([42]))[0].share, 1);
});
test("labels retain exact midpoint anchors and fit at desktop and 390/320px viewport content widths", () => {
  const cases = [[], [0, 0], [42], Array(13).fill(1), [999999, ...Array(12).fill(1)], [...Array(12).fill(1), 999999], [1, 7, 19, 5, 9, 3, 4, 10, 6, 8, 2, 11, 15]];
  for (const width of [580, 540, 400, 399, 390 * .88, 320 * .88]) {
    for (const values of cases) {
      const segments = contributionSegments(slices(values));
      const layout = contributionLabels(segments, width);
      assert.equal(layout.labels.length, segments.length);
      for (const label of layout.labels) {
        const midpoint = orbitPoint((label.start + label.end) / 2, layout.radius);
        assert.deepEqual(label.anchor, midpoint);
        assert.ok(label.leader.startsWith(`M ${layout.cx + midpoint.x} ${layout.cy + midpoint.y} L `));
        assert.equal(label.label, segments.find((segment) => segment.id === label.id).label);
        assert.ok(label.x >= 0 && label.x + layout.labelWidth <= width);
        assert.ok(label.y - 22 >= 0 && label.y + 22 <= layout.height);
        // Labels stay wholly outside the highlighted ring's horizontal extent.
        if (label.side === "left") assert.ok(label.x + layout.labelWidth < layout.cx - layout.radius - 10);
        else assert.ok(label.x > layout.cx + layout.radius + 10);
      }
      for (const side of ["left", "right"]) {
        const labels = layout.labels.filter((label) => label.side === side).sort((a, b) => a.y - b.y);
        labels.forEach((label, index) => {
          if (index) {
            assert.ok(label.y - labels[index - 1].y >= 52 - 1e-9);
            assert.ok(label.anchor.y >= labels[index - 1].anchor.y);
          }
        });
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
