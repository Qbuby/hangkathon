import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// 与仓库其它 *.test.mjs 同一套做法：把 TS 源码转译后在 node 里跑，不引入测试期依赖。
async function load(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

/**
 * schema.ts 依赖 jsonld.ts。转译产物是 data: URL，无法做相对 import 解析，
 * 所以把两份源码**去掉所有 import/export 后缝成一份**，最后统一挂一个 export 列表。
 *
 * 踩过的坑：只去 `^export ` 不够 —— `export { X } from "./jsonld";` 与
 * `export function graph` 会留下两个同名导出，报 "Duplicate export of 'graph'"。
 * 所以这里把所有 `export` 关键字一律剥掉，导出只在末尾声明一次。
 */
async function loadSchema() {
  const strip = (source) =>
    ts
      .transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
      })
      .outputText
      .replace(/^import[\s\S]*?;$/gm, "")
      .replace(/^export\s+\{[^}]*\}\s+from\s+"[^"]*";$/gm, "")
      .replace(/^export\s+/gm, "");

  const merged =
    strip(readFileSync(new URL("../lib/seo/jsonld.ts", import.meta.url), "utf8")) +
    "\n" +
    strip(readFileSync(new URL("../lib/seo/schema.ts", import.meta.url), "utf8")) +
    "\nexport { toJsonLdScript, absoluteUrl, isoDate, compact, SITE_URL, ORG_ID, WEBSITE_ID," +
    " organizationNode, websiteNode, webpageNode, breadcrumbNode, itemListNode, eventNode, graph };";

  return import(`data:text/javascript;base64,${Buffer.from(merged).toString("base64")}`);
}

test("JSON-LD 序列化会转义 < > &，阻断数据突破脚本块", async () => {
  const { toJsonLdScript } = await load("../lib/seo/jsonld.ts");

  // 这是本轮修复的核心：原先把用户填的活动标题直接 JSON.stringify 后嵌进
  // <script type="application/ld+json">。实测（受控实验）这种输入会让页面里真的出现
  // 一个 robots meta、一个隐藏 div 和一条外站垃圾链接 —— 因为 </script> 提前结束了脚本块。
  const hostile = "</script><meta name=\"robots\" content=\"noindex\"><div id=\"inj\">x</div>";
  const out = toJsonLdScript({ name: hostile });

  assert.equal(out.includes("</script>"), false, "产物里绝不能再出现字面量 </script>");
  assert.equal(out.includes("<"), false, "所有 < 都应转义为 \\u003c");
  assert.equal(out.includes(">"), false, "所有 > 都应转义为 \\u003e");
  assert.ok(out.includes("\\u003c/script\\u003e"), "应看到转义后的 </script> 形态");

  // 转义后仍是合法 JSON，且往返取值不变
  assert.deepEqual(JSON.parse(out), { name: hostile });

  // U+2028 / U+2029 在 JSON 里合法、在旧 JS 里是行终止符
  const lineSep = toJsonLdScript({ note: "a\u2028b\u2029c" });
  assert.equal(lineSep.includes("\u2028"), false);
  assert.equal(JSON.parse(lineSep).note, "a\u2028b\u2029c");
});

test("absoluteUrl 只补相对路径，不重复拼域名", async () => {
  const { absoluteUrl } = await load("../lib/seo/jsonld.ts");
  assert.equal(absoluteUrl("/activities/x"), "https://hangkathon.com/activities/x");
  assert.equal(absoluteUrl("activities/x"), "https://hangkathon.com/activities/x");
  assert.equal(absoluteUrl("https://cdn.example/a.jpg"), "https://cdn.example/a.jpg");
  assert.equal(absoluteUrl("http://cdn.example/a.jpg"), "http://cdn.example/a.jpg");
});

test("isoDate 规范化日期并丢弃无效值", async () => {
  const { isoDate } = await load("../lib/seo/jsonld.ts");
  assert.equal(isoDate("2026-10-01"), "2026-10-01", "纯日期保持原样（已是合法 ISO 8601）");
  assert.equal(isoDate("2026-10-01T02:00:00.000Z"), "2026-10-01T02:00:00.000Z");
  assert.equal(isoDate(""), undefined);
  assert.equal(isoDate("   "), undefined);
  assert.equal(isoDate(undefined), undefined);
  assert.equal(isoDate("不是日期"), undefined, "解析失败必须返回 undefined 而不是抛错或塞 Invalid Date");
});

test("compact 丢掉空属性（结构化数据里留空值是常见告警来源）", async () => {
  const { compact } = await load("../lib/seo/jsonld.ts");
  assert.deepEqual(compact({ a: 1, b: undefined, c: null, d: [], e: "", f: 0 }), { a: 1, e: "", f: 0 });
});

test("Event 节点：必填字段齐备、绝对地址、@id 可引用", async () => {
  const { eventNode } = await loadSchema();
  const node = eventNode({
    slug: "guoqing-77",
    title: "我 AI 中国 · 2026 国庆 AI 短视频创作大赛",
    overview: "用 AI 创作一部致敬新中国 77 周年的短视频。",
    host: "杭客松",
    image: "/assets/guoqing-77-poster.jpg",
    format: "offline",
    venue: "杭州国际博览中心",
    districtName: "萧山区",
    startsAt: "2026-10-01",
    endsAt: "2026-10-07",
    pricing: "free",
  });

  // claude-seo 的 schema-types 对 Event 的必需属性：name/startDate/endDate/location/organizer/offers
  for (const key of ["name", "startDate", "endDate", "location", "organizer", "offers"]) {
    assert.ok(key in node, `Event 必须有 ${key}`);
  }
  assert.equal(node["@context"], undefined, "节点本身不带 @context，由 graph() 加");
  assert.equal(node.url, "https://hangkathon.com/activities/guoqing-77");
  assert.equal(node.image, "https://hangkathon.com/assets/guoqing-77-poster.jpg", "图片必须是绝对地址");
  assert.equal(node.offers.price, 0, "免费活动用 0 表达（可检索信息），而不是省略");
  assert.equal(node.offers.priceCurrency, "CNY");
  assert.equal(node.location["@type"], "Place");
  assert.equal(node.location.address.addressCountry, "CN");
  assert.equal(node.location.address.addressLocality, "杭州市");
  assert.ok(node.location.address.addressRegion.includes("萧山区"));

  // 线上活动走 VirtualLocation
  const online = eventNode({ slug: "x", title: "线上赛", format: "online", startsAt: "2026-01-01" });
  assert.equal(online.location["@type"], "VirtualLocation");
  // 没有主办方时回落到平台自己，且只有平台自己才挂官网 URL
  assert.equal(online.organizer.name, "杭客松");
  assert.equal(online.organizer.url, "https://hangkathon.com/");
});

test("Event 节点不生成空属性，也不编造缺失的日期", async () => {
  const { eventNode } = await loadSchema();
  const node = eventNode({ slug: "minimal", title: "最小活动" });
  assert.equal("startDate" in node, false, "缺开始时间就不要这个键（留 null 是告警来源）");
  assert.equal("endDate" in node, false);
  assert.equal("alternateName" in node, false);
  // 没有区信息时 addressRegion 回落到市级，而不是空串或编造的区名
  assert.equal(node.location.address.addressRegion, "浙江省杭州市");
  assert.equal(node.location.name, "杭州", "没有场地也没有区时，地点名回落到城市");
});

test("BreadcrumbList 每项都有 position/name/item", async () => {
  const { breadcrumbNode } = await loadSchema();
  const node = breadcrumbNode([
    { name: "首页", path: "/" },
    { name: "活动看板", path: "/activities" },
    { name: "某活动", path: "/activities/x" },
  ]);
  assert.equal(node.itemListElement.length, 3);
  node.itemListElement.forEach((item, index) => {
    assert.equal(item.position, index + 1);
    assert.ok(item.name);
    assert.match(item.item, /^https:\/\/hangkathon\.com\//);
  });
});

test("ItemList 只声明调用方给的活动，并给出 numberOfItems", async () => {
  const { itemListNode } = await loadSchema();
  const node = itemListNode({
    path: "/activities",
    name: "AI 活动看板",
    items: [
      { name: "活动 A", path: "/activities/a" },
      { name: "活动 B", path: "/activities/b" },
    ],
  });
  assert.equal(node["@type"], "ItemList");
  assert.equal(node.numberOfItems, 2);
  assert.equal(node.itemListElement[0].url, "https://hangkathon.com/activities/a");
});

test("graph() 单节点展开、多节点用 @graph 且 @context 只出现一次", async () => {
  const { graph, websiteNode, organizationNode } = await loadSchema();
  const single = graph([websiteNode()]);
  assert.equal(single["@context"], "https://schema.org");
  assert.equal(single["@type"], "WebSite");

  const multi = graph([websiteNode(), organizationNode()]);
  assert.equal(multi["@context"], "https://schema.org");
  assert.equal(multi["@graph"].length, 2);
  for (const node of multi["@graph"]) {
    assert.equal(node["@context"], undefined, "@context 只能在最外层出现一次");
  }
});

test("所有节点：@context 是 https、不含占位文案、不留空数组", async () => {
  const { graph, webpageNode, organizationNode, breadcrumbNode } = await loadSchema();
  const doc = graph([
    organizationNode(),
    webpageNode({ path: "/about", name: "关于杭客松", description: "杭州 AI 活动平台" }),
    breadcrumbNode([{ name: "首页", path: "/" }, { name: "关于", path: "/about" }]),
  ]);
  const json = JSON.stringify(doc);
  assert.ok(json.includes("https://schema.org"));
  assert.equal(json.includes("http://schema.org"), false, "@context 必须是 https");
  assert.equal(/\[Business Name\]|\[City\]|\[URL\]|REPLACE_/i.test(json), false, "不能留占位文案");

  const walk = (value) => {
    if (Array.isArray(value)) {
      assert.ok(value.length > 0, "结构化数据里不应出现空数组");
      value.forEach(walk);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(walk);
    }
  };
  walk(doc);
});
