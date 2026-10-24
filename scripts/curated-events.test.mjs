import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

/**
 * 人工精选赛事（lib/curated-events.ts）的确定性门禁。
 *
 * 这些内容是我手写的、不经过任何抓取校验，所以**每一条都必须被结构性地验证**：
 * 日期格式、URL 是 https、sourceId 唯一、站内海报真实存在、详情页能读到它。
 * 与仓库其它 *.test.mjs 同一套做法：转译 TS 后在 node 里跑，不引测试期依赖。
 */

const source = readFileSync(new URL("../lib/curated-events.ts", import.meta.url), "utf8");
// 该模块 import 了 ../external-events（类型 + 运行时无依赖），转译后 import 会被保留，
// data: URL 里无法解析相对路径 —— 先剥掉 import，再注入需要的常量。
const stripped = source
  .replace(/^import[\s\S]*?;$/gm, "")
  .replace(/^export\s+/gm, "");
const js = ts.transpileModule(
  `${stripped}\nexport { CURATED_EVENTS, curatedVisibleAt, CURATED_SOURCE };`,
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } },
).outputText;
const { CURATED_EVENTS, curatedVisibleAt, CURATED_SOURCE } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);

test("精选来源 id 与抓取来源不冲突", () => {
  assert.equal(CURATED_SOURCE, "curated");
  // ingest 侧用 isIngestSource 排除 curated；这里锁住字符串本身，改一边就会红
  const external = readFileSync(new URL("../lib/external-events.ts", import.meta.url), "utf8");
  assert.match(external, /id:\s*"curated"/);
  assert.match(external, /value !== "curated"/);
});

test("每条精选：sourceId 唯一、字段齐全、日期合法且起止有序", () => {
  const seen = new Set();
  for (const event of CURATED_EVENTS) {
    assert.ok(event.sourceId && !seen.has(event.sourceId), `sourceId 重复或为空：${event.sourceId}`);
    seen.add(event.sourceId);

    assert.ok(event.title?.trim(), `${event.sourceId} 缺原文标题`);
    assert.ok(event.titleZh?.trim(), `${event.sourceId} 缺中文标题`);
    assert.ok(event.descriptionZh?.trim(), `${event.sourceId} 缺中文简介`);
    assert.ok(event.tags.length > 0, `${event.sourceId} 缺标签`);

    assert.match(event.url, /^https:\/\//, `${event.sourceId} 的官网必须是 https`);
    if (event.imageUrl && !event.imageUrl.startsWith("/")) {
      assert.match(event.imageUrl, /^https:\/\//, `${event.sourceId} 的外部海报必须是 https`);
    }

    const starts = Date.parse(event.startsAt);
    assert.ok(Number.isFinite(starts), `${event.sourceId} 的 startsAt 无法解析`);
    assert.match(event.startsAt, /^\d{4}-\d{2}-\d{2}T.*Z$/, `${event.sourceId} 的 startsAt 应是 ISO UTC`);
    for (const key of ["endsAt", "deadlineAt"]) {
      if (!event[key]) continue;
      const time = Date.parse(event[key]);
      assert.ok(Number.isFinite(time), `${event.sourceId} 的 ${key} 无法解析`);
      assert.ok(time >= starts, `${event.sourceId} 的 ${key} 早于开始时间`);
    }
    if (event.endsAt && event.deadlineAt) {
      assert.ok(Date.parse(event.deadlineAt) <= Date.parse(event.endsAt), `${event.sourceId} 的截止时间晚于结束时间`);
    }
  }
});

test("站内海报真实存在（否则线上会是破图）", () => {
  for (const event of CURATED_EVENTS) {
    if (!event.imageUrl || !event.imageUrl.startsWith("/")) continue;
    // 站内路径是 public/ 下的绝对 URL：/assets/x.png → public/assets/x.png
    const path = new URL(`../public${event.imageUrl}`, import.meta.url);
    assert.ok(existsSync(path), `${event.sourceId} 的海报不存在：${event.imageUrl}`);
    const bytes = readFileSync(path).length;
    assert.ok(bytes > 10_000, `${event.sourceId} 的海报过小（${bytes}B），可能不是真图`);
  }
});

test("迪拜 AI Agents 锦标赛：官网事实与页面文案一致", () => {
  const dubai = CURATED_EVENTS.find((event) => event.sourceId === "create-ai-agents-championship-2026");
  assert.ok(dubai, "迪拜赛事应被收录");
  assert.equal(dubai.url, "https://www.dubaichamberdigital.com/en/create-ai-agents");

  // 2026-10-07 启动、2027-01 报名截止、2027-05 第一周总决赛（官网 timeline 原文）
  assert.equal(dubai.startsAt.slice(0, 10), "2026-10-07");
  assert.equal(dubai.deadlineAt.slice(0, 7), "2027-01");
  assert.equal(dubai.endsAt.slice(0, 7), "2027-05");

  // 奖金口径：总额 75 万美元、四类各 15 万
  assert.match(dubai.prize, /750,000/);
  assert.match(dubai.prize, /150,000/);
  assert.match(dubai.descriptionZh, /15 万美元/);
  assert.match(dubai.descriptionZh, /免费/);

  // 正文必须明确「具体日以官网为准」—— 官网只给到月份，我们不能假装精确
  assert.match(dubai.detailTextZh, /以官网为准/);
  // 精选必须声明不参与贡献值结算
  assert.match(dubai.detailTextZh, /不参与杭客松的贡献值与荣誉结算/);
});

test("curatedVisibleAt：结束/截止后就隐藏，两者都没有则长期有效", () => {
  const base = { startsAt: "2026-10-07T00:00:00.000Z" };
  const now = new Date("2026-12-01T00:00:00Z");
  assert.equal(curatedVisibleAt({ ...base, endsAt: "2027-05-07T00:00:00.000Z" }, now), true);
  assert.equal(curatedVisibleAt({ ...base, endsAt: "2026-11-01T00:00:00.000Z" }, now), false);
  // 报名截止早于活动结束：截止之后、结束之前，活动本身仍在进行，应继续展示
  assert.equal(
    curatedVisibleAt({ ...base, deadlineAt: "2026-11-01T00:00:00.000Z", endsAt: "2027-05-07T00:00:00.000Z" }, now),
    true,
  );
  // 截止与结束都过去才隐藏
  assert.equal(
    curatedVisibleAt({ ...base, deadlineAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-11-20T00:00:00.000Z" }, now),
    false,
  );
  assert.equal(curatedVisibleAt(base, new Date("2030-01-01T00:00:00Z")), true, "没有结束/截止时间就没有过期");
});
