#!/usr/bin/env node
/**
 * 统一门禁入口：把「提交前必须过的东西」收敛成一条命令。
 *
 *   node scripts/ci/gates.mjs              # 全套（装作 GitHub Actions 会跑的事）
 *   node scripts/ci/gates.mjs --quick      # 只跑快的（lint + 单测），提交前随手跑
 *   node scripts/ci/gates.mjs --with-e2e   # 额外打一个运行中的站点（TEST_BASE_URL）
 *
 * 与 .github/workflows/ci.yml 的分工：
 *   - workflows 在 GitHub 的干净 runner 上跑 lint / 单测 / 两个构建目标，是"合并前"的闸；
 *   - 本脚本在**本地也跑同一套**，避免"推上去才发现 lint 不过"；
 *   - 部署后冒烟与对抗测试打的是运行中的站点，由 deploy/ci.sh 在服务器上触发，
 *     因为 GitHub runner 访问不到内网容器（本地要用 --with-e2e 并设好 TEST_BASE_URL）。
 *
 * 为什么两个构建目标都要过：代码同一份，Vercel 那份走 localStorage，
 * 自托管那份走 Postgres。只过其中一个，另一个可能在部署时才发现挂。
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

const QUICK = process.argv.includes("--quick");
const WITH_E2E = process.argv.includes("--with-e2e");

/** Windows 下 spawn 裸 npm 会 ENOENT，必须走 npm-cli.js 的绝对路径。 */
const NPM_CLI = "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js";
const useNodeCli = process.platform === "win32" && existsSync(NPM_CLI);

const steps = [];
const addStep = (title, command, args, options = {}) => steps.push({ title, command, args, ...options });

addStep("ESLint", ...(useNodeCli ? ["node", [NPM_CLI, "run", "lint"]] : ["npm", ["run", "lint"]]));
addStep("单元测试（scripts/*.test.mjs）", "node", ["--test", ...discoverTests()]);

if (!QUICK) {
  // 两个构建目标都跑：只过一个等于没验证另一个部署形态
  if (useNodeCli) {
    addStep("构建 · 自托管（next build）", "node", [NPM_CLI, "run", "build:vercel"]);
    addStep("构建 · Vercel", "node", [NPM_CLI, "run", "build:vercel"]);
  } else {
    addStep("构建 · 自托管（next build）", "npm", ["run", "build:vercel"]);
    addStep("构建 · Vercel", "npm", ["run", "build:vercel"]);
  }
}

if (WITH_E2E) {
  addStep("部署后冒烟（smoke）", "node", ["scripts/ci/smoke.mjs"]);
  addStep("对抗测试（adversarial）", "node", ["scripts/security/adversarial.mjs"]);
}

/** 收集仓库里所有 *.test.mjs（含 scripts/douyin 下的）。 */
function discoverTests() {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!["node_modules", ".next", "dist", "vendor"].includes(entry.name)) walk(full);
      } else if (entry.name.endsWith(".test.mjs")) {
        files.push(full);
      }
    }
  };
  walk("scripts");
  return files.sort();
}

function run({ title, command, args }) {
  return new Promise((resolve) => {
    console.log(`\n──── ${title} ────`);
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.on("error", (error) => {
      console.log(`无法启动：${error.message}`);
      resolve({ title, code: 1 });
    });
    child.on("close", (code) => resolve({ title, code: code ?? 1 }));
  });
}

console.log(`门禁清单（${steps.length} 步${QUICK ? "，快速模式" : ""}${WITH_E2E ? "，含端到端" : ""}）：`);
for (const step of steps) console.log(`  · ${step.title}`);

const failed = [];
for (const step of steps) {
  const result = await run(step);
  if (result.code !== 0) failed.push(step.title);
}

console.log("\n════════ 门禁结果 ════════");
for (const step of steps) {
  const bad = failed.includes(step.title);
  console.log(`${bad ? "✗ 失败" : "✓ 通过"}  ${step.title}`);
}
if (failed.length > 0) {
  console.log(`\n${failed.length} 项未通过，不要推送：\n  - ${failed.join("\n  - ")}`);
  process.exit(1);
}
console.log("\n全部门禁通过。");
