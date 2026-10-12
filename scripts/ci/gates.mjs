#!/usr/bin/env node
/**
 * 统一门禁入口：把「提交前必须过的东西」收敛成一条命令。
 *
 *   node scripts/ci/gates.mjs              # 全套（与 GitHub Actions 各 job 等价，含新增的静态分析）
 *   node scripts/ci/gates.mjs --quick      # 只跑快的（lint + 单测 + 静态扫描），提交前随手跑
 *   node scripts/ci/gates.mjs --with-e2e   # 额外打一个运行中的站点（TEST_BASE_URL）
 *   node scripts/ci/gates.mjs --with-db    # 额外跑数据库层测试（需要 DATABASE_URL）
 *
 * 与 .github/workflows/ci.yml 的分工（2026-10-12 二轮加固后）：
 *   - CI 并行 job：ESLint / shellcheck / actionlint / 单元测试 / 数据库层 / 构建+凭据扫描
 *                  / 依赖审计 / 授权矩阵 / 漂移守卫；
 *   - 本脚本串行跑等价的那几项，避免"推上去才发现 lint 不过"；
 *   - 数据库层需要真 Postgres：本地给 --with-db 并用 DATABASE_URL 指一个临时容器，
 *     没给就**明确列为"未跑"**而不是假装通过；
 *   - 部署后冒烟与对抗测试打的是运行中的站点，由 deploy/ci.sh 在服务器上触发，
 *     因为 GitHub runner 访问不到内网容器（本地用 --with-e2e 并设好 TEST_BASE_URL）。
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { DISABLE_SHELLCHECK_REASON, shellcheckAvailable } from "./static-analysis.mjs";
import { discoverTests, partitionByDbRequirement } from "./unit-tests.mjs";

const QUICK = process.argv.includes("--quick");
const WITH_E2E = process.argv.includes("--with-e2e");
const WITH_DB = process.argv.includes("--with-db");

/** Windows 下 spawn 裸 npm 会 ENOENT，必须走 npm-cli.js 的绝对路径。 */
const NPM_CLI = "C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js";
const useNodeCli = process.platform === "win32" && existsSync(NPM_CLI);

const steps = [];
const addStep = (title, command, args, options = {}) => steps.push({ title, command, args, ...options });

const npmRun = (script) => (useNodeCli ? ["node", [NPM_CLI, "run", script]] : ["npm", ["run", script]]);

addStep("ESLint", ...npmRun("lint"));

// 静态分析（原先是空白）：17 个运维脚本 + workflow 自身。
// 工具不可用时**不静默跳过** —— 打印明确原因并以失败计（除非显式设 HK_ALLOW_MISSING_TOOLS=1）。
if (shellcheckAvailable()) {
  addStep("ShellCheck（deploy 与 scripts 下全部 .sh）", "node", ["scripts/ci/static-analysis.mjs", "shellcheck"]);
  addStep("actionlint（workflow 自身）", "node", ["scripts/ci/static-analysis.mjs", "actionlint"]);
} else {
  console.log(`\n[注意] 跳过静态分析：${DISABLE_SHELLCHECK_REASON}`);
  console.log("        安装 docker 后本步会自动出现；CI 上由独立 job 保障。\n");
  if (process.env.HK_ALLOW_MISSING_TOOLS !== "1") {
    addStep("静态分析工具可用性检查", "node", ["-e", `console.error(${JSON.stringify(DISABLE_SHELLCHECK_REASON)}); process.exit(1)`]);
  }
}

const { run: unitFiles, deferred } = partitionByDbRequirement(discoverTests(), Boolean(process.env.DATABASE_URL));
// 文件清单由 scripts/ci/unit-tests.mjs 统一发现 —— CI 与本脚本共用同一份实现，
// 不再各写一个 glob（原先 CI 手写的 glob 漏了 scripts/events/events.test.mjs）。
addStep(`单元测试（${unitFiles.length} 个文件）`, "node", ["--test", ...unitFiles]);
if (deferred.length > 0) {
  console.log(`[注意] ${deferred.length} 个测试文件需要 DATABASE_URL，本次未跑：${deferred.join(", ")}`);
  console.log("        本地用 `--with-db` 并指一个临时 Postgres（见 docs/ci-testing.md），CI 由 db job 覆盖。");
}

addStep("授权矩阵（写方法/管理路由无守卫即失败）", "node", ["scripts/security/authz-matrix.mjs"]);
addStep("漂移守卫（timer 安装路径 / nginx 片段 / 死人开关接线）", "node", ["scripts/ci/drift-guard.mjs"]);

if (WITH_DB) {
  if (!process.env.DATABASE_URL) {
    console.log("\n[注意] --with-db 需要 DATABASE_URL（指向一个可丢弃的 Postgres），本次无法执行。");
  } else {
    addStep("数据库层（迁移 / append-only 触发器 / 限流 SQL）", "node", ["--test", "scripts/db-schema.test.mjs"]);
  }
}

if (!QUICK) {
  // 构建一次代表两种部署形态：Vercel（localStorage）与自托管（standalone）同一条命令，
  // 运行时差异由服务器侧的冒烟 + 对抗套件覆盖（部署后验证）。
  addStep("构建（Vercel 目标）", ...npmRun("build:vercel"));
  // 依赖审计：直接调 npm 可执行文件（不能用 `npm run -- audit`：npm 会把 `--` 之后当成
  // 脚本名而不是参数，报 "Missing script"）。npm audit 端点本机不可达（TLS 拦截/镜像不代理
  // audit），allowSkipOnEnv 让它在本地降级跳过，CI 上照常失败。
  const auditArgs = useNodeCli
    ? ["node", [NPM_CLI, "audit", "--omit=dev", "--audit-level=high"]]
    : ["npm", ["audit", "--omit=dev", "--audit-level=high"]];
  addStep("依赖漏洞审计（high 及以上失败）", ...auditArgs, { allowSkipOnEnv: true });
}

if (WITH_E2E) {
  addStep("部署后冒烟（smoke）", "node", ["scripts/ci/smoke.mjs"]);
  addStep("对抗测试（adversarial）", "node", ["scripts/security/adversarial.mjs"]);
  addStep("SEO 检查（结构化数据 / robots / sitemap）", "node", ["scripts/seo/audit.mjs"]);
}

/**
 * 跑一步。allowSkipOnEnv 的步骤（依赖审计）在本机出网受限、npm audit 端点不可达时
 * 降级为跳过而不是失败 —— 那道闸在 CI 上会照常跑，本地不该被网络问题卡住提交。
 */
function run({ title, command, args, allowSkipOnEnv }) {
  return new Promise((resolve) => {
    console.log(`\n──── ${title} ────`);
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let combined = "";
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      combined += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      combined += String(chunk);
    });
    child.on("error", (error) => {
      console.log(`无法启动：${error.message}`);
      resolve({ title, code: 1 });
    });
    child.on("close", (code) => {
      const envBlocked = /ENOTFOUND|ETIMEDOUT|self-signed certificate|audit endpoint returned an error|EAI_AGAIN|NOT_IMPLEMENTED/i.test(combined);
      if (code !== 0 && allowSkipOnEnv && envBlocked) {
        console.log("（本机出网受限，此步在 CI 上执行；跳过不阻塞提交）");
        resolve({ title, code: 0, skipped: true });
        return;
      }
      resolve({ title, code: code ?? 1 });
    });
  });
}

console.log(`门禁清单（${steps.length} 步${QUICK ? "，快速模式" : ""}${WITH_E2E ? "，含端到端" : ""}）：`);
for (const step of steps) console.log(`  · ${step.title}`);

const failed = [];
const skippedSteps = [];
for (const step of steps) {
  const result = await run(step);
  if (result.code === 0 && result.skipped) skippedSteps.push(step.title);
  if (result.code !== 0) failed.push(step.title);
}

console.log("\n════════ 门禁结果 ════════");
for (const step of steps) {
  const bad = failed.includes(step.title);
  const skip = skippedSteps.includes(step.title);
  console.log(`${bad ? "✗ 失败" : skip ? "－ 跳过（环境受限）" : "✓ 通过"}  ${step.title}`);
}
if (failed.length > 0) {
  console.log(`\n${failed.length} 项未通过，不要推送：\n  - ${failed.join("\n  - ")}`);
  process.exit(1);
}
if (skippedSteps.length > 0) {
  console.log(`\n${skippedSteps.length} 项因本机环境受限被跳过（CI 上会执行）：\n  - ${skippedSteps.join("\n  - ")}`);
}
console.log("\n全部门禁通过。");
