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
 *   - 完全无守卫的方法列出来人工复核（公开 GET 是合法的，如 /api/activities）；
 *   - **例外只有一个**：/api/feishu/events。它的授权不来自会话而来自飞书请求签名
 *     （parseInbound 验签 + 时间窗），把它当成"无守卫"是误报；反过来，
 *     放行条件必须**逐条钉死**（见 SIGNATURE_GUARDED_ROUTES），不能变成
 *     "哪个路由写了 parseInbound 就算有守卫"——那等于给所有人开了一扇门。
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

/**
 * 签名守卫路由白名单（封闭集合，逐条钉死）。
 *
 * 为什么需要它：飞书事件端点没有会话，它的"调用者身份"来自 HMAC 签名。
 * 静态扫描器只认 require* 系列，看不见签名，所以会把这个端点报成
 * "POST 无守卫"。而这个端点能执行管理员操作，绝不能为了让扫描器闭嘴
 * 就把它降级成公开路由 —— 必须让扫描器理解这种守卫，并要求它真的写了验签。
 *
 * **不要把它改成"文件里出现 parseInbound 就算有守卫"**：那样任何路由
 * 都可以 import 一下 parseInbound 来骗过这条检查。
 */
const SIGNATURE_GUARDED_ROUTES = new Map([
  // 路由 -> 该路由方法体里必须出现的守卫调用（任一即可）
  ["/api/feishu/events", ["parseInbound("]],
  /**
   * 微信公众号消息回调：授权来自**微信的 sha1 签名**，不是会话。
   * 不验签的话，攻击者猜中一个 6 位验证码就能把自己的 openid 绑上去冒充登录，
   * 所以这条路由的"守卫"是 verifyWechatSignature / verifyWechatMsgSignature。
   */
  ["/api/wechat/mp", ["verifyWechatSignature(", "verifyWechatMsgSignature("]],
]);
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

    /**
     * 签名守卫：只在封闭白名单里的路由生效，且必须真的在**这个方法体**里调用了
     * 对应的验签函数。少了"逐条钉死"这一步，这条检查就成了可以被绕过的装饰。
     */
    const signatureGuards = SIGNATURE_GUARDED_ROUTES.get(route) ?? [];
    const hasSignatureGuard = signatureGuards.some((call) => body.includes(call));

    let status = "public";
    if (hasSignatureGuard) status = "signature";
    else if (!guards.includes("databaseRequired")) status = "no-db-guard";
    else if (guards.includes("requireAdmin")) status = "admin";
    else if (guards.includes("timingSafeEqual")) status = "token";
    else if (guards.includes("requirePublisher")) status = "publisher";
    else if (guards.includes("requireUser")) status = "user";
    else if (guards.includes("currentUser")) status = "viewer";

    // token 守卫（抓取入库口）与 /api/auth（Auth.js 入口本身，带限流）是刻意的公开写
    if (isWrite && !hasStrongGuard && !hasSignatureGuard && status !== "token" && !route.startsWith("/api/auth/")) {
      problems.push(`${method} ${route} —— 写方法无 require* 守卫（当前判定 ${status}）`);
    }
    // 白名单里的路由却没写验签 —— 比"没有守卫"更严重：等于把管理端口开到公网
    if (signatureGuards.length > 0 && !hasSignatureGuard) {
      problems.push(`${method} ${route} —— 在签名守卫白名单里却没有调用验签（${signatureGuards.join(" 或 ")}），等于无守卫的公网管理入口`);
    }
    // 管理路由的**每个**方法都要 requireAdmin（原先只查 GET，于是 PATCH/DELETE 完全没被检）
    if (isAdminRoute && !guards.includes("requireAdmin") && route !== "/api/admin/session") {
      problems.push(`${method} ${route} —— 管理路由缺 requireAdmin（当前判定 ${status}）`);
    }
    console.log(`${method.padEnd(6)} ${route.padEnd(52)} ${status.padEnd(12)} 守卫[${guards.join(",") || (hasSignatureGuard ? "签名" : "无")}]`);
  }
}

console.log(`\n共 ${rows.length} 个路由文件。`);
if (problems.length > 0) {
  console.log("\n疑似问题（人工复核）：");
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exit(1);
}
console.log("未发现缺守卫的写方法或管理路由方法。");
