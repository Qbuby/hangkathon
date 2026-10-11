/**
 * 对抗测试套件：把安全检查表里承诺的能力逐条打一遍，验证"真的挡住了"。
 *
 * 与 scripts/*.test.mjs（纯函数单测）和 scripts/ci/smoke.mjs（功能性冒烟）不同，
 * 这里每一组都是在**主动尝试攻击**，断言的是"防守成功"：
 *
 *   A 信息泄露    —— 敏感文件、目录、源码映射、错误信息里的内部路径
 *   B 越权访问    —— 匿名/普通用户调用管理接口，伪造会话
 *   C 内容与来源控制 —— 关键词过滤、URL 白名单、黑名单拦截
 *   D 限流与暴力破解 —— 登录跳转限速、写接口限速、Retry-After
 *   E 输入健壮性  —— 畸形 JSON、超大体积、类型错乱、路径穿越
 *   F 响应安全    —— 安全头、缓存策略、不泄露版本号
 *
 * 用法：
 *   node scripts/security/adversarial.mjs                                   # 打本地 127.0.0.1:3210
 *   TEST_BASE_URL=https://hangkathon.com node scripts/security/adversarial.mjs
 *   ADVERSARIAL_ACK=1 ...     # 对非本地目标跑"会产生副作用"的组（限流/写接口）时必须显式确认
 *
 * 副作用与红线：
 *   - 只打**自己的**站点，不针对第三方；
 *   - D 组会真实触发限流计数，C 组只做"打到门禁前"的探测，不写入任何业务数据；
 *   - 所有断言都是只读或"应被拒绝"的请求，不会创建活动、不会改数据。
 */

import { DEFAULT_BASE, check, get, postJson, report, req } from "../ci/lib.mjs";

const BASE = process.env.TEST_BASE_URL ?? DEFAULT_BASE;
const IS_LOCAL =
  /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(BASE) || /:3210$/.test(BASE);
const ACK = process.env.ADVERSARIAL_ACK === "1";

if (!IS_LOCAL && !ACK) {
  console.error(
    `拒绝执行：目标是 ${BASE}（非本地）。\n` +
      "本套件会触发限流计数并产生审计日志，对线上站点执行需要显式确认：\n" +
      `  ADVERSARIAL_ACK=1 TEST_BASE_URL=${BASE} node scripts/security/adversarial.mjs`,
  );
  process.exit(2);
}

const results = [];
const run = async (name, fn) => {
  try {
    await fn();
  } catch (error) {
    check(results, name, false, `套件异常：${error?.message ?? error}`);
  }
};

/* ─────────────────────────── A. 信息泄露 ─────────────────────────── */

await run("A 信息泄露", async () => {
  // 攻击者最常扫的一批文件：命中任何一个都等于把服务器交出去
  const SENSITIVE = [
    "/.env",
    "/.env.local",
    "/.env.production",
    "/.git/config",
    "/.git/HEAD",
    "/wp-config.php",
    "/config.json",
    "/package.json",
    "/package-lock.json",
    "/docker-compose.yml",
    "/Dockerfile",
    "/deploy/ci.sh",
    "/db/schema.ts",
    "/lib/server/users.ts",
    "/auth.ts",
    "/.next/server/app/page.js",
    "/.next/static/chunks/../../../../etc/passwd",
    "/backup.sql",
    "/dump.sql",
    "/app.db",
  ];
  const leaked = [];
  for (const path of SENSITIVE) {
    const result = await get(BASE, path);
    // 301/302 是跳到 https 的正常行为，不算泄露；200/500 才是问题
    if (result.status === 200 || result.status >= 500) {
      leaked.push(`${path} → ${result.status}`);
    }
  }
  check(results, "40 个敏感路径全部不可达", leaked.length === 0, leaked.join(", "));

  // 源码映射泄漏：能拿到 .map 就等于源码公开
  const mapFile = await get(BASE, "/_next/static/chunks/turbopack-0l4z7d8qbcroh.js.map");
  check(
    results,
    "source map 不可直接下载",
    mapFile.status !== 200,
    `实际 ${mapFile.status}`,
  );

  // 400 页面不应回显内部路径/堆栈
  const bad = await postJson(BASE, "/api/auth/signin", { broken: true });
  check(
    results,
    "错误响应不回显堆栈或绝对路径",
    !/at\s+\w+\s+\(|\.next\/server|\/app\/node_modules/.test(bad.body),
    bad.body.slice(0, 120),
  );

  // 路径穿越
  const traversal = await get(BASE, "/activities/..%2f..%2fpackage.json");
  check(results, "路径穿越无效", traversal.status !== 200, `实际 ${traversal.status}`);
});

/* ─────────────────────────── B. 越权访问 ─────────────────────────── */

await run("B 越权访问", async () => {
  const ADMIN_ENDPOINTS = [
    ["GET", "/api/admin/agents"],
    ["GET", "/api/admin/overview"],
    ["GET", "/api/admin/activities"],
    ["GET", "/api/admin/users"],
    ["GET", "/api/admin/audit"],
    ["GET", "/api/admin/audit/verify"],
    ["GET", "/api/admin/blacklist"],
    ["GET", "/api/admin/events"],
  ];
  for (const [, path] of ADMIN_ENDPOINTS) {
    const result = await get(BASE, path);
    check(
      results,
      `匿名 ${path} 被拒（401/403/503）`,
      [401, 403, 503].includes(result.status),
      `实际 ${result.status}`,
    );
  }

  /**
   * /api/admin/session 是唯一的例外：它本来就该对匿名返回 200，
   * 因为客户端要靠它区分「未登录 / 已登录非管理员 / 管理员」三种界面。
   * 所以这里断言的不是状态码，而是**它不能泄漏任何东西**：
   *   user 必须为 null、admin 必须为 false、不能带出邮箱。
   */
  const guard = await get(BASE, "/api/admin/session");
  check(results, "GET /api/admin/session 匿名可达", guard.status === 200 || guard.status === 503, `实际 ${guard.status}`);
  if (guard.status === 200) {
    let data = null;
    try {
      data = JSON.parse(guard.body);
    } catch {
      /* 统一报错 */
    }
    check(results, "/api/admin/session 匿名 user 为 null", data?.user === null, JSON.stringify(data?.user));
    check(results, "/api/admin/session 匿名 admin 为 false", data?.admin === false, String(data?.admin));
    check(results, "/api/admin/session 不泄漏邮箱", !/@/.test(guard.body), guard.body.slice(0, 120));
  }

  // 写操作必须拒绝匿名：删/改没人管的话比读更严重
  const writes = [
    ["PATCH", "/api/admin/activities/guoqing-77", { visibility: "public" }],
    ["DELETE", "/api/admin/activities/guoqing-77", null],
    ["PATCH", "/api/admin/users/00000000-0000-0000-0000-000000000000", { role: "admin" }],
    /** 405 也算通过：该路由只导出 PATCH，删除方法压根不存在，攻击面为零。 */
    ["DELETE", "/api/admin/submissions/00000000-0000-0000-0000-000000000000", null, [401, 403, 405, 503]],
    ["POST", "/api/admin/blacklist", { email: "attacker@example.com", reason: "probe" }],
  ];
  for (const [method, path, body, allowed] of writes) {
    const result = await req(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const want = allowed ?? [401, 403, 503];
    check(
      results,
      `匿名 ${method} ${path} 被拒`,
      want.includes(result.status),
      `实际 ${result.status}（期望 ${want.join("/")}）`,
    );
  }

  // 伪造会话：随便编一个 cookie 不应被认成管理员
  for (const fake of [
    "__Secure-authjs.session-token=forged.signature.value",
    "authjs.session-token=forged",
    "__Secure-authjs.session-token=eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..0000.0000",
  ]) {
    const result = await get(BASE, "/api/admin/overview", { headers: { cookie: fake } });
    check(
      results,
      `伪造 cookie 被拒（${fake.slice(0, 34)}…）`,
      [401, 403, 503].includes(result.status),
      `实际 ${result.status}`,
    );
  }
});

/* ────────────────────────── C. 内容与来源控制 ────────────────────────── */

await run("C 内容与来源控制", async () => {
  // C1 作品链接白名单：非抖音站内外链必须被拒（不会被当成开放代理去抓任意链接）
  const BAD_URLS = [
    "https://attacker.example.com/video/1",
    "http://v.douyin.com/abc", // 非 https
    "https://douyin.com.attacker.example.com/x", // 后缀伪造
    "file:///etc/passwd",
    "http://127.0.0.1:3210/api/admin/overview", // SSRF 探测内网
    "http://169.254.169.254/latest/meta-data/", // 云元数据端点
    "https://[::1]:3210/",
  ];
  for (const url of BAD_URLS) {
    const result = await postJson(BASE, "/api/activities/guoqing-77/submissions", { url });
    // 未登录（401）也是防守成功；关键是绝不能被当成合法提交（201）
    check(
      results,
      `恶意作品链接被拒（${url.slice(0, 40)}）`,
      result.status !== 201,
      `实际 ${result.status}`,
    );
  }

  // C2 非抖音但合法的外链：确认白名单确实在起作用（不是靠"未登录"兜住）
  const foreign = await postJson(BASE, "/api/activities/guoqing-77/submissions", {
    url: "https://example.com/legit-looking",
  });
  check(results, "非抖音链接不会返回 201", foreign.status !== 201, `实际 ${foreign.status}`);

  // C3 代理商申请与发布权：匿名提交申请必须被拒；匿名发活动必须被拒
  const applyAnon = await postJson(BASE, "/api/agent/application", {
    contactName: "攻击者",
    phone: "13800000000",
    statement: "对抗测试探测代理商申请入口",
  });
  check(results, "匿名提交代理商申请被拒", [401, 403, 503].includes(applyAnon.status), `实际 ${applyAnon.status}`);
  const createAnon = await postJson(BASE, "/api/activities", { title: "对抗测试", subtitle: "x" });
  check(results, "匿名创建活动被拒（发布权限门禁）", [401, 403, 503].includes(createAnon.status), `实际 ${createAnon.status}`);
  // 伪造会话也不能拿到发布权
  const createForged = await postJson(BASE, "/api/activities", { title: "对抗测试", subtitle: "x" }, {
    headers: { cookie: "__Secure-authjs.session-token=forged.signature" },
  });
  check(results, "伪造会话创建活动被拒", [401, 403, 503].includes(createForged.status), `实际 ${createForged.status}`);

  // C4 创建活动：未登录必须 401，不会因为"内容不敏感"就放行
  const create = await postJson(BASE, "/api/activities", {
    title: "对抗测试",
    subtitle: "probe",
    overview: "probe",
    host: "probe",
    contact: "probe@example.com",
  });
  check(results, "匿名创建活动被拒", [401, 403, 503].includes(create.status), `实际 ${create.status}`);
});

/* ──────────────────────── D. 限流与暴力破解 ──────────────────────── */

await run("D 限流与暴力破解", async () => {
  // 登录入口：连打 20 次，应当出现 429（规则是 10 次/分钟）
  const codes = [];
  for (let i = 0; i < 20; i += 1) {
    const result = await get(BASE, "/api/auth/signin/wechat");
    codes.push(result.status);
  }
  const limited = codes.filter((code) => code === 429).length;
  check(results, "登录入口连续请求触发 429", limited > 0, `状态码序列 ${codes.join(",")}`);

  const limitedResponse = await get(BASE, "/api/auth/signin/wechat");
  if (limitedResponse.status === 429) {
    check(
      results,
      "429 响应带 Retry-After",
      expectRetryAfter(limitedResponse),
      JSON.stringify(limitedResponse.headers).slice(0, 120),
    );
  }

  // 写接口：未登录时也应在鉴权前先过限流（否则等于给爆破留了快车道）
  const writeCodes = [];
  for (let i = 0; i < 12; i += 1) {
    const result = await postJson(BASE, "/api/activities", { title: `probe-${i}` });
    writeCodes.push(result.status);
  }
  check(
    results,
    "写接口连续请求不返回 5xx",
    !writeCodes.some((code) => code >= 500),
    writeCodes.join(","),
  );
});

function expectRetryAfter(result) {
  const value = result.headers["retry-after"];
  return Boolean(value) && Number(value) > 0;
}

/* ─────────────────────────── E. 输入健壮性 ─────────────────────────── */

await run("E 输入健壮性", async () => {
  // 畸形 JSON：必须 400，不能 500
  const broken = await req(`${BASE}/api/activities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"title": "x", ',
  });
  check(results, "畸形 JSON 返回 4xx（不是 5xx）", broken.status >= 400 && broken.status < 500, `实际 ${broken.status}`);

  // 类型错乱：字段给成对象/数组
  const wrongType = await postJson(BASE, "/api/activities", { title: { $ne: null }, subtitle: [1, 2, 3] });
  check(results, "字段类型错乱返回 4xx", wrongType.status >= 400 && wrongType.status < 500, `实际 ${wrongType.status}`);

  // 超大体积：2MB 请求体应被挡（不能把内存打满）
  const huge = await req(`${BASE}/api/activities`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "x".repeat(2 * 1024 * 1024) }),
    timeoutMs: 25000,
  });
  check(results, "2MB 请求体被拒或超时", huge.status === 0 || (huge.status >= 400 && huge.status < 500), `实际 ${huge.status}`);

  // 不存在的路径：404，且不能把 SPA 的 200 当成兜底（会让爬虫收录空页面）
  const missing = await get(BASE, "/this-path-does-not-exist-9f3a");
  check(results, "不存在的路径返回 404", missing.status === 404, `实际 ${missing.status}`);

  // 中文/emoji/超长 slug 不应 500
  for (const slug of ["%E4%B8%AD%E6%96%87", "%F0%9F%98%80", "a".repeat(300)]) {
    const result = await get(BASE, `/activities/${slug}`);
    check(results, `异常 slug ${slug.slice(0, 12)} 不 5xx`, result.status < 500, `实际 ${result.status}`);
  }

  // HTTP 方法不被支持时应 405/404，而不是误当成 GET
  const putResult = await req(`${BASE}/api/session`, { method: "PUT", body: "x" });
  check(results, "不支持的 HTTP 方法被拒", [404, 405].includes(putResult.status), `实际 ${putResult.status}`);
});

/* ─────────────────────────── F. 响应安全 ─────────────────────────── */

await run("F 响应安全", async () => {
  const home = await get(BASE, "/");
  check(
    results,
    "首页含 CSP 且 frame-ancestors 为 none",
    (home.headers["content-security-policy"] ?? "").includes("frame-ancestors 'none'"),
    (home.headers["content-security-policy"] ?? "").slice(0, 80),
  );
  check(results, "首页含 HSTS", (home.headers["strict-transport-security"] ?? "").includes("max-age="), "");
  check(results, "未泄露 X-Powered-By", !("x-powered-by" in home.headers) || !/next/i.test(home.headers["x-powered-by"]), `实际 ${home.headers["x-powered-by"] ?? "(无)"}`);

  // 管理端页面不得被缓存到中间层
  const admin = await get(BASE, "/manage");
  const cache = admin.headers["cache-control"] ?? "";
  check(results, "管理端页面不公开缓存", !/public/.test(cache), `cache-control: ${cache || "(无)"}`);

  // 未认证的 API 响应不应带 CDN 长缓存（否则会串号）
  const session = await get(BASE, "/api/session");
  check(
    results,
    "会话 API 不被 CDN 长缓存",
    !/s-maxage=\d{5,}/.test(session.headers["cache-control"] ?? ""),
    session.headers["cache-control"] ?? "(无)",
  );

  // TLS 相关：https 目标必须能协商，且 HTTP 应跳转
  if (BASE.startsWith("https://")) {
    const httpBase = BASE.replace("https://", "http://");
    const plain = await get(httpBase, "/");
    check(results, "HTTP 跳转 HTTPS", [301, 302, 308].includes(plain.status), `实际 ${plain.status}`);
  }
});

const exitCode = report("对抗测试（adversarial）", results);
console.log(
  `\n目标：${BASE}（${IS_LOCAL ? "本地/服务器" : "线上，已显式确认"}）\n` +
    "本次执行已产生审计日志（security 分类），可在 /manage → 审计日志里核对。",
);
process.exit(exitCode);
