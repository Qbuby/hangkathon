import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// 屏蔽过滤是纯函数模块（lib/security/filter.ts），直接转译后在 node 里跑，
// 不引入测试期依赖 —— 与仓库里其它 *.test.mjs 同一套做法。
const source = readFileSync(new URL("../lib/security/filter.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
}).outputText;
const filter = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const { screenText, screenFields, screenSubmissionUrl, normalize, recordViolation } = filter;

test("正常活动文案不被拦截", () => {
  for (const text of [
    "我 AI 中国 · 2026 国庆 AI 短视频创作大赛",
    "77 周年，49 新生",
    "开发者 · 企业 · 创造者",
    "探索 AI 计算资源",
  ]) {
    assert.equal(screenText(text).blocked, false, text);
  }
});

test("命中词库按类别拦截", () => {
  const cases = [
    ["赌博网站", "赌博"],
    ["出售 博彩平台 账号", "赌博"],
    ["提供代开发票服务", "诈骗"],
    ["代开发票刻章", "诈骗"],
  ];
  for (const [text, category] of cases) {
    const result = screenText(text);
    assert.equal(result.blocked, true, text);
    assert.ok(result.hits.some((hit) => hit.category === category), `${text} -> ${JSON.stringify(result.hits)}`);
  }
});

test("拆字与全角绕过被归一化后仍能命中", () => {
  assert.equal(screenText("赌 博").blocked, true);
  assert.equal(screenText("赌　博").blocked, true); // 全角空格
  assert.equal(normalize("ＡＢＣ"), "abc");
});

test("提示不回显命中的具体词", () => {
  const result = screenText("赌博网站");
  assert.ok(result.message.length > 0);
  assert.equal(result.message.includes("赌博网站"), false);
});

test("多字段：任一命中整条拦截", () => {
  assert.equal(
    screenFields({ title: "正常的比赛", overview: "这里有博彩平台", contact: "a@b.com" }).blocked,
    true,
  );
  assert.equal(
    screenFields({ title: "正常的比赛", overview: "一切正常", contact: "a@b.com" }).blocked,
    false,
  );
});

test("作品链接只放行抖音站内 https", () => {
  assert.equal(screenSubmissionUrl("https://v.douyin.com/iR5kX9y/").blocked, false);
  assert.equal(screenSubmissionUrl("https://www.douyin.com/video/7301234567890123456").blocked, false);
  assert.equal(screenSubmissionUrl("http://v.douyin.com/iR5kX9y/").blocked, true); // 非 https
  assert.equal(screenSubmissionUrl("https://douyin.com.evil.com/x").blocked, true); // 后缀伪造
  assert.equal(screenSubmissionUrl("https://example.com/video/1").blocked, true);
  assert.equal(screenSubmissionUrl("javascript:alert(1)").blocked, true);
});

test("连续命中累计到阈值才触发自动黑名单", () => {
  const email = "filter-test@example.com";
  const first = recordViolation(email);
  assert.deepEqual([first.count, first.shouldBlock], [1, false]);
  const second = recordViolation(email);
  assert.deepEqual([second.count, second.shouldBlock], [2, false]);
  const third = recordViolation(email);
  assert.deepEqual([third.count, third.shouldBlock], [3, true]);
});