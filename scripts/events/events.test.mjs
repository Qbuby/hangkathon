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
  isCuratedSource,
  isIngestSource,
  sourceLabel,
} = await import(`data:text/javascript;base64,${Buffer.from(libJs).toString("base64")}`);

/** 抓取脚本能产出的来源（curated 是代码专属，没有 fixture，也不该出现在 fetch.py 里）。 */
const INGEST_SOURCES = EVENT_SOURCES.filter((item) => item.id !== "curated");

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
  // 7 个抓取源都要有 fixture（curated 是代码专属来源，不参与抓取，见 lib/curated-events.ts）
  assert.equal(INGEST_SOURCES.length, 7);
  for (const { id } of INGEST_SOURCES) {
    assert.match(probe.stderr, new RegExp(`${id}: [1-9]\\d*/`), `${id} 的 fixture 应至少解析出 1 条`);
  }
});

test("离线全量跑：输出契约齐全、跨源去重、日期为 ISO", () => {
  const result = runFetch(["--fixture", "--no-window"]);
  assert.ok(result.fetchedAt);
  assert.equal(result.window.pastDays, 7);
  assert.equal(result.window.futureDays, 90);
  for (const { id } of INGEST_SOURCES) {
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

test("filterByWindow：与 fetch.py 的窗口口径一致（开始日期在窗口内，或结束/截止日期在未来 90 天内）", () => {
  const now = new Date("2026-09-25T00:00:00Z");
  const event = (fields) => normalizeEventInput({ source: "topcoder", sourceId: "1", title: "t", url: "https://x", tags: [], ...fields });

  const inside = event({ sourceId: "in", startsAt: "2026-09-24T00:00:00Z" });
  const tooOld = event({ sourceId: "old", startsAt: "2026-09-01T00:00:00Z" });
  const tooNew = event({ sourceId: "new", startsAt: "2027-01-01T00:00:00Z" });
  const deadlineOnly = event({ sourceId: "ddl", endsAt: "2026-10-01T00:00:00Z" });
  const deadlinePast = event({ sourceId: "ddp", endsAt: "2026-09-01T00:00:00Z" });
  // 两周前开始、下个月结束：正在进行的赛事要收
  const ongoing = event({ sourceId: "run", startsAt: "2026-09-10T00:00:00Z", endsAt: "2026-10-20T00:00:00Z" });
  // 两周前开始、明年才结束：长期赛事不收
  const marathon = event({ sourceId: "mar", startsAt: "2026-09-10T00:00:00Z", endsAt: "2027-06-01T00:00:00Z" });
  assert.ok(inside && tooOld && tooNew && deadlineOnly && deadlinePast && ongoing && marathon);

  const kept = filterByWindow([inside, tooOld, tooNew, deadlineOnly, deadlinePast, ongoing, marathon], now).map((item) => item.sourceId);
  assert.deepEqual(kept, ["in", "ddl", "run"]);
});

test("curated 是代码专属来源：ingest 拒绝、窗口不拦、标签可读", () => {
  // 抓取脚本与 ingest 接口都不能写 curated（否则外部可以伪造「杭客松精选」）
  assert.equal(isIngestSource("curated"), false);
  assert.equal(isIngestSource("topcoder"), true);
  assert.equal(isCuratedSource("curated"), true);
  assert.equal(isCuratedSource("topcoder"), false);
  assert.equal(
    normalizeEventInput({
      source: "curated",
      sourceId: "fake",
      title: "伪造的精选",
      url: "https://example.com",
      startsAt: "2026-10-01T00:00:00Z",
      tags: [],
    }),
    null,
  );
  assert.equal(sourceLabel("curated"), "杭客松精选");
  assert.equal(sourceLabel("hudongba"), "互动吧");
  assert.equal(sourceLabel("no-such-source"), "no-such-source", "未知来源回落到 id，不能崩");

  // 半年跨度的精选在窗口外也要展示；结束之后不展示
  const longRunning = {
    source: "curated",
    sourceId: "dubai",
    title: "Create AI Agents Championship",
    url: "https://example.com",
    category: "competition",
    startsAt: "2026-10-07T00:00:00.000Z",
    endsAt: "2027-05-07T00:00:00.000Z",
    tags: [],
  };
  const ended = { ...longRunning, sourceId: "ended", endsAt: "2026-09-01T00:00:00.000Z" };
  const now = new Date("2026-12-01T00:00:00Z");
  assert.deepEqual(filterByWindow([longRunning, ended], now).map((item) => item.sourceId), ["dubai"]);
});
