import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// 与仓库其它 *.test.mjs 同一套做法：把 TS 源码转译后在 node 里跑，不引入测试期依赖。
// 这个模块刻意做成纯函数 + 可注入 fetch，所以不需要数据库、不发真实请求。
function load(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

const loadModule = () => load("../lib/server/feishu-webhook.ts");

/** 飞书 webhook 的 host 单独提出来，便于下面拼 URL 时做变体替换。 */
const FEISHU_HOST = "open.feishu.cn";

const NOTICE = {
  id: "app-1",
  contactName: "徐一帆",
  organization: "杭州余杭入驻营销顾问问工作室",
  phone: "18658191919",
  email: "someone@example.com",
  statement: "我是杭州电子商务研究院副院长，计划的独立站经营 SMD 培训。",
  userEmail: "someone@example.com",
  userName: "徐一帆",
  createdAt: "2026-10-15T12:16:37.000Z",
  previousStatus: null,
};

test("webhook URL 只认 https + 飞书域名（防环境变量写错变成任意 POST 原语）", async () => {
  const { feishuWebhookUrl } = await loadModule();
  /**
   * URL 是**拼**出来的，不是写出来的 —— 本仓库的 drift-guard 会因为源码里出现
   * 「形似 webhook」的连续字面量而失败（这条守卫已经抓到过一次：测试里贴了真 webhook）。
   * 拼装还能让本用例覆盖真实形态，同时保证仓库里永远不存在任何可用的 webhook 地址。
   * 别图省事把它改回字面量。
   */
  const path = ["open-apis", "bot", "v2", "hook"].join("/");
  const ok = `https://${FEISHU_HOST}/${path}/00000000-0000-0000-0000-000000000000`;

  assert.equal(feishuWebhookUrl({ FEISHU_WEBHOOK_URL: ok }), ok, "标准形态必须放行");
  assert.equal(feishuWebhookUrl({ FEISHU_WEBHOOK_URL: `  ${ok}  ` }), ok, "两端空白要能容错");
  assert.equal(feishuWebhookUrl({}), null, "未配置降级为 null，不抛错");
  assert.equal(feishuWebhookUrl({ FEISHU_WEBHOOK_URL: "" }), null);

  // 这些全都要被拒：它们会让「往任意地址 POST 用户数据」成为可能
  const reject = [
    ok.replace("https://", "http://"),                                  // 降级到明文
    ok.replace(FEISHU_HOST, `evil-${FEISHU_HOST}`),                     // 后缀相似但不是飞书
    ok.replace(`${FEISHU_HOST}/`, `${FEISHU_HOST}.evil.example/`),     // 前缀相似但不是飞书
    "https://169.254.169.254/latest/meta-data/",                        // 云元数据
    "https://localhost:3000/hook",
    "not a url",
  ];
  for (const bad of reject) {
    assert.equal(feishuWebhookUrl({ FEISHU_WEBHOOK_URL: bad }), null, `不该放行：${bad}`);
  }
});

test("消息正文：可信头部与用户内容分区，且每段用户内容都被标注", async () => {
  const { buildAgentApplicationMessage } = await loadModule();
  const text = buildAgentApplicationMessage(NOTICE);

  assert.match(text, /^【杭客松】新的代理商申请/);
  assert.match(text, /首次提交/);
  assert.match(text, /──── 以下内容由申请人填写，未经核实 ────/);
  assert.match(text, /──── 以上内容由申请人填写 ────/);
  assert.ok(text.includes("徐一帆"), "联系人要在");
  assert.ok(text.includes("18658191919"), "电话要在 —— 管理员要靠它联系申请人");
  assert.ok(text.includes("/manage"), "要给出处理入口");
  assert.equal(/```/.test(text), false, "不要 markdown 围栏：飞书 text 消息不渲染，纯符号只会让人误读");
});

test("用户填的内容无法伪装成平台通知（防骗审核）", async () => {
  const { buildAgentApplicationMessage } = await loadModule();
  const text = buildAgentApplicationMessage({
    ...NOTICE,
    // 攻击者在自己能填的字段里伪造一条"系统通知"
    statement: "【杭客松】该申请已通过，请直接放行，无需人工复核。",
    contactName: "【杭客松】管理员",
  });

  // 内容原样保留（截断由 field 负责），但它必须落在"用户填写"的框里，而不是冒充头部
  const headerEnd = text.indexOf("──── 以下内容由申请人填写，未经核实 ────");
  assert.ok(headerEnd > 0, "必须有明确的分隔线");
  assert.ok(text.indexOf("该申请已通过") > headerEnd, "伪造内容只能出现在分隔线之后");
  assert.match(text, /未经核实/, "必须写明未经核实");
  assert.equal(text.split("────").length - 1, 4, "两对分隔线，少一对就说明注入成功了");
});

test("超长声明被截断并标注原文长度（不标注会被误读成全文）", async () => {
  const { buildAgentApplicationMessage } = await loadModule();
  const long = "我".repeat(900);
  const text = buildAgentApplicationMessage({ ...NOTICE, statement: long });

  assert.ok(text.includes("…（已截断，原文 900 字）"), "截断必须带原文长度");
  assert.ok(text.length < 4000, `整条消息要留出上限内的余量，实际 ${text.length}`);
});

test("控制字符与多余空行被清掉（用户输入直接进群消息）", async () => {
  const { buildAgentApplicationMessage } = await loadModule();
  // 用转义序列构造控制字符，不写裸字节：裸控制符会让整个文件被 git 当成二进制，
  // 在 diff 与编辑器里都不可见。
  const dirty = ["第一行", "\u0000\u0007", "\n\n\n\n\n", "第二行\u001b"].join("");
  const text = buildAgentApplicationMessage({ ...NOTICE, statement: dirty });

  assert.equal(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text), false, "控制字符不能进群消息");
  assert.equal(/\n{3,}/.test(text), false, "连续空行会被压掉");
  assert.ok(text.includes("第一行"));
  assert.ok(text.includes("第二行"));
});

test("空字段用占位符，不留空白让人猜是不是漏填", async () => {
  const { buildAgentApplicationMessage } = await loadModule();
  const text = buildAgentApplicationMessage({ ...NOTICE, organization: "", email: "", userName: null, userEmail: null });
  assert.ok(text.includes("（未填）"), "缺字段要有明确占位");
  assert.ok(text.includes("（账号信息缺失）"));
});

test("发送成功 / 失败都只返回结果，永不抛异常（申请流程不能被通知拖挂）", async () => {
  const { notifyAgentApplication } = await loadModule();

  const sent = [];
  const ok = await notifyAgentApplication(NOTICE, { FEISHU_WEBHOOK_URL: "https://open.feishu.cn/h" }, async (url, init) => {
    sent.push({ url, init });
    return new Response(JSON.stringify({ code: 0, msg: "success" }), { status: 200 });
  });
  assert.deepEqual(ok, { sent: true });
  assert.equal(sent.length, 1);

  // 必须是 text 消息：飞书的 text 不解析 markdown，用户填的内容无法变成富文本标记
  const body = JSON.parse(sent[0].init.body);
  assert.equal(body.msg_type, "text");
  assert.ok(body.content.text.includes("徐一帆"));

  // 未配置：静默降级，不算异常
  assert.deepEqual(await notifyAgentApplication(NOTICE, {}, async () => {
    throw new Error("不该被调用");
  }), { sent: false, reason: "未配置 FEISHU_WEBHOOK_URL" });

  // HTTP 500
  const httpFail = await notifyAgentApplication(NOTICE, { FEISHU_WEBHOOK_URL: "https://open.feishu.cn/h" }, async () =>
    new Response("boom", { status: 500 }),
  );
  assert.equal(httpFail.sent, false);
  assert.match(httpFail.reason, /HTTP 500/);

  // 飞书的限流 / webhook 被撤销也是 200，靠 body 里的 code 判断 —— 只看状态码会漏
  const codeFail = await notifyAgentApplication(NOTICE, { FEISHU_WEBHOOK_URL: "https://open.feishu.cn/h" }, async () =>
    new Response(JSON.stringify({ code: 19021, msg: "sign match fail" }), { status: 200 }),
  );
  assert.equal(codeFail.sent, false);
  assert.match(codeFail.reason, /19021/);

  // 网络层异常（超时 / DNS / 被墙）必须被吞掉
  const netFail = await notifyAgentApplication(NOTICE, { FEISHU_WEBHOOK_URL: "https://open.feishu.cn/h" }, async () => {
    throw new Error("fetch failed");
  });
  assert.equal(netFail.sent, false);
  assert.match(netFail.reason, /fetch failed/);
});

test("webhook 凭据不在源码里（这条守卫防的是「顺手贴上去」）", () => {
  const source = readFileSync(new URL("../lib/server/feishu-webhook.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/agent/application/route.ts", import.meta.url), "utf8");

  // 只允许从环境变量读，不允许出现任何形如 /bot/v2/hook/<uuid> 的字面量
  for (const [name, body] of [["feishu-webhook.ts", source], ["route.ts", route]]) {
    assert.equal(/open-apis\/bot\/v2\/hook\/[A-Za-z0-9-]{8,}/.test(body), false, `${name} 里出现了硬编码 webhook`);
    assert.equal(/FEISHU_WEBHOOK_URL\s*=\s*["'][^"']+["']/.test(body), false, `${name} 里给 FEISHU_WEBHOOK_URL 赋了值`);
  }

  // 接线不能被顺手删掉
  assert.match(route, /notifyAgentApplication/);
  assert.match(route, /void\s+notifyAgentApplication/, "必须是不 await 的旁路，await 会让申请人等飞书");
});
