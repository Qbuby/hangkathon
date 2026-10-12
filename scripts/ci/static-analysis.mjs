#!/usr/bin/env node
/**
 * 静态分析：把 shellcheck 与 actionlint 收在一处，提供给 gates.mjs 与 CI 调用。
 *
 * 为什么需要它们（本项目实测的空白）：
 *   · 17 个运维脚本此前**零静态检查**，而那批"静默失败"缺陷恰好就在 shellcheck
 *     的核心规则集里：SC2181（不判退出码）、SC2312（管道掩盖）、SC2162（read 缺 -r）、
 *     SC2046（未引用的命令替换）。
 *   · workflow 自身（ci.yml）此前也没人检查语法/表达式/上下文，
 *     一个写错的 `${{ }}` 要等推送后 GitHub 报错才知道。
 *
 * 工具经 docker 运行（参考各自官方镜像：koalaman/shellcheck、rhysd/actionlint），
 * 与项目其它地方一致 —— 宿主机不装额外东西。
 * 注意：Windows 上要设 MSYS_NO_PATHCONV=1，否则 Git Bash 会把 /w 改写成 Windows 路径。
 *
 * 用法：
 *   node scripts/ci/static-analysis.mjs shellcheck
 *   node scripts/ci/static-analysis.mjs actionlint
 */

import { spawnSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export const DISABLE_SHELLCHECK_REASON =
  "未检测到可用的 docker，shellcheck / actionlint 无法运行（CI 上由独立 job 保障）";

/** docker 可用性。所有静态分析工具都走容器。 */
export function shellcheckAvailable() {
  const probe = spawnSync("docker", ["--version"], { encoding: "utf8" });
  return probe.status === 0;
}

function dockerRun(args, label) {
  const result = spawnSync("docker", args, {
    stdio: "inherit",
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
  });
  if (result.error) {
    console.error(`${label} 无法启动：${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

/** 收集要交给 shellcheck 的脚本（相对仓库根）。 */
export function collectShellScripts(root = ".") {
  const files = [];
  const deployDir = join(root, "deploy");
  if (existsSync(deployDir)) {
    for (const name of readdirSync(deployDir)) {
      if (name.endsWith(".sh")) files.push(`deploy/${name}`);
    }
    const libDir = join(deployDir, "lib");
    if (existsSync(libDir)) {
      for (const name of readdirSync(libDir)) {
        if (name.endsWith(".sh")) files.push(`deploy/lib/${name}`);
      }
    }
  }
  const scriptsDir = join(root, "scripts");
  if (existsSync(scriptsDir)) {
    for (const name of readdirSync(scriptsDir)) {
      if (name.endsWith(".sh")) files.push(`scripts/${name}`);
    }
  }
  return files.sort();
}

export function runShellcheck(root = ".") {
  const scripts = collectShellScripts(root);
  if (scripts.length === 0) {
    console.error("没有找到任何 shell 脚本 —— 路径不对？");
    return 1;
  }
  console.log(`shellcheck：${scripts.length} 个脚本，severity >= warning`);
  // -x 跟随 `# shellcheck source=...`，让公共库的函数定义对每个脚本可见，
  // 否则每个脚本都会对 hk_init / log / hk_ping 报 SC2154/SC1001 之类的假问题。
  return dockerRun(
    [
      "run", "--rm",
      "-v", `${process.cwd()}:/w:ro`,
      "-w", "/w",
      "koalaman/shellcheck:stable",
      "-S", "warning", "-x", "-f", "gcc",
      ...scripts,
    ],
    "shellcheck",
  );
}

export function runActionlint() {
  console.log("actionlint：检查 .github/workflows 下的全部 workflow");
  return dockerRun(
    ["run", "--rm", "-v", `${process.cwd()}:/w:ro`, "-w", "/w", "rhysd/actionlint:latest"],
    "actionlint",
  );
}

const isMain = process.argv[1]?.endsWith("static-analysis.mjs");
if (isMain) {
  const which = process.argv[2];
  if (!shellcheckAvailable()) {
    console.error(DISABLE_SHELLCHECK_REASON);
    process.exit(2);
  }
  const code = which === "actionlint" ? runActionlint() : runShellcheck();
  if (code !== 0) console.error(`\n${which ?? "shellcheck"} 发现问题（退出码 ${code}）`);
  process.exit(code);
}
