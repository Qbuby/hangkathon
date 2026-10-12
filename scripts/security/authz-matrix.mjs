#!/usr/bin/env node
/**
 * 授权矩阵扫描（改编自 superagent-ai/skills 的 authz-security：
 * "broken access control (IDOR/BOLA) in your application code"）。
 *
 * 静态枚举 app/api 下所有 route.ts 的全部 HTTP 方法，并核对每个**方法体**带了哪些守卫：
 *   databaseRequired / currentUser / requireUser / requirePublisher / requireAdmin
 * 规则：
 *   - 写方法（POST/PATCH/PUT/DELETE）必须带至少一个 require* 守卫（currentUser 只算读级）；
 *   - /api/admin/** 的每个方法必须 requireAdmin；
 *   - 完全无守卫的方法列出来人工复核（公开 GET 是合法的，如 /api/activities）。
 *
 * **按方法切分而不是整文件匹配**（2026-10-12 修）：
 * 原先用 `new RegExp(guard).test(整个文件)` 判断，于是同一个 route.ts 里
 * GET 写了 requireAdmin、PATCH 什么都没写，也会被判成"PATCH 有守卫"。
 * 管理路由最常见的安全缺陷正是"读接口加守卫、写接口漏加"，
 * 整文件匹配对这个模式**恰好完全失明**。现在每个方法只在自己的函数体里找守卫。
 *
 * 这是"编码规则而非服务"的离线扫描器 —— 接进 CI 或手动跑都行：
 *   node scripts/security/authz-matrix.mjs
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const STRONG_GUARDS = ["requireUser", "requirePublisher", "requireAdmin"];
const WEAK_GUARDS = ["databaseRequired", "currentUser", "timingSafeEqual"];
const GUARDS = [...STRONG_GUARDS, ...WEAK_GUARDS];
const rows = [];
const problems = [];

/**
 * 把 route.ts 切成 `{ METHOD: 函数体源码 }`。
 *
 * 切法：找到每个 `export async function METHOD(` 的起点，取到下一个 export/文件末尾。
 * 用"下一个 export 开头"而不是配对大括号 —— 大括号计数会被字符串/正则里的花括号带偏，
 * 而这种粗糙切分对"这个函数体里出现过 requireX 吗"这个问题已经足够且不会误判成"有守卫"。
 */
function splitByMethod(source) {
  const out = {};
  const re = /export\s+async\s+function\s+(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\s*\(/g;
  const marks = [...source.matchAll(re)].map((match) => ({ method: match[1], index: match.index }));
  for (let i = 0; i < marks.length; i += 1) {
    const start = marks[i].index;
    const end = i + 1 < marks.length ? marks[i + 1].index : source.length;
    out[marks[i].method] = source.slice(start, end);
  }
  return out;
}

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === "route.ts") rows.push(full);
  }
}
walk("app/api");

for (const file of rows) {
  const source = readFileSync(file, "utf8");
  // Windows 下路径分隔符是 \，不归一化的话 startsWith("/api/auth/") 这类前缀判断全失效
  const route = file.replaceAll("\\", "/").replace(/^app/, "").replace(/\/route\.ts$/, "") || "/";
  const bodies = splitByMethod(source);
  const methods = Object.keys(bodies);
  const isAdminRoute = route.startsWith("/api/admin");

  if (methods.length === 0) {
    problems.push(`${route} —— 未识别出任何 HTTP 方法（文件结构异常，或写法不在 splitByMethod 的覆盖范围内）`);
    continue;
  }

  for (const method of methods) {
    const body = bodies[method];
    // 守卫只在**这个方法自己的函数体**里找。整文件匹配会让"GET 有 requireAdmin、
    // PATCH 没写"这种情况被误判成安全 —— 而管理路由最典型的缺陷就是这个形态。
    const guards = GUARDS.filter((guard) => new RegExp(`\\b${guard}\\b`).test(body));
    const isWrite = WRITE_METHODS.has(method);
    const hasStrongGuard = guards.some((guard) => STRONG_GUARDS.includes(guard));

    let status = "public";
    if (!guards.includes("databaseRequired")) status = "no-db-guard";
    else if (guards.includes("requireAdmin")) status = "admin";
    else if (guards.includes("timingSafeEqual")) status = "token";
    else if (guards.includes("requirePublisher")) status = "publisher";
    else if (guards.includes("requireUser")) status = "user";
    else if (guards.includes("currentUser")) status = "viewer";

    // token 守卫（抓取入库口）与 /api/auth（Auth.js 入口本身，带限流）是刻意的公开写
    if (isWrite && !hasStrongGuard && status !== "token" && !route.startsWith("/api/auth/")) {
      problems.push(`${method} ${route} —— 写方法无 require* 守卫（当前判定 ${status}）`);
    }
    // 管理路由的**每个**方法都要 requireAdmin（原先只查 GET，于是 PATCH/DELETE 完全没被检）
    if (isAdminRoute && !guards.includes("requireAdmin") && route !== "/api/admin/session") {
      problems.push(`${method} ${route} —— 管理路由缺 requireAdmin（当前判定 ${status}）`);
    }
    console.log(`${method.padEnd(6)} ${route.padEnd(52)} ${status.padEnd(12)} 守卫[${guards.join(",") || "无"}]`);
  }
}

console.log(`\n共 ${rows.length} 个路由文件。`);
if (problems.length > 0) {
  console.log("\n疑似问题（人工复核）：");
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exit(1);
}
console.log("未发现缺守卫的写方法或管理路由方法。");
