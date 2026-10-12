#!/usr/bin/env node
/**
 * 统一门禁入口：把「提交前必须过的东西」收敛成一条命令。
 *
 *   node scripts/ci/gates.mjs              # 全套（与 GitHub Actions 的 5 个 job 等价）
 *   node scripts/ci/gates.mjs --quick      # 只跑快的（lint + 单测），提交前随手跑
 *   node scripts/ci/gates.mjs --with-e2e   # 额外打一个运行中的站点（TEST_BASE_URL）
 *
 * 与 .github/workflows/ci.yml 的分工（2026-10-12 起，参考 shadcn-ui/ui 的
 * code-check.yml：CI 侧是 5 个**并行** job，本地仍是串行一条命令）：
 *   - CI 并行跑：ESLint / 单元测试 / 构建+凭据扫描 / 依赖审计 / 授权矩阵；
 *   - 本脚本串行跑同样五项，避免"推上去才发现 lint 不过"；
 *   - 部署后冒烟与对抗测试打的是运行中的站点，由 deploy/ci.sh 在服务器上触发，
 *     因为 GitHub runner 访问不到内网容器（本地要用 --with-e2e 并设好 TEST_BASE_URL）。
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

// 五项对应 .github/workflows/ci.yml 的五个并行 job
addStep("ESLint", ...(useNodeCli ? ["node", [NPM_CLI, "run", "lint"]] : ["npm", ["run", "lint"]]));
addStep("单元测试（scripts/*.test.mjs）", "node", ["--test", ...discoverTests()]);

if (!QUICK) {
  // 构建一次代表两种部署形态：Vercel（localStorage）与自托管（standalone）同一条命令，
  // 运行时差异由服务器侧的冒烟 + 对抗套件覆盖（部署后验证）。
  addStep("构建（Vercel 目标）", ...(useNodeCli ? ["node", [NPM_CLI, "run", "build:vercel"]] : ["npm", ["run", "build:vercel"]]));
  // 依赖审计：直接调 npm 可执行文件（不能用 `npm run -- audit`：npm 会把 `--` 之后当成
  // 脚本名而不是参数，报 "Missing script"）。npm audit 端点本机不可达（TLS 拦截/镜像不代理
  // audit），allowSkipOnEnv 让它在本地降级跳过，CI 上照常失败。
  const auditArgs = useNodeCli
    ? ["node", [NPM_CLI, "audit", "--omit=dev", "--audit-level=high"]]
    : ["npm", ["audit", "--omit=dev", "--audit-level=high"]];
  addStep("依赖漏洞审计（high 及以上失败）", ...auditArgs, { allowSkipOnEnv: true });
  addStep("授权矩阵（写方法无守卫即失败）", "node", ["scripts/security/authz-matrix.mjs"]);
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
