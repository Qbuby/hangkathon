#!/usr/bin/env node
/**
 * 授权矩阵扫描（改编自 superagent-ai/skills 的 authz-security：
 * "broken access control (IDOR/BOLA) in your application code"）。
 *
 * 静态枚举 app/api 下所有 route.ts 的全部 HTTP 方法，并核对每个文件带了哪些守卫：
 *   databaseRequired / currentUser / requireUser / requirePublisher / requireAdmin
 * 规则：
 *   - 写方法（POST/PATCH/PUT/DELETE）必须带至少一个 require* 守卫（currentUser 只算读级）；
 *   - /api/admin/** 必须 requireAdmin；
 *   - 完全无守卫的方法列出来人工复核（公开 GET 是合法的，如 /api/activities）。
 *
 * 这是"编码规则而非服务"的离线扫描器 —— 接进 CI 或手动跑都行：
 *   node scripts/security/authz-matrix.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const GUARDS = ["databaseRequired", "currentUser", "requireUser", "requirePublisher", "requireAdmin", "timingSafeEqual"];
const rows = [];
const problems = [];

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
  const methods = [...source.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)/g)].map((match) => match[1]);
  const guards = GUARDS.filter((guard) => new RegExp(`\\b${guard}\\b`).test(source));
  const isAdminRoute = route.startsWith("/api/admin");

  for (const method of methods) {
    const isWrite = WRITE_METHODS.has(method);
    const hasStrongGuard = guards.some((guard) => ["requireUser", "requirePublisher", "requireAdmin"].includes(guard));
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
    if (isAdminRoute && method === "GET" && !guards.includes("requireAdmin") && route !== "/api/admin/session") {
      // /api/admin/session 是刻意的匿名探针（对抗测试有专项断言），其余管理读接口必须 admin
      problems.push(`GET ${route} —— 管理路由缺 requireAdmin`);
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
console.log("未发现缺守卫的写方法或管理读接口。");
