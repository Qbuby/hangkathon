import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Exercise the production validator without a runtime/test dependency.
const source = readFileSync(new URL("../lib/custom-factions.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { validateCustomFactionName, createCustomFaction, HANGZHOU_LANDMARKS } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);

const EXISTING = ["上城区", "西湖区", "西湖侠客"];

test("accepts names containing a hangzhou landmark", () => {
  for (const name of ["西湖侠客", "断桥残雪队", "钱塘江潮", "良渚少年", "西溪探路者", "千岛湖舰队", "运河人家"]) {
    assert.equal(validateCustomFactionName(name, []), null, `should accept: ${name}`);
  }
});

test("rejects names without any landmark", () => {
  for (const name of ["王者联盟", "代码工厂", "北京路战队", "随便取个名"]) {
    assert.ok(validateCustomFactionName(name, []), `should reject: ${name}`);
  }
});

test("rejects empty, wrong length and duplicate names", () => {
  assert.ok(validateCustomFactionName("", []));
  assert.ok(validateCustomFactionName("   ", []));
  assert.ok(validateCustomFactionName("西", [])); // 太短
  assert.ok(validateCustomFactionName("西湖超级无敌霹雳先锋大队长", [])); // 太长
  assert.ok(validateCustomFactionName("西湖侠客", EXISTING)); // 重名
  assert.ok(validateCustomFactionName("上城区", EXISTING)); // 与官方重名
});

test("landmark library covers the classic sites", () => {
  for (const site of ["西湖", "断桥", "雷峰塔", "灵隐", "钱塘江", "大运河", "良渚", "西溪", "千岛湖", "之江"]) {
    assert.ok(HANGZHOU_LANDMARKS.includes(site), `missing landmark: ${site}`);
  }
});

test("createCustomFaction is deterministic in id and color", () => {
  const a = createCustomFaction("西湖侠客");
  const b = createCustomFaction("西湖侠客");
  assert.equal(a.id, b.id);
  assert.equal(a.color, b.color);
  assert.equal(a.name, "西湖侠客");
  assert.ok(a.id.startsWith("custom-"));
});
