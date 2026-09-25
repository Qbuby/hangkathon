import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

// 与 douyin-metrics.test.mjs 同一套做法：transpile 生产代码来测，不引运行时依赖。
const libSource = readFileSync(new URL("../../lib/external-events.ts", import.meta.url), "utf8");
const libJs = ts.transpileModule(libSource, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const {
  EVENT_SOURCES,
  normalizeEventInput,
  filterByWindow,
} = await import(`data:text/javascript;base64,${Buffer.from(libJs).toString("base64")}`);

const SCRIPT = fileURLToPath(new URL("./fetch.py", import.meta.url));

function findPython() {
  return ["python3", "python"].find((candidate) => {
    const probe = spawnSync(candidate, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8" });
    return probe.status === 0 && probe.stdout.trim() === "3";
  });
}

const python = findPython();
if (!python) throw new Error("全球赛事测试需要 python3（跑 fetch.py 的跨语言契约）");

function runFetch(args) {
  const probe = spawnSync(python, [SCRIPT, ...args], { encoding: "utf8" });
  assert.equal(probe.status, 0, `fetch.py 退出码 ${probe.status}：${probe.stderr}`);
  return JSON.parse(probe.stdout);
}

test("self-check：每个适配器都能从自己的 fixture 解析出条目", () => {
  const probe = spawnSync(python, [SCRIPT, "--self-check"], { encoding: "utf8" });
  assert.equal(probe.status, 0, probe.stderr);
  // 7 个源都要有 fixture（有 fixture 才测得到解析器）
  assert.equal(EVENT_SOURCES.length, 7);
  for (const { id } of EVENT_SOURCES) {
    assert.match(probe.stderr, new RegExp(`${id}: [1-9]\\d*/`), `${id} 的 fixture 应至少解析出 1 条`);
  }
});

test("离线全量跑：输出契约齐全、跨源去重、日期为 ISO", () => {
  const result = runFetch(["--fixture", "--no-window"]);
  assert.ok(result.fetchedAt);
  assert.equal(result.window.pastDays, 7);
  assert.equal(result.window.futureDays, 90);
  for (const { id } of EVENT_SOURCES) {
    assert.ok(result.sources[id], `缺 ${id} 的来源统计`);
    assert.ok(!result.sources[id].error, `${id} 不该报错：${result.sources[id].error}`);
  }
  assert.ok(result.events.length >= 7);
  const keys = new Set(result.events.flatMap((event) => Object.keys(event)));
  for (const key of ["source", "sourceId", "title", "url", "category", "startsAt", "tags"]) {
    assert.ok(keys.has(key), `输出缺字段 ${key}`);
  }
  const seen = new Set();
  for (const event of result.events) {
    const key = `${event.source}:${event.sourceId}`;
    assert.ok(!seen.has(key), `跨源去重失败：${key}`);
    seen.add(key);
    if (event.startsAt) assert.match(event.startsAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(event.url, /^https?:\/\//);
  }
});

test("normalizeEventInput：坏数据被丢弃，好数据被清洗", () => {
  assert.equal(normalizeEventInput(null), null);
  assert.equal(normalizeEventInput({ source: "unknown-source", sourceId: "1", title: "t", url: "https://x", startsAt: "2026-10-01T00:00:00Z", tags: [] }), null);
  assert.equal(
    normalizeEventInput({ source: "mlh", sourceId: "1", title: "t", url: "javascript:alert(1)", startsAt: "2026-10-01T00:00:00Z", tags: [] }),
    null,
  );
  assert.equal(normalizeEventInput({ source: "mlh", sourceId: "1", title: "t", url: "https://x", tags: [] }), null, "没有任何日期的要丢");

  const good = normalizeEventInput({
    source: "mlh",
    sourceId: "14418",
    title: "  HACK.COMS 2026  ",
    url: "https://events.mlh.io/events/14418",
    category: "hackathon",
    startsAt: "2026-09-27T00:00:00+00:00",
    endsAt: "not-a-date",
    location: "Philadelphia, PA",
    prize: "$1,000",
    tags: ["ai", "", 42],
    extra: "ignored",
  });
  assert.deepEqual(good, {
    source: "mlh",
    sourceId: "14418",
    title: "HACK.COMS 2026",
    url: "https://events.mlh.io/events/14418",
    category: "hackathon",
    tags: ["ai"],
    startsAt: "2026-09-27T00:00:00.000Z",
    location: "Philadelphia, PA",
    prize: "$1,000",
  });
});

test("filterByWindow：与 fetch.py 的窗口口径一致", () => {
  const now = new Date("2026-09-25T00:00:00Z");
  const event = (fields) => normalizeEventInput({ source: "topcoder", sourceId: "1", title: "t", url: "https://x", tags: [], ...fields });

  const inside = event({ sourceId: "in", startsAt: "2026-09-24T00:00:00Z" });
  const tooOld = event({ sourceId: "old", startsAt: "2026-09-01T00:00:00Z" });
  const tooNew = event({ sourceId: "new", startsAt: "2027-01-01T00:00:00Z" });
  const deadlineOnly = event({ sourceId: "ddl", endsAt: "2026-10-01T00:00:00Z" });
  const deadlinePast = event({ sourceId: "ddp", endsAt: "2026-09-01T00:00:00Z" });
  assert.ok(inside && tooOld && tooNew && deadlineOnly && deadlinePast);

  const kept = filterByWindow([inside, tooOld, tooNew, deadlineOnly, deadlinePast], now).map((item) => item.sourceId);
  assert.deepEqual(kept, ["in", "ddl"]);
});
