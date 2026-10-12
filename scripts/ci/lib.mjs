/**
 * CI 与对抗测试共用的基础设施：HTTP 请求、断言、结果汇总。
 *
 * 纯 Node 标准库，无第三方依赖 —— 这样它既能跑在 GitHub Actions 的干净 runner 上，
 * 也能直接跑在服务器宿主机的 node 里（服务器只有 Docker，没有装 node）。
 * 全部测试脚本共用这一份，避免每个套件各写一遍记录格式。
 *
 * 两个刻意的设计（都是被"假绿"逼出来的）：
 *
 *   1. **前置状态码失败时，后续断言记 skipped 而不是静默消失。**
 *      原先写 `if (res.status === 200) { check(契约字段…) }`，一旦接口返回 503，
 *      这些断言就**不存在**了，汇总里总数还是"全过"。现在用 assertStatus() 无条件
 *      记录前置断言，失败时把后续断言显式记为 skipped 并计入汇总 ——
 *      默认 skipped > 0 即退出非零，让"少测了几条"和"都过了"区分开。
 *
 *   2. **机器可读报告（REPORT_JSON）。** 渗透管线原先用正则去解析本文件的
 *      `[FAIL] name — detail` 文本输出，格式一改就悄悄失效。现在 report() 可以写
 *      JSON，跨进程消费走 JSON 而不是解析人读输出。
 */

import { writeFileSync } from "node:fs";

export const DEFAULT_BASE = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3210";

/** 带超时的 fetch；永不抛错，返回 { status, headers, body, error }。 */
export async function req(url, options = {}) {
  const { timeoutMs = 15000, ...rest } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...rest, signal: controller.signal });
    const text = await response.text();
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: text,
      error: null,
    };
  } catch (error) {
    return { status: 0, headers: {}, body: "", error: error?.message ?? String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** 认证会话探针：设了 TEST_SESSION_COOKIE 就带上，用于验证"有权限者能进"这条正向路径。 */
export function sessionHeaders() {
  const cookie = process.env.TEST_SESSION_COOKIE;
  return cookie ? { cookie } : {};
}

export function get(base, path, options) {
  return req(`${base}${path}`, {
    ...options,
    headers: { ...sessionHeaders(), ...(options?.headers ?? {}) },
    redirect: options?.redirect ?? "manual",
  });
}

export function postJson(base, path, payload, options = {}) {
  return req(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...sessionHeaders(), ...(options.headers ?? {}) },
    body: JSON.stringify(payload),
    ...options,
  });
}

/** 判定：返回 true/false，并把说明写进 detail。 */
export function check(results, name, passed, detail) {
  results.push({ name, passed: Boolean(passed), skipped: false, detail });
  return Boolean(passed);
}

/**
 * 前置条件断言：无条件记录一条结果，返回是否成立。
 * 成立 → passed；不成立 → failed（后续断言由 skipGroup 记为 skipped）。
 */
export function precondition(results, name, passed, detail) {
  return check(results, name, passed, detail);
}

/**
 * 前置失败时，把一组后续断言显式记为 skipped。
 *
 * 用法：
 *   if (precondition(results, "GET /api/x 返回 200", res.status === 200, `实际 ${res.status}`)) {
 *     check(results, "含字段 a", "a" in data, …);
 *   } else {
 *     skipGroup(results, ["含字段 a", "a 是数组"], `前置：GET /api/x 返回 ${res.status}`);
 *   }
 *
 * 这样"因为接口挂了所以没测字段"会变成 skipped=2 而不是"没有这两条"。
 */
export function skipGroup(results, names, reason) {
  for (const name of names) {
    results.push({ name, passed: false, skipped: true, detail: `跳过：${reason}` });
  }
}

export function summary(results) {
  const skipped = results.filter((item) => item.skipped);
  const failed = results.filter((item) => !item.passed && !item.skipped);
  const ok = results.filter((item) => item.passed);
  return {
    total: results.length,
    ok: ok.length,
    failed: failed.length,
    skipped: skipped.length,
    failures: failed,
    skippedList: skipped,
  };
}

/**
 * 打印结果；返回进程退出码。
 *
 * **默认 `skipped > 0` 也算失败。** 理由：跳过的断言等于没测 —— 允许它默默存在，
 * 就是把"接口挂了"伪装成"全过"。
 *
 * 但确实存在"合理地不适用"的跳过（最典型：对回环 HTTP 目标检查 https 跳转）。
 * 这类跳过**必须被逐个点名**，不能用一把开关整体放行 —— 否则新出现的意外跳过
 * 会跟着一起被容忍，护栏就形同虚设：
 *   - `REPORT_ALLOW_SKIP_NAMES`：允许的跳过项名称，逗号或换行分隔，精确匹配；
 *   - `REPORT_ALLOW_SKIP=1`：放行全部跳过（只在确实需要时用，日志里会留痕）。
 */
export function report(title, results, { verbose = false } = {}) {
  const stats = summary(results);
  const allowSkip = process.env.REPORT_ALLOW_SKIP === "1";
  const allowNames = new Set(
    (process.env.REPORT_ALLOW_SKIP_NAMES ?? "")
      .split(/[,\n]/)
      .map((name) => name.trim())
      .filter(Boolean),
  );
  const unexpectedSkips = allowSkip
    ? []
    : stats.skippedList.filter((item) => !allowNames.has(item.name));
  const skippedIsFailure = unexpectedSkips.length > 0;

  console.log(`\n=== ${title} ===`);
  for (const item of results) {
    const mark = item.skipped ? "SKIP" : item.passed ? "PASS" : "FAIL";
    if (!item.passed || verbose) console.log(`[${mark}] ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  }
  let skipNote = "";
  if (stats.skipped > 0) {
    if (allowSkip) skipNote = `，${stats.skipped} 跳过（REPORT_ALLOW_SKIP=1，不计失败）`;
    else if (skippedIsFailure) skipNote = `，${stats.skipped} 跳过（其中 ${unexpectedSkips.length} 项未在允许清单里 → 计为失败）`;
    else skipNote = `，${stats.skipped} 跳过（均在允许清单里）`;
  }
  console.log(`\n${stats.ok}/${stats.total} 通过，${stats.failed} 失败${skipNote}`);
  if (stats.failed > 0) {
    console.log("\n失败项：");
    for (const item of stats.failures) console.log(`  - ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  }
  if (stats.skipped > 0) {
    console.log("\n跳过项：");
    for (const item of stats.skippedList) {
      const allowed = allowNames.has(item.name) || allowSkip;
      console.log(`  - [${allowed ? "已允许" : "未允许"}] ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
    }
  }

  // 机器可读报告：跨进程消费走 JSON，不要解析上面这段人读文本
  const jsonPath = process.env.REPORT_JSON;
  if (jsonPath) {
    try {
      const payload = {
        title,
        base: DEFAULT_BASE,
        generatedAt: new Date().toISOString(),
        total: stats.total,
        ok: stats.ok,
        failed: stats.failed,
        skipped: stats.skipped,
        unexpectedSkips: unexpectedSkips.map((item) => item.name),
        results: results.map((item) => ({
          name: item.name,
          passed: item.passed,
          skipped: item.skipped,
          detail: item.detail ?? null,
        })),
      };
      // 用同步写：report() 是套件最后一步，紧接着就 process.exit，
      // 异步写可能没落盘就退出（踩过一次）。
      writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
      console.log(`\n机器可读报告已写入 ${jsonPath}`);
    } catch (error) {
      console.error(`写 REPORT_JSON 失败：${error?.message ?? error}`);
      return 1;
    }
  }

  if (stats.failed > 0 || skippedIsFailure) return 1;
  return 0;
}

/** 常用断言集合。 */
export const expect = {
  status: (result, want) => ({ passed: result.status === want, detail: `期望 ${want}，实际 ${result.status}${result.error ? ` (${result.error})` : ""}` }),
  statusIn: (result, wants) => ({ passed: wants.includes(result.status), detail: `期望其中之一 ${wants.join("/")}，实际 ${result.status}` }),
  includes: (haystack, needle) => ({ passed: String(haystack).includes(needle), detail: `应包含 "${needle}"` }),
  excludes: (haystack, needle) => ({ passed: !String(haystack).includes(needle), detail: `不应包含 "${needle}"` }),
  header: (result, name, value) => {
    const actual = result.headers[name.toLowerCase()] ?? "";
    return { passed: actual.includes(value), detail: `${name}: "${actual}" 应包含 "${value}"` };
  },
  headerAbsent: (result, name) => ({
    passed: !(name.toLowerCase() in result.headers),
    detail: `${name} 不应出现，实际 "${result.headers[name.toLowerCase()] ?? ""}"`,
  }),
  headerPresent: (result, name) => ({
    passed: Boolean(result.headers[name.toLowerCase()]),
    detail: `${name} 应存在`,
  }),
  custom: (passed, detail) => ({ passed: Boolean(passed), detail }),
};
