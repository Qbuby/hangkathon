import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Exercise the production motion plan without adding a runtime/test dependency.
const source = readFileSync(new URL("../app/motion.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
}).outputText;
const { MOTION, MOTION_BOOT, PAGE_ROOTS, REDUCED_QUERY, REVEAL_BLOCK, REVEAL_ITEM, revealPlan } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);

const PAGES = ["board", "detail", "leaderboard", "profile", "create", "manage", "auth-error"];

test("reduced motion produces no plan at all", () => {
  for (const page of PAGES) {
    assert.equal(revealPlan({ reduced: true, page }), null, `${page} must not animate when reduced`);
  }
});

test("every non-home page has a plan pointing at its own root", () => {
  for (const page of PAGES) {
    const plan = revealPlan({ reduced: false, page });
    assert.ok(plan, `${page} should animate`);
    assert.equal(plan.root, PAGE_ROOTS[page]);
    assert.equal(plan.root, plan.root.trim());
    assert.ok(plan.root.startsWith("."), `${page} root should be a class selector, got ${plan.root}`);
    // 首页没有计划：它的根是 main#top，动效层不该碰它。
    assert.notEqual(plan.root, "#top");
  }
  assert.equal(new Set(Object.values(PAGE_ROOTS)).size, PAGES.length, "roots must be distinct");
});

test("plan parameters stay inside the agreed medium band", () => {
  const plan = revealPlan({ reduced: false, page: "board" });
  assert.ok(plan.duration >= 300 && plan.duration <= 600, "duration should stay medium");
  assert.ok(plan.stagger > 0 && plan.stagger <= 80, "stagger should stay subtle");
  assert.ok(plan.distance > 0 && plan.distance <= 20, "travel distance should stay small");
  assert.match(plan.ease, /^out\(/, "ease should be an out-style easing");
  assert.equal(plan.duration, MOTION.duration);
  assert.equal(plan.stagger, MOTION.stagger);
  assert.equal(plan.distance, MOTION.distance);
});

test("boot script only hides content in a short, self-expiring window", () => {
  assert.ok(MOTION.windowMs > 0 && MOTION.windowMs <= 2000, "window must be short");
  assert.ok(MOTION_BOOT.includes(`${MOTION.windowMs}`), "boot must use the configured window");
  assert.ok(MOTION_BOOT.includes("removeAttribute"), "boot must be able to release the hidden state");
  assert.ok(MOTION_BOOT.includes(REDUCED_QUERY), "boot must honour the reduced-motion query");
  {
    // CSP nonce 化后内联脚本被禁，实际执行的是 public/motion-boot.js —— 两者必须语义一致（忽略空白）
    const norm = (text) => text.replace(/\s+/g, "").slice(text.replace(/\s+/g, "").indexOf("(function(){"));
    const file = norm(readFileSync(new URL("../public/motion-boot.js", import.meta.url), "utf8"));
    const inline = norm(MOTION_BOOT);
    assert.ok(file === inline, "public/motion-boot.js must stay in lockstep with MOTION_BOOT (whitespace-insensitive)");
  }
  assert.ok(!MOTION_BOOT.includes("data-reveal-done"), "the hidden state must expire on its own, not wait for the layer");
});

test("reveal modes are the two documented values", () => {
  assert.equal(REVEAL_BLOCK, "block");
  assert.equal(REVEAL_ITEM, "item");
});
