/**
 * CI 与对抗测试共用的基础设施：HTTP 请求、断言、结果汇总。
 *
 * 纯 Node 标准库，无第三方依赖 —— 这样它既能跑在 GitHub Actions 的干净 runner 上，
 * 也能直接跑在服务器宿主机的 node 里（服务器只有 Docker，没有装 node）。
 * 全部测试脚本共用这一份，避免每个套件各写一遍记录格式。
 */

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

export function get(base, path, options) {
  return req(`${base}${path}`, { ...options, redirect: options?.redirect ?? "manual" });
}

export function postJson(base, path, payload, options = {}) {
  return req(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    body: JSON.stringify(payload),
    ...options,
  });
}

/** 判定：返回 true/false，并把说明写进 detail。 */
export function check(results, name, passed, detail) {
  results.push({ name, passed: Boolean(passed), detail });
  return Boolean(passed);
}

export function summary(results) {
  const failed = results.filter((item) => !item.passed);
  const ok = results.filter((item) => item.passed);
  return { total: results.length, ok: ok.length, failed: failed.length, failures: failed };
}

/** 打印结果；返回进程退出码（0 = 全过）。 */
export function report(title, results, { verbose = false } = {}) {
  const stats = summary(results);
  console.log(`\n=== ${title} ===`);
  for (const item of results) {
    const mark = item.passed ? "PASS" : "FAIL";
    if (!item.passed || verbose) console.log(`[${mark}] ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  }
  console.log(`\n${stats.ok}/${stats.total} 通过，${stats.failed} 失败`);
  if (stats.failed > 0) {
    console.log("\n失败项：");
    for (const item of stats.failures) console.log(`  - ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
  }
  return stats.failed === 0 ? 0 : 1;
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
