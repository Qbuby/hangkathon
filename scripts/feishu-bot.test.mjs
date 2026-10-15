import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// 与仓库其它 *.test.mjs 同一套做法：把 TS 源码转译后在 node 里跑，不引入测试期依赖。
function load(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

const loadApi = () => load("../lib/server/feishu-api.ts");
const loadAdmin = () => load("../lib/server/feishu-admin.ts");

const KEY = "test-encrypt-key";
const now = () => 1_700_000_000_000;

/** 按飞书的算法生成合法签名：sha256(timestamp + nonce + encryptKey + body)。 */
function sign(body, { timestamp = String(Math.floor(now() / 1000)), nonce = "nonce-1", key = KEY } = {}) {
  return { timestamp, nonce, signature: createHash("sha256").update(`${timestamp}${nonce}${key}${body}`).digest("hex") };
}

test("验签：只有飞书算得出的签名才放行", async () => {
  const { verifyFeishuSignature } = await loadApi();
  const body = JSON.stringify({ hello: "world" });

  assert.deepEqual(verifyFeishuSignature(sign(body), body, KEY, now()), { ok: true });

  // 签名错
  assert.equal(verifyFeishuSignature({ timestamp: "1700000000", nonce: "n", signature: "deadbeef" }, body, KEY, now()).ok, false);
  // 密钥错（别人拿自己的飞书应用打过来）
  const other = sign(body, { key: "another-key" });
  assert.equal(verifyFeishuSignature(other, body, KEY, now()).ok, false);
  // body 被篡改
  assert.equal(verifyFeishuSignature(sign(body), `${body} `, KEY, now()).ok, false);
  // nonce 被换
  const tampered = sign(body);
  assert.equal(verifyFeishuSignature({ ...tampered, nonce: "nonce-2" }, body, KEY, now()).ok, false);
  // 请求头缺失
  assert.equal(verifyFeishuSignature({}, body, KEY, now()).ok, false);
});

test("验签：时间窗外一律拒（否则抓包重放可以无限期有效）", async () => {
  const { verifyFeishuSignature } = await loadApi();
  const body = "{}";
  const headers = sign(body);

  assert.equal(verifyFeishuSignature(headers, body, KEY, now()).ok, true, "当前时刻放行");
  // 5 分钟内仍在窗口
  assert.equal(verifyFeishuSignature(headers, body, KEY, now() + 4 * 60 * 1000).ok, true);
  // 超过 5 分钟 —— 无论是过去的旧请求还是未来的钟，都拒
  assert.equal(verifyFeishuSignature(headers, body, KEY, now() + 6 * 60 * 1000).ok, false, "过期请求");
  assert.equal(verifyFeishuSignature(headers, body, KEY, now() - 6 * 60 * 1000).ok, false, "未来时间戳");
  // 时间戳不是数字
  assert.equal(verifyFeishuSignature({ ...headers, timestamp: "abc" }, body, KEY, now()).ok, false);
});

test("解密：encrypt 字段走 AES-256-CBC，且解密发生在验签之后", async () => {
  const { decryptFeishuPayload, parseInbound } = await loadApi();
  // 造一个飞书格式的加密信封：key=sha256(encryptKey)，iv 取密文前 16 字节
  const key = createHash("sha256").update(KEY).digest();
  const plain = JSON.stringify({ type: "url_verification", challenge: "abc-123" });
  const iv = Buffer.from("0123456789abcdef");
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const cipherBytes = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const envelope = JSON.stringify({ encrypt: Buffer.concat([iv, cipherBytes]).toString("base64") });

  assert.equal(decryptFeishuPayload(KEY, Buffer.concat([iv, cipherBytes]).toString("base64")), plain);

  // 完整入口：签名对 + 加密体 -> 解出明文
  const ok = parseInbound(envelope, sign(envelope), KEY, now());
  assert.equal(ok.ok, true);
  assert.equal(ok.payload.challenge, "abc-123");

  // 签名不对时，即使密文能解开也必须先被拒（不能"先解密再验签"）
  const bad = parseInbound(envelope, sign(envelope, { key: "wrong" }), KEY, now());
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /签名/);
});

test("入站解析：非 JSON / 畸形 encrypt 都被拒", async () => {
  const { parseInbound } = await loadApi();
  const notJson = "not json";
  assert.equal(parseInbound(notJson, sign(notJson), KEY, now()).ok, false);

  const short = JSON.stringify({ encrypt: "AAAA" });
  assert.equal(parseInbound(short, sign(short), KEY, now()).ok, false, "encrypt 长度不足");
});

test("事件去重：同一个 event_id 只处理一次（飞书没收到 2xx 会重投）", async () => {
  const { markEventOnce } = await loadApi();
  const id = "evt-1";
  assert.equal(markEventOnce(id, now()), true, "第一次应当处理");
  assert.equal(markEventOnce(id, now()), false, "重投必须被忽略");
  assert.equal(markEventOnce(id, now() + 1000), false);

  // 不同 id 互不影响
  assert.equal(markEventOnce("evt-2", now()), true);
  // 超出保留窗口后不再记得 —— 这是有意的：去重窗口只有 10 分钟，
  // 跨更长时间的重复投递由「写操作幂等 + 确认卡片」兜底，不无限占内存
  assert.equal(markEventOnce("evt-1", now() + 11 * 60 * 1000), true);
});

test("命令解析：去掉 @提及、中英文别名、不猜错词", async () => {
  const { parseCommand, helpText, isWriteCommand, WRITE_COMMANDS } = await loadAdmin();

  // 飞书群里 @机器人 时 content.text 是 `@_user_1 帮助` 或 `@杭客松 总览`
  assert.deepEqual(parseCommand("@_user_1 帮助"), { name: "帮助", args: [], raw: "帮助" });
  assert.deepEqual(parseCommand("@杭客松 总览"), { name: "总览", args: [], raw: "总览" });
  assert.deepEqual(parseCommand("@_user_1 代理商通过 abc-123 通过备注"), {
    name: "代理商通过",
    args: ["abc-123", "通过备注"],
    raw: "代理商通过 abc-123 通过备注",
  });
  // 英文别名
  assert.equal(parseCommand("@bot overview").name, "总览");
  assert.equal(parseCommand("@bot agents").name, "代理商");
  // 纯 @ 机器人没有内容 -> 不当成命令
  assert.equal(parseCommand("@_user_1"), null);
  assert.equal(parseCommand("   "), null);

  // **不做模糊匹配**：拼错的词落在"未知命令"，而不是猜一个相近的写操作
  assert.equal(parseCommand("@bot 删活动 x").name, "删活动", "错词原样保留，交给命令层报未知命令");
  assert.equal(isWriteCommand("删活动"), false, "错词不会被误判成写命令");

  // 写命令集合必须覆盖 /manage 的全部变更操作
  for (const name of [
    "公开", "下线", "删除活动", "通过作品", "驳回作品", "撤回作品", "刷新作品",
    "移除报名", "代理商通过", "代理商驳回", "设为代理商", "设为用户", "设为管理员",
    "删除用户", "拉黑", "解拉黑", "隐藏赛事", "显示赛事", "删除赛事",
  ]) {
    assert.equal(isWriteCommand(name), true, `${name} 必须被归类为写命令（要二次确认）`);
  }
  for (const name of ["总览", "活动", "用户", "代理商", "赛事", "黑名单", "审计", "帮助"]) {
    assert.equal(isWriteCommand(name), false, `${name} 是读命令，不该要确认`);
  }
  assert.ok(WRITE_COMMANDS.size >= 19, "写命令清单不该被悄悄清空");
  assert.match(helpText(), /代理商通过/);
});

test("白名单解析：只接受 ou_ 开头的 open_id 与合法邮箱，格式错了不静默半生效", async () => {
  const { parseAdminBindings } = await loadAdmin();

  const map = parseAdminBindings("ou_aaa=Owner@Example.com, ou_bbb=ops@example.com");
  assert.equal(map.size, 2);
  assert.equal(map.get("ou_aaa"), "owner@example.com", "邮箱要归一化小写");

  // 这些都要被忽略而不是部分生效
  const bad = parseAdminBindings(
    "ou_ccc=no-at-sign,  ou_ddd=, =x@example.com, ou_eee=a@b.c 空格, open_id_fake=x@y.com,  ,, ou_fff",
  );
  assert.equal(bad.size, 0, `不该解析出任何条目，实际 ${JSON.stringify([...bad])}`);

  assert.equal(parseAdminBindings("").size, 0);
  assert.equal(parseAdminBindings(undefined).size, 0);
});

test("resolveOperator：查不到站内用户就返回 null（绝不为远程操作凭空造账号）", async () => {
  const source = readFileSync(new URL("../lib/server/feishu-admin.ts", import.meta.url), "utf8");

  // 这里没法真跑（要数据库），所以静态确认它用的是 getUserByEmail 而不是 ensureUser ——
  // ensureUser 会 upsert，意味着"白名单里写错一个邮箱"就会凭空造出一个账号
  assert.match(source, /import\("\.\/users"\)/, "users 模块应当动态 import（避免把会话依赖拉进来）");
  assert.match(source, /getUserByEmail/);
  assert.equal(/\bensureUser\b/.test(source), false, "resolveOperator 绝不能调用 ensureUser（它会 upsert 造账号）");
  // 白名单里写了非管理员也必须挡住
  assert.match(source, /user\.role !== "admin"/, "白名单里的非管理员不能放行");
});

test("入站端点的安全不变量（静态）", () => {
  const route = readFileSync(new URL("../app/api/feishu/events/route.ts", import.meta.url), "utf8");
  const api = readFileSync(new URL("../lib/server/feishu-api.ts", import.meta.url), "utf8");

  // 没配 Encrypt Key 就必须整体拒绝 —— 否则等于把管理端口开到公网
  assert.match(route, /FEISHU_ENCRYPT_KEY/);
  assert.match(route, /status: 503/, "未配置密钥时返回 503 并拒绝所有请求");
  // 验签必须在最前面，且失败不得回显原因。
  // 注意这里查的是"结果被赋给 parsed 并被检查"，而不是"文件里出现过 parseInbound"——
  // 只查出现过的话，把调用改成不使用、留着声明就骗得过去（变异测试 F 试过）。
  assert.match(route, /const\s+parsed\s*=\s*parseInbound\(/, "parseInbound 的结果必须被使用");
  assert.match(route, /if\s*\(!parsed\.ok\)/, "必须检查 parsed.ok");
  assert.ok(
    route.indexOf("parseInbound(") < route.indexOf("resolveOperator("),
    "验签必须在解析操作者之前",
  );
  assert.equal(/replyToMessage\(\s*messageId,\s*parsed\./.test(route), false, "不能把验签失败原因回显给调用方");
  // 卡片回调必须二次鉴权：数"解析操作者"的次数，而不是看有没有出现过这个词。
  // 两条入站路径（群命令 / 卡片回调）各要一次 —— 卡片会出现在群里，任何人都能点。
  const resolutions = (route.match(/await resolveOperator\(openId\)/g) ?? []).length;
  assert.ok(resolutions >= 2, `群命令与卡片回调必须各自解析操作者，实际只解析了 ${resolutions} 次`);
  // 写操作只能通过 executeWrite 落地，且 plan 不执行任何写
  const commands = readFileSync(new URL("../lib/server/feishu-commands.ts", import.meta.url), "utf8");
  const planSection = commands.slice(commands.indexOf("export async function planWriteCommand"), commands.indexOf("export async function executeWrite"));
  for (const mutating of ["setActivityReview(", "setActivityVisibility(", "deleteActivity(", "setSubmissionReview(", "reviewAgentApplication(", "setUserRole(", "deleteUser(", "addToBlacklist(", "revokeBlacklist(", "setExternalEventHidden(", "deleteExternalEventAdmin(", "removeJoinAdmin("]) {
    assert.equal(planSection.includes(mutating), false, `planWriteCommand 里出现了写操作 ${mutating} —— 确认卡片阶段不许改数据`);
  }
  assert.match(commands, /export async function executeWrite/);
  // 审计必须带 via=feishu，否则日后分不清是群里点的还是网页上点的
  assert.match(route, /via: "feishu"/);
  assert.match(route, /feishuOpenId/);
  assert.ok(api.includes("timingSafeEqual"), "签名比较必须用定时安全比较");
});
