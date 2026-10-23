import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

/**
 * 微信小程序登录链路。
 *
 * 这条链路最危险的错误都不会报错，只会安静地把人分错号：
 *   · 自己 insert users → 同一个人被建成第二行，昵称与历史数据全丢
 *   · 用 openid 现拼 email 签会话 → 合并后立刻又建一行（线上真踩过）
 *   · 返回的 token 用错 salt → 浏览器/小程序读不出会话，表现为"登录成功但一直未登录"
 *   · 没加 Bearer 兜底 → 小程序里每个接口都 401
 * 所以这里的测试以**静态契约断言**为主：锁住这几个关键调用是否存在。
 */

function load(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

/** 用假的 fetch 驱动 jscode2session，断言 URL 与返回值处理。 */
async function fakeFetchFor(body, capture) {
  return async (url) => {
    if (capture) capture.push(String(url));
    return { json: async () => body };
  };
}

test("jscode2session：URL 参数完整，且不返回 session_key", async () => {
  const { exchangeMiniProgramCode } = await load("../lib/server/wechat-mini.ts");
  const urls = [];
  const env = { WECHAT_MINI_ID: "wxTESTAPPID", WECHAT_MINI_SECRET: "secret-value" };

  const result = await exchangeMiniProgramCode(
    "CODE-123",
    env,
    await fakeFetchFor(
      { openid: "oMiniOpenId", unionid: "uUnionId", session_key: "SHOULD_NOT_LEAK", expires_in: 7200 },
      urls,
    ),
  );

  assert.equal(urls.length, 1);
  const url = urls[0];
  assert.match(url, /\/sns\/jscode2session\?/);
  assert.match(url, /appid=wxTESTAPPID/);
  assert.match(url, /secret=secret-value/);
  assert.match(url, /js_code=CODE-123/);
  assert.match(url, /grant_type=authorization_code/);

  assert.deepEqual(result, { openId: "oMiniOpenId", unionId: "uUnionId" });
  // session_key 只在解密 encryptedData 时需要；本期不取手机号，绝不该外流到业务层
  assert.equal("sessionKey" in result, false);
  assert.equal(JSON.stringify(result).includes("SHOULD_NOT_LEAK"), false);
});

test("jscode2session：没有 unionid 时返回 null 而不是undefined（保持类型稳定）", async () => {
  const { exchangeMiniProgramCode } = await load("../lib/server/wechat-mini.ts");
  const env = { WECHAT_MINI_ID: "wxTESTAPPID", WECHAT_MINI_SECRET: "secret-value" };
  const result = await exchangeMiniProgramCode(
    "CODE-123",
    env,
    await fakeFetchFor({ openid: "oMiniOpenId" }),
  );
  assert.deepEqual(result, { openId: "oMiniOpenId", unionId: null });
});

test("jscode2session：微信返回错误（无 openid）→ null，不抛错", async () => {
  const { exchangeMiniProgramCode } = await load("../lib/server/wechat-mini.ts");
  const env = { WECHAT_MINI_ID: "wxTESTAPPID", WECHAT_MINI_SECRET: "secret-value" };

  for (const body of [
    { errcode: 40029, errmsg: "invalid code" },
    { errcode: 40163, errmsg: "code been used" },
    { errcode: 40013, errmsg: "invalid appid" },
  ]) {
    const result = await exchangeMiniProgramCode("BAD", env, await fakeFetchFor(body));
    assert.equal(result, null, `errcode=${body.errcode} 应返回 null`);
  }
});

test("jscode2session：缺配置时抛错（让路由回 503 而不是静默失败）", async () => {
  const { exchangeMiniProgramCode } = await load("../lib/server/wechat-mini.ts");
  await assert.rejects(
    () => exchangeMiniProgramCode("CODE", {}, async () => ({ json: async () => ({}) })),
    /WECHAT_MINI_ID/,
  );
});

test("登录路由：必须复用 resolveWechatUser，不得自己建号", () => {
  const route = read("../app/api/auth/wechat-mini/route.ts");
  assert.match(route, /resolveWechatUser\(\{ openId: identity\.openId, unionId: identity\.unionId \}\)/);
  /**
   * 这是整个身份体系的核心不变量：WeChat 用户只能有一个建号入口。
   * 一旦这里自己 insert(users)，小程序用户就会与网页用户分成两行。
   */
  assert.equal(/insert\(schema\.users\)/.test(route), false, "登录路由不得自己 insert users");
});

test("登录路由：会话身份必须来自命中那一行的 email，不能现拼", () => {
  const route = read("../app/api/auth/wechat-mini/route.ts");
  assert.match(route, /getWechatSessionIdentity\(resolved\.id\)/, "必须按 userId 回查真实身份");
  assert.match(route, /email: sessionIdentity\.email/, "会话 email 必须来自 users 行");
  assert.match(route, /sub: sessionIdentity\.id/);
  // 现拼占位邮箱会让合并后的会话落回一个新行（线上 bug 的回归守卫）
  assert.equal(/`\$\{identity\.openId\}@wechat\.user`/.test(route), false, "不得按 openid 现拼 email");
});

test("登录路由：salt 用 cookie 名，并同时下发 cookie", () => {
  const route = read("../app/api/auth/wechat-mini/route.ts");
  assert.match(route, /const cookieName = secure \? "__Secure-authjs\.session-token" : "authjs\.session-token"/);
  assert.match(route, /salt: cookieName/, "salt 必须等于 cookie 名，否则 auth() 解不出来");
  assert.match(route, /response\.cookies\.set\(cookieName/, "web-view 场景要能用同一个会话");
  assert.match(route, /maxAge: SESSION_MAX_AGE/);
  assert.equal(/session_key/.test(route), false, "不得把 session_key 带进业务代码");
});

test("登录路由：必须写审计（小程序不经过 Auth.js 的 events.signIn）", () => {
  const route = read("../app/api/auth/wechat-mini/route.ts");
  assert.match(route, /action: "auth\.wechat_mini\.login"/);
  assert.match(route, /registered: resolved\.created/, "要区分注册与登录");
  assert.match(route, /openIdPrefix/, "不记完整 openid");
});

test("currentUser：必须有 Bearer 兜底，且两个 salt 都试", () => {
  const users = read("../lib/server/users.ts");
  assert.match(users, /export async function bearerSession/, "要有一个独立的 Bearer 解析");
  assert.match(users, /authorization/i, "要从 Authorization 头读");
  assert.match(users, /Bearer /, "要识别 Bearer 前缀");
  // 签发时 http/https 用不同 cookie 名，解出来时必须两种都试，
  // 否则本地 http 调试签发的 token 在 https 上解不开。
  assert.match(users, /__Secure-authjs\.session-token/);
  assert.match(users, /"authjs\.session-token"/);
  assert.match(users, /const bearer = await bearerSession\(\)/, "currentUser 要回落到 Bearer");
  // 认证失败不能 500，必须当作未登录
  assert.match(users, /catch \{\s*\/\/ 换下一个 salt/, "解析失败要吞掉异常");
});

test("小程序工程：页面注册齐全且每个页面文件都存在", () => {
  const app = JSON.parse(read("../miniprogram/app.json"));
  const pages = app.pages || [];
  assert.ok(pages.length >= 7, `至少 7 个页面，实际 ${pages.length}`);
  for (const page of pages) {
    for (const ext of ["js", "json", "wxml", "wxss"]) {
      const path = `../miniprogram/${page}.${ext}`;
      assert.ok(read(path).length > 0, `缺少文件 ${path}`);
    }
  }
  // tabBar 的三个页面必须在 pages 里
  for (const item of app.tabBar.list) {
    assert.ok(pages.includes(item.pagePath), `tabBar 页面未注册：${item.pagePath}`);
  }
});

test("小程序工程：不得提交真实 AppID（CI 凭据扫描会拦）", () => {
  const config = JSON.parse(read("../miniprogram/project.config.json"));
  const appid = String(config.appid || "");
  assert.equal(/wx[0-9a-f]{16}/.test(appid), false, `project.config.json 里不能有真实 AppID：${appid}`);
  assert.match(appid, /REPLACE/, "应留明显的占位符，提醒用户自己填");
});

test("小程序请求层：所有请求都带 Bearer，401 会清 token", () => {
  const request = read("../miniprogram/utils/request.js");
  assert.match(request, /Authorization = "Bearer " \+ token/, "必须附带 Bearer 头");
  assert.match(request, /statusCode === 401[\s\S]{0,60}clearToken/, "401 要清掉失效 token");
  assert.match(request, /Retry-After|retry-after/, "429 要把 retry-after 带出来");
  // 登录接口自身不能带 token（此时还没有）
  assert.match(request, /noAuth/, "登录接口要能跳过 Bearer");
});

test("小程序管理端：请求体字段名与服务端一致", () => {
  const manage = read("../miniprogram/pages/manage/manage.js");
  // 作品审核：服务端 /api/admin/submissions/[id] 读 status
  assert.match(manage, /data: \{ status \}/, "作品审核要发 status");
  // 代理商审核：服务端 /api/admin/agents/[id] 读 decision
  assert.match(manage, /data: \{ decision: status \}/, "代理商审核要发 decision");
  // 活动审核：服务端 /api/admin/activities/[slug] 读 reviewStatus
  assert.match(manage, /reviewStatus: "published"/, "活动审核要发 reviewStatus");
});

test("小程序：展示名口径与网页一致（不泄露 openid）", () => {
  const format = read("../miniprogram/utils/format.js");
  assert.match(format, /8172633|0x811c9dc5/, "必须有 FNV-1a 散列（与 lib/display-name 同算法）");
  assert.match(format, /微信用户 · /);
  assert.match(format, /@wechat\.user/);
  // 三处页面对昵称的展示必须走 format.displayName
  for (const page of ["../miniprogram/pages/profile/profile.js", "../miniprogram/pages/create/create.js"]) {
    assert.match(read(page), /require\("\.\.\/\.\.\/utils\/format"\)/, `${page} 要复用共享格式化`);
  }
});

test("排行榜接口：返回聚合但不泄露身份键", () => {
  const route = read("../app/api/leaderboard/route.ts");
  assert.match(route, /platformTotals\(\)/, "复用同一份贡献值计算");
  assert.match(route, /HONOR_LEVELS/, "勋章档位给前端，避免硬编码");
  assert.match(route, /databaseRequired\(\)/, "要有无库守卫");
  // 注释里说明"不返回 openid"是正常的；只检查真正的代码行
  const code = route
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
  assert.equal(/openId|unionId|union_id/i.test(code), false, "不得把微信身份键放进公开响应");
});
