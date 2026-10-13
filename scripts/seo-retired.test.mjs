import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

/**
 * 已下线活动地址（410 Gone）的判定与响应体。
 *
 * 与仓库其它 *.test.mjs 同一套做法：把 TS 源码转译后在 node 里跑，不引入测试期依赖。
 * 这里测的是**纯判定逻辑**（slug 识别、host 判定、HTML 约束），不 import middleware.ts ——
 * 它 import 了 next/server，在测试环境里起不来；而真正易错的恰好是那三个纯函数。
 */

async function load(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

/**
 * retired-page.ts 依赖 retired-slugs.ts。转译产物是 data: URL，无法做相对 import 解析
 * （会报 ERR_UNSUPPORTED_RESOLVE_REQUEST），所以把两份源码**去掉 import 后缝成一份**，
 * 最后统一挂一个 export 列表 —— 与 scripts/seo-jsonld.test.mjs 的做法一致。
 *
 * 注意：所有 `export` 关键字一律剥掉再在末尾声明一次：只去 `^export {` 这类会留下
 * 双重导出，报 "Duplicate export"（上一轮在 schema.ts 上踩过）。
 */
async function loadPage() {
  const strip = (source) =>
    ts
      .transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
      })
      .outputText.replace(/^import[\s\S]*?;$/gm, "")
      .replace(/^export\s+/gm, "");

  const merged =
    strip(readFileSync(new URL("../lib/seo/retired-slugs.ts", import.meta.url), "utf8")) +
    "\n" +
    strip(readFileSync(new URL("../lib/seo/retired-page.ts", import.meta.url), "utf8")) +
    "\nexport { RETIRED_ACTIVITY_SLUGS, RETIRED_PAGE_FORBIDDEN, REDIRECT_ONLY_HOSTS," +
    " retiredPageHtml, hostNeedsRedirect, retiredSlugsArePublishable };";

  return import(`data:text/javascript;base64,${Buffer.from(merged).toString("base64")}`);
}

const loadSlugs = () => load("../lib/seo/retired-slugs.ts");

test("410 判定：只认恰好一层 /activities/<已下线 slug>", async () => {
  const { retiredActivitySlugPath } = await loadSlugs();

  // 该命中的形态
  assert.equal(retiredActivitySlugPath("/activities/midautumn-poetry"), "midautumn-poetry");
  assert.equal(retiredActivitySlugPath("/activities/midautumn-poetry/"), "midautumn-poetry", "结尾斜杠是同一个地址");
  assert.equal(retiredActivitySlugPath("/activities/shop-ai-assistant"), "shop-ai-assistant");
  assert.equal(retiredActivitySlugPath("/activities/city-memory-map"), "city-memory-map");

  // 不该命中的：拼错的地址必须还是 404，否则 410 就失去了"这是确定的终局"的含义
  assert.equal(retiredActivitySlugPath("/activities/typo-slug"), null);
  assert.equal(retiredActivitySlugPath("/activities/guoqing-77"), null, "在线的活动绝不能被打成 410");

  // 不该命中的形态
  assert.equal(retiredActivitySlugPath("/activities"), null);
  assert.equal(retiredActivitySlugPath("/activities/"), null);
  assert.equal(retiredActivitySlugPath("/activities/midautumn-poetry/extra"), null, "子路径不是活动详情页");
  assert.equal(retiredActivitySlugPath("/activities/midautumn-poetry/../guoqing-77"), null);
  assert.equal(retiredActivitySlugPath("/midautumn-poetry"), null);
  assert.equal(retiredActivitySlugPath("/"), null);
  assert.equal(retiredActivitySlugPath(""), null);
});

test("410 判定：百分号编码与大小写变体一并挡住", async () => {
  const { retiredActivitySlugPath } = await loadSlugs();

  // Next 的路由解析会把这两种形态指到同一页，只比字面量会漏
  assert.equal(retiredActivitySlugPath("/activities/midautumn%2Dpoetry"), "midautumn-poetry");
  assert.equal(retiredActivitySlugPath("/activities/Midautumn-Poetry"), "midautumn-poetry");

  // 畸形编码当不认识 —— 宁可漏（退化成 404）也不能误伤或抛错
  assert.equal(retiredActivitySlugPath("/activities/%E4%B8%AD"), null, "解得出但不在名单里");
  assert.equal(retiredActivitySlugPath("/activities/%ZZ"), null, "畸形编码不能抛错");
  assert.equal(retiredActivitySlugPath("/activities/%"), null);
});

test("跳转域名上不做 410（.net 整站 308 到主站，行为必须一致）", async () => {
  const { hostNeedsRedirect } = await loadPage();

  assert.equal(hostNeedsRedirect("hangkathon.net"), true);
  assert.equal(hostNeedsRedirect("www.hangkathon.net"), true);
  assert.equal(hostNeedsRedirect("HANGKATHON.NET"), true, "Host 大小写不敏感");
  assert.equal(hostNeedsRedirect("hangkathon.net:443"), true, "带端口要剥掉再比");

  assert.equal(hostNeedsRedirect("hangkathon.com"), false);
  assert.equal(hostNeedsRedirect("www.hangkathon.com"), false);
  assert.equal(hostNeedsRedirect("127.0.0.1:3210"), false, "本地回环部署要能出 410");
  assert.equal(hostNeedsRedirect("localhost:3210"), false);
  assert.equal(hostNeedsRedirect(null), false);
  assert.equal(hostNeedsRedirect(""), false);
});

test("410 响应体：无脚本、带 noindex、不复述原活动内容、备案信息在", async () => {
  const { retiredPageHtml, RETIRED_PAGE_FORBIDDEN } = await loadPage();
  const html = retiredPageHtml();

  // 这条是硬约束：middleware 返回的 410 没有 CSP nonce，任何内联脚本都会被拦掉，
  // 表现是"页面看起来是坏的"。所以干脆不许出现脚本。
  for (const { label, pattern } of RETIRED_PAGE_FORBIDDEN) {
    assert.equal(pattern.test(html), false, `410 页面不允许出现${label}（${pattern}）`);
  }
  assert.equal(/<script/i.test(html), false);

  // 410 的语义靠状态码，但文档里再放一道 noindex，防中间层改写状态码
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<title>活动已下线 · 杭客松<\/title>/);
  assert.match(html, /<html lang="zh-CN">/);
  assert.equal(html.trimStart().startsWith("<!doctype html>"), true);

  // 绝不复述原活动文案 —— 搜索摘要里出现旧文案正是这次要修的问题
  assert.equal(/中秋|诗会|Midautumn|midautumn/i.test(html), false, "410 页面不得复述已下线活动的内容");

  // 法规要求全站可见，错误页也是全站的一部分
  assert.match(html, /浙公网安备33010502013637号/);
  assert.match(html, /浙ICP备2026082561号/);

  // 给出路：404/410 都不该是死胡同
  assert.match(html, /href="\/activities"/);
  assert.match(html, /href="\/"/);
});

test("不变量：名单里的 slug 不得再出现在已发布活动里", async () => {
  const { retiredSlugsArePublishable } = await loadPage();
  const { RETIRED_ACTIVITY_SLUGS } = await loadSlugs();
  const { PUBLISHED_ACTIVITIES } = await load("../lib/published-activities.ts");

  const publishedSlugs = PUBLISHED_ACTIVITIES.map((item) => item.slug);
  const conflicts = retiredSlugsArePublishable(publishedSlugs);

  // 名单与已发布列表撞车 = middleware 会把一页本该能访问的内容打成 410，
  // 而且故障现象是"某个活动页突然报下线"，排查时很难联想到 middleware。
  assert.deepEqual(conflicts, [], `这些 slug 同时在已下线名单和已发布列表里：${conflicts.join(", ")}`);

  // 反向断言：名单本身不能是空的（空了说明有人清空了它，410 就静默失效了）
  assert.ok(RETIRED_ACTIVITY_SLUGS.length >= 3, "已下线名单不该被清空");
  for (const slug of RETIRED_ACTIVITY_SLUGS) {
    assert.match(slug, /^[a-z0-9-]+$/, `${slug} 的形态与 URL 里的 slug 不一致，比对会永远不等`);
  }
});

test("middleware 真的接上了 410：三个判定点都在，且顺序是先 host 后 slug", async () => {
  const source = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");

  // 静态检查而不是运行时检查：middleware 依赖 next/server，测试里起不来。
  // 这条断言防的是"有人把 410 分支删了/条件写反了"，那种情况线上表现为
  // "已下线地址又回到 404"—— 不报错，只是信号变弱，是典型的静默退化。
  assert.match(source, /import\s*\{\s*retiredActivitySlugPath\s*\}/);
  assert.match(source, /import\s*\{[^}]*hostNeedsRedirect[^}]*\}/);
  assert.match(source, /import\s*\{[^}]*retiredPageHtml[^}]*\}/);
  assert.match(source, /status:\s*410/);

  const hostGuardIndex = source.indexOf("hostNeedsRedirect(request.headers.get");
  const slugGuardIndex = source.indexOf("retiredActivitySlugPath(url.pathname)");
  assert.ok(hostGuardIndex > 0 && slugGuardIndex > 0, "两个判定都要在 middleware 里出现");
  assert.ok(
    hostGuardIndex < slugGuardIndex,
    "必须先判 host 再判 slug：顺序反了之后 .net 上会出 410，与它'整站跳转'的定位矛盾",
  );

  // 410 响应必须自带 noindex 头，别只依赖 HTML 里的 meta
  assert.match(source, /"x-robots-tag":\s*"noindex"/);
});
