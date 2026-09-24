import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

// 直接测生产代码，不额外加运行时依赖（与 douyin-url.test.mjs 同一套做法）。
const source = readFileSync(new URL("../lib/server/douyin.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { readMetrics } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const SCRIPT_DIR = fileURLToPath(new URL("./douyin/", import.meta.url));

function findPython() {
  return ["python3", "python"].find((candidate) => {
    const probe = spawnSync(candidate, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8" });
    return probe.status === 0 && probe.stdout.trim() === "3";
  });
}

test("reads the fetch script's success payload into metrics", () => {
  const { metrics } = readMetrics(
    JSON.stringify({
      ok: true,
      awemeId: "7301234567890123456",
      url: "https://www.douyin.com/video/7301234567890123456",
      caption: "文案",
      authorName: "作者",
      diggCount: 12,
      commentCount: 3,
      shareCount: 4,
      collectCount: 5,
      publishedAt: "2026-08-18T06:56:48Z",
      fetchedAt: "2026-09-24T07:46:24.190375Z",
    }),
  );
  assert.deepEqual(metrics, {
    awemeId: "7301234567890123456",
    caption: "文案",
    authorName: "作者",
    diggCount: 12,
    commentCount: 3,
    shareCount: 4,
    collectCount: 5,
    fetchedAt: "2026-09-24T07:46:24.190375Z",
  });
});

test("an upstream refusal becomes an error, not a thrown exception", () => {
  const result = readMetrics(
    JSON.stringify({ ok: false, awemeId: "1", error: "上游返回 403：Signature Not Found" }),
  );
  assert.equal(result.error, "上游返回 403：Signature Not Found");
  assert.equal(result.metrics, undefined);
});

test("garbage on stdout is reported, never thrown", () => {
  // 脚本崩了、被 OOM 杀了、python 不存在——都会落到这三条路径上。
  for (const stdout of ["", "   ", "<html>blocked</html>", "null"]) {
    assert.ok(readMetrics(stdout).error, `应当报错：${JSON.stringify(stdout)}`);
  }
});

test("counts are real numbers or absent; 0 is kept", () => {
  const { metrics } = readMetrics(
    JSON.stringify({ ok: true, caption: "", diggCount: "12", commentCount: 0, shareCount: null }),
  );
  assert.equal(metrics.diggCount, undefined, "字符串数字不算数");
  assert.equal(metrics.commentCount, 0, "0 是合法互动数，不能当缺席");
  assert.equal(metrics.shareCount, undefined);
  assert.equal(metrics.caption, undefined, "空文案当缺席，页面才不用判断空字符串");
  assert.ok(metrics.fetchedAt, "缺 fetchedAt 时补当前时间");
});

// 跨语言的那一半：脚本 shape() 吐出来的字段名必须和 readMetrics 读的字段名一致。
// 两边任何一边改了名字，这个测试就会红——否则症状是页面上永远没有数据，
// 而两条链路各自的单元测试都是绿的。
test("the python script and the reader agree on field names", (t) => {
  const python = findPython();
  if (!python) {
    t.skip("没有 python3，跳过（抓取脚本只在服务器上跑）");
    return;
  }
  const program = `
import json, sys
sys.path.insert(0, ".")
import fetch

detail = {
    "aweme_id": "7301234567890123456",
    "desc": "文案",
    "author": {"nickname": "作者"},
    "create_time": 1787036208,
    "statistics": {"digg_count": 12, "comment_count": 3, "share_count": 4, "collect_count": 5},
}
print(json.dumps(fetch.shape(detail, "7301234567890123456"), ensure_ascii=False))
`;
  const result = spawnSync(python, ["-"], { cwd: SCRIPT_DIR, input: program, encoding: "utf8" });
  assert.equal(result.status, 0, `脚本失败：\n${result.stderr}`);

  const { metrics } = readMetrics(result.stdout);
  assert.deepEqual(metrics, {
    awemeId: "7301234567890123456",
    caption: "文案",
    authorName: "作者",
    diggCount: 12,
    commentCount: 3,
    shareCount: 4,
    collectCount: 5,
    fetchedAt: metrics.fetchedAt,
  });
});
