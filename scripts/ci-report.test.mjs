import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, precondition, report, skipGroup, summary } from "./ci/lib.mjs";

// 这几个用例守护的是"假绿"这一类问题：套件有没有可能**看起来全过、
// 实际上少测了一堆断言**。这类回归不会让任何断言变红，只能靠对 report()
// 自身的退出码做断言来挡住。

/** 收集 report() 的标准输出，避免测试日志被套件输出淹没。 */
function captureReport(results, env = {}) {
  const saved = { ...process.env };
  const logs = [];
  const originalLog = console.log;
  console.error = console.error; // 保持
  const originalError = console.error;
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => logs.push(args.join(" "));
  Object.assign(process.env, env);
  let code;
  try {
    code = report("测试套件", results);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    for (const key of Object.keys(env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
  return { code, output: logs.join("\n") };
}

test("全部通过时退出码为 0", () => {
  const results = [];
  check(results, "a", true, "");
  check(results, "b", true, "");
  const { code } = captureReport(results);
  assert.equal(code, 0);
});

test("有失败项时退出码为 1", () => {
  const results = [];
  check(results, "a", true, "");
  check(results, "b", false, "坏了");
  const { code } = captureReport(results);
  assert.equal(code, 1);
});

test("跳过项默认计为失败（跳过即没测）", () => {
  const results = [];
  check(results, "a", true, "");
  skipGroup(results, ["b"], "前置失败");
  const { code, output } = captureReport(results);
  assert.equal(code, 1, "skipped 必须让退出码非零，否则「少测了」会被当成「全过」");
  assert.match(output, /未允许/);
});

test("跳过项在允许清单里时不算失败", () => {
  const results = [];
  check(results, "a", true, "");
  skipGroup(results, ["http 跳转 HTTPS"], "目标是 http://");
  const { code } = captureReport(results, { REPORT_ALLOW_SKIP_NAMES: "http 跳转 HTTPS" });
  assert.equal(code, 0);
});

test("允许清单只放行列表内的名字，新出现的跳过仍然失败", () => {
  const results = [];
  skipGroup(results, ["已知的合理跳过"], "x");
  skipGroup(results, ["意料之外的新跳过"], "y");
  const { code, output } = captureReport(results, { REPORT_ALLOW_SKIP_NAMES: "已知的合理跳过" });
  assert.equal(code, 1, "一把开关整体放行会让护栏形同虚设");
  assert.match(output, /意料之外的新跳过/);
  assert.match(output, /未在允许清单里/);
});

test("precondition 失败时后续断言显式变为 skipped（而不是消失）", () => {
  const results = [];
  const ok = precondition(results, "前置：接口返回 200", false, "实际 503");
  assert.equal(ok, false);
  if (ok) {
    check(results, "含字段 a", true, "");
  } else {
    skipGroup(results, ["含字段 a"], "前置：接口返回 503");
  }
  const stats = summary(results);
  // 关键：总条数不是 1 而是 2 —— 覆盖缺口被记录下来了
  assert.equal(stats.total, 2);
  assert.equal(stats.failed, 1);
  assert.equal(stats.skipped, 1);
  assert.equal(stats.ok, 0);
});

test("REPORT_JSON 写出机器可读报告（供渗透管线消费）", () => {
  const dir = mkdtempSync(join(tmpdir(), "hk-report-"));
  const path = join(dir, "r.json");
  try {
    const results = [];
    check(results, "ok 项", true, "");
    check(results, "bad 项", false, "细节");
    skipGroup(results, ["skip 项"], "原因");
    const { code } = captureReport(results, { REPORT_JSON: path, REPORT_ALLOW_SKIP: "1" });
    assert.equal(code, 1);
    const payload = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(payload.total, 3);
    assert.equal(payload.ok, 1);
    assert.equal(payload.failed, 1);
    assert.equal(payload.skipped, 1);
    assert.deepEqual(payload.results.map((item) => item.name), ["ok 项", "bad 项", "skip 项"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
