#!/usr/bin/env node
/**
 * 单测发现 + 执行（唯一实现）。
 *
 * 为什么要有这个文件：CI 里原先写的是
 *     node --test scripts/*.test.mjs scripts/douyin/*.test.mjs
 * 手写的 glob —— 一有新目录就漏。实际已经漏了 `scripts/events/events.test.mjs`
 * （4 个用例，占全部用例的 10%），而且漏的方式是**静默的**：CI 依旧全绿。
 *
 * 现在发现逻辑只有这一份，CI 与本地 gates.mjs 都调用它，不可能再出现
 * "本地能跑、CI 不跑"的差集。
 *
 * 用法：
 *   node scripts/ci/unit-tests.mjs            # 发现并执行全部单测
 *   node scripts/ci/unit-tests.mjs --list     # 只打印文件清单（给 CI 拼命令用）
 */

import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";

/** 递归收集仓库里所有 *.test.mjs。 */
export function discoverTests(root = "scripts") {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        // vendor/ 是第三方源码快照，不测它；其余目录一律进
        if (!["node_modules", ".next", "dist", "vendor"].includes(entry.name)) walk(full);
      } else if (entry.name.endsWith(".test.mjs")) {
        files.push(full);
      }
    }
  };
  walk(root);
  return files.sort();
}

/**
 * 需要真实数据库的测试文件（内容里有 `process.env.DATABASE_URL` 的引用）会被单独识别：
 * 没设 DATABASE_URL 时**不把它们塞进本次运行**，而是明确打一行提示。
 *
 * 为什么不放着让 node --test 标 skip：那样输出里会出现一行 "skipped 5"，
 * 容易被读成"这几个用例只是暂时跳过，其余都过了"，从而以为数据库层已被覆盖 ——
 * 实际上它们由 CI 的独立 db job（带 postgres service）负责。
 * 与其留一个需要正确解读的 skipped 计数，不如把这几个文件从本次范围里**显式移出**。
 */
export function partitionByDbRequirement(files, hasDb) {
  const withDb = [];
  const withoutDb = [];
  for (const file of files) {
    const needsDb = readFileSync(file, "utf8").includes("process.env.DATABASE_URL");
    (needsDb ? withDb : withoutDb).push(file);
  }
  return hasDb ? { run: files, deferred: [] } : { run: withoutDb, deferred: withDb };
}

// 直接用 `node scripts/ci/unit-tests.mjs` 跑时才执行下面这段；
// 被 import 时不产生副作用（gates.mjs 要复用 discoverTests）。
// 比较用 pathToFileURL：Git Bash 下 process.argv[1] 是 /d/... 而 import.meta.url 是
// file:///D:/...，字符串比较永远不等 —— 那会让直接执行时**什么都不做**，静默通过。
const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === pathToFileURL(fileURLToPath(import.meta.url)).href;

if (isMain) {
  const all = discoverTests();
  if (process.argv.includes("--list")) {
    // --list 给 CI 拼命令用：既然调用方自己决定要不要数据库，这里按当前环境过滤
    const { run } = partitionByDbRequirement(all, Boolean(process.env.DATABASE_URL));
    console.log(run.join(" "));
    process.exit(0);
  }
  if (all.length === 0) {
    console.error("没有发现任何 *.test.mjs —— 这本身就是异常（是不是路径写错了？）");
    process.exit(1);
  }
  const { run: files, deferred } = partitionByDbRequirement(all, Boolean(process.env.DATABASE_URL));
  console.log(`发现 ${all.length} 个测试文件，本次运行 ${files.length} 个：`);
  for (const file of files) console.log(`  · ${file}`);
  if (deferred.length > 0) {
    console.log(`\n未纳入本次运行（需要 DATABASE_URL，由 CI 的 db job 覆盖）：`);
    for (const file of deferred) console.log(`  · ${file}`);
  }
  const child = spawn(process.execPath, ["--test", ...files], { stdio: "inherit" });
  child.on("close", (code) => process.exit(code ?? 1));
}
