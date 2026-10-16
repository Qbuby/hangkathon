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

test("peekDecrypted 能解开**不带签名**的加密握手，而 parseInbound 仍然拒绝它", async () => {
  const { peekDecrypted, parseInbound } = await loadApi();
  const plain = JSON.stringify({ challenge: "unsigned-challenge", token: "tok", type: "url_verification" });
  const key = createHash("sha256").update(KEY).digest();
  const iv = Buffer.from("0123456789abcdef");
  const c = createCipheriv("aes-256-cbc", key, iv);
  const cipherBytes = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const envelope = JSON.stringify({ encrypt: Buffer.concat([iv, cipherBytes]).toString("base64") });

  /**
   * 2026-10-15 实际踩到的坑：开了加密策略后，飞书发来的地址校验请求是
   * **加密但不带签名头**的（实测 timestamp/nonce/signature 三个头全缺）。
   * 而 parseInbound 是"先验签后解密"，于是在解密之前就把请求挡掉了。
   * 握手是建立信任的第一步，本来就不可能用还没建立的信任自证 ——
   * 所以握手改走 peekDecrypted（只解密、不验签）。
   */
  const peeked = peekDecrypted(envelope, KEY);
  assert.equal(peeked?.type, "url_verification", "握手必须能解开");
  assert.equal(peeked?.challenge, "unsigned-challenge");

  // **同一个请求**走事件路径必须仍然被拒 —— 放开握手不等于放开事件
  const asEvent = parseInbound(envelope, {}, KEY, now());
  assert.equal(asEvent.ok, false, "无签名的事件必须拒绝");
  assert.match(asEvent.reason, /验签/);

  // 明文形态（还没配密钥时）也要能读
  const plaintext = JSON.stringify({ challenge: "plain", type: "url_verification" });
  assert.equal(peekDecrypted(plaintext, KEY)?.challenge, "plain");
  // 密钥不对就解不开 —— peek 不是绕过加密的后门
  assert.equal(peekDecrypted(envelope, "wrong-key"), null);
  // 畸形输入不抛错
  assert.equal(peekDecrypted("not json", KEY), null);
  assert.equal(peekDecrypted(JSON.stringify({ encrypt: "AAAA" }), KEY), null);
});

test("卡片必须声明 schema 2.0，否则正文会被整块忽略（渲染成空白卡片）", async () => {
  const { textCard, confirmCard, resultCard } = await loadApi();

  /**
   * 2026-10-15 线上实测踩到：卡片标题能渲染、正文一片空白。
   * 原因是飞书卡片有两套结构 —— 不写 `schema` 时按 **1.0** 解析，
   * 而 1.0 的元素在**顶层** `elements`，所以 2.0 写法里的 `body.elements` 被忽略。
   *
   * 这个失败**不报任何错**：接口返回 code=0，日志里也干净，只有肉眼能发现。
   * 所以必须由单测钉死。
   */
  const cards = {
    textCard: textCard("标题", ["第一行", "第二行"]),
    confirmCard: confirmCard("确认", "正文", { command: "下线 x" }),
    resultCard: resultCard("已执行", ["做了"], true),
  };
  for (const [name, card] of Object.entries(cards)) {
    assert.equal(card.schema, "2.0", `${name} 必须声明 schema: "2.0"，否则正文被忽略`);
    assert.ok(Array.isArray(card.body?.elements), `${name} 必须把元素放在 body.elements`);
    assert.ok(card.body.elements.length > 0, `${name} 的 body 不能是空的`);
    // 顶层 elements 是 1.0 的写法，与 2.0 混用会让人误以为内容有了
    assert.equal(card.elements, undefined, `${name} 不该用 1.0 的顶层 elements`);
    assert.ok(card.header?.title?.content, `${name} 必须有标题`);
  }

  // 内容真的进了卡片，而不是只有壳
  const t = cards.textCard;
  assert.ok(t.body.elements.some((e) => e.tag === "markdown" && e.content.includes("第一行")));
  assert.ok(t.body.elements.some((e) => e.tag === "hr"));

  // 确认卡片必须真的带两个按钮，且按钮 value 里有命令串
  const c = cards.confirmCard;
  const buttons = c.body.elements.filter((e) => e.tag === "button");
  assert.equal(buttons.length, 2, "必须有「确认」与「取消」两个按钮");
  assert.deepEqual(buttons[0].value, { command: "下线 x" }, "卡片构造器原样透传 value");
  assert.deepEqual(buttons[1].value, { cancel: "1" });
  // 注意：令牌是**路由**加进 value 的（confirmCard 只负责透传），所以那一条断言在
  // 下面的静态守卫里 —— 放这里测会误以为 confirmCard 该自己生成令牌。

  /**
   * 2.0 **不支持** `note` 与 `action` 两个标签（实测报错：
   * `cards of schema V2 no longer support this capability ... unsupported tag note`）。
   * 用了它们整张卡片会 400，而 1.0 的写法（顶层 elements + action）在 2.0 语境下
   * 又会被忽略成空白卡片 —— 两种症状完全不同，所以这里逐个标签钉死。
   */
  for (const [name, card] of Object.entries(cards)) {
    for (const el of card.body.elements) {
      assert.notEqual(el.tag, "note", `${name} 用了 2.0 不支持的 note 标签`);
      assert.notEqual(el.tag, "action", `${name} 用了 2.0 不支持的 action 标签`);
    }
  }
  // 小字说明改用 markdown 承载，内容不能丢
  assert.ok(c.body.elements.some((e) => e.tag === "markdown" && String(e.content).includes("审计日志")), "确认卡片的小字说明要保留");
});

test("时间戳头有两种格式，都必须能验（卡片回调踩过一次）", async () => {
  const { verifyFeishuSignature, parseFeishuTimestamp } = await loadApi();
  const body = "{}";
  const nowMs = Date.parse("2026-10-16T14:41:47.224+08:00");

  /**
   * 2026-10-16 实测飞书真实发来的两种值：
   *   事件回调   ts="1792132835"                                        （十位 Unix 秒）
   *   卡片回调   ts="2026-10-16 14:41:47.224834685 +0800 CST m=+328043.243701041"
   *
   * 我一直假设只有第一种，结果卡片回调全被判「时间戳不是数字」→ 401 → 飞书显示 200671。
   * 签名算法本身是对的（sha256 / 64 位十六进制两边一致），错的只是这一项的格式。
   */
  const SECONDS = "1792132835";
  const LONG = "2026-10-16 14:41:47.224834685 +0800 CST m=+328043.243701041";

  // 格式解析
  assert.equal(parseFeishuTimestamp(SECONDS), 1792132835 * 1000, "十位=秒");
  assert.equal(parseFeishuTimestamp("1792132835123"), 1792132835123, "十三位=毫秒");
  assert.equal(parseFeishuTimestamp(LONG), nowMs, "长格式按数字偏移解析，纳秒截断到毫秒");
  assert.equal(parseFeishuTimestamp("   1792132835  "), 1792132835000, "两端空白要容错");
  assert.equal(parseFeishuTimestamp("不是时间"), null);
  assert.equal(parseFeishuTimestamp(""), null);

  /**
   * **时区缩写是个陷阱**：把带 `CST` 的串直接丢给 Date.parse，V8 会把 CST 认成
   * "美国中部时区 UTC-6"，`+0800` 被忽略，结果偏 14 小时。
   * 失败会报错，而"安静地算错"只会让时间窗判断失真 —— 所以这里钉死。
   */
  assert.equal(
    parseFeishuTimestamp("2026-10-16 14:41:47.000 +0800"),
    parseFeishuTimestamp("2026-10-16T14:41:47+08:00"),
    "带 CST 尾缀也必须按数字偏移 +0800 解释",
  );
  assert.notEqual(
    parseFeishuTimestamp("2026-10-16 14:41:47.000 +0800 CST"),
    Date.parse("2026-10-16 14:41:47.000 +0800 CST"),
    "直接 Date.parse 会被 CST 拐到 UTC-6（偏 14 小时），所以实现必须绕开它",
  );

  // 两种格式都必须能通过完整验签（签名用**原始字符串**参与计算，不能用解析后的值）
  for (const [label, ts] of [["事件回调", SECONDS], ["卡片回调", LONG]]) {
    const headers = sign(body, { timestamp: ts, key: KEY });
    const result = verifyFeishuSignature(headers, body, KEY, parseFeishuTimestamp(ts));
    assert.equal(result.ok, true, `${label} 的时间戳格式必须能验签通过`);
  }

  // 时间窗仍然生效：长格式超过 5 分钟也要拒（防重放不能因为换了格式就失效）
  const stale = sign(body, { timestamp: "2026-10-16 14:00:00.000 +0800 CST m=+1", key: KEY });
  assert.equal(verifyFeishuSignature(stale, body, KEY, nowMs).ok, false, "超窗的长格式时间戳必须拒绝");

  // 签名不匹配仍然拒绝（不能因为放宽了时间戳解析就放松别的）
  assert.equal(verifyFeishuSignature({ ...sign(body, { timestamp: LONG }), signature: "deadbeef" }, body, KEY, nowMs).ok, false);
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
  assert.deepEqual(map.get("ou_aaa"), ["owner@example.com"], "邮箱要归一化小写");

  // 一个 open_id 可以绑多个站内邮箱（同一个人有多个账号，而飞书事件里只有 open_id、
  // 反查不出是哪个站内账号 —— 猜一个错就是用户再等一轮"还是不行"）
  const multi = parseAdminBindings("ou_ccc=a@example.com|A@Example.com|b@example.com");
  assert.deepEqual(multi.get("ou_ccc"), ["a@example.com", "a@example.com", "b@example.com"].filter((v, i, arr) => arr.indexOf(v) === i));
  // 分隔项里混进非邮箱的值，整项都不该被采纳
  assert.equal(parseAdminBindings("ou_ddd=ok@example.com|bad-value").get("ou_ddd")?.length, 1);
  // 重复的 open_id 分多次出现要合并，而不是后者覆盖前者
  const merged = parseAdminBindings("ou_eee=a@example.com,ou_eee=b@example.com");
  assert.deepEqual(merged.get("ou_eee"), ["a@example.com", "b@example.com"]);

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
  // 白名单里写了非管理员也必须挡住（现在是「命中就 return，全部不命中才 null」的循环形态）
  assert.match(source, /user && user\.role === "admin"/, "白名单里的非管理员不能放行");
  assert.match(source, /return null;\s*\}/, "全部绑定邮箱都解析不出 admin 时必须返回 null");
  // 一个 open_id 绑多个邮箱：逐个试，而不是只试第一个就放弃
  assert.match(source, /for \(const email of bindings\)/, "多个绑定邮箱要逐个尝试");
});

test("url_verification 握手必须在密钥检查之前（死锁过一次）", () => {
  const raw = readFileSync(new URL("../app/api/feishu/events/route.ts", import.meta.url), "utf8");
  /**
   * 先把注释剥掉再看位置。
   * 第一版没剥，于是 indexOf("url_verification") 命中的是文件头那段**注释**里对流程的
   * 描述 —— 顺序断言"通过"了，但验的根本不是代码。这种假绿比没有断言更糟。
   */
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");

  const challengeAt = code.indexOf('"url_verification"');
  /**
   * 锚点要选对：**不是** `requireEncryptKey()` 的调用，而是它失败后的那个 503。
   * 加密握手的 challenge 藏在密文里，必须先拿到密钥才能解出来 —— 所以取密钥当然在前；
   * 真正的不变量是「challenge 应答必须排在 503 拒绝之前」。
   * （第一版锚在 requireEncryptKey() 上，第二版改成锚在 503 上才对。）
   */
  const notConfiguredAt = code.indexOf('"not configured"');
  assert.ok(challengeAt > 0, "代码里必须有 url_verification 分支");
  assert.ok(notConfiguredAt > 0, "代码里必须有未配置密钥的 503 拒绝");
  assert.ok(
    challengeAt < notConfiguredAt,
    "url_verification 握手必须在「未配置密钥 → 503」之前处理 —— 否则后台永远验证不通过（死锁）",
  );

  // 握手必须能处理**加密**信封：开了加密策略后飞书发的是 {encrypt}，且不带签名头。
  // 所以握手路径用 peekDecrypted（只解密不验签），而不是会先验签的 parseInbound。
  assert.match(code, /peekDecrypted\(rawBody, encryptKey\)/,
    "握手必须走只解密不验签的 peekDecrypted —— 加密后的握手不带签名头");
  // 真正的事件路径仍然强制验签：不能因为放开握手就连事件也放开了
  const eventPath = code.slice(challengeAt);
  assert.match(eventPath, /parseInbound\(rawBody/, "事件路径必须走 parseInbound（强制验签）");
  assert.match(eventPath, /if \(!parsed\.ok\)/, "事件路径必须检查 parsed.ok");

  // 握手分支只能原样回显 challenge，不能顺手做别的事（不读库、不落状态）
  assert.match(code, /NextResponse\.json\(\{ challenge: peeked\.challenge \}\)/,
    "必须原样回显 challenge");
  assert.match(code, /payload\.type === "url_verification"/, "加密模式下的 challenge 也要能应答");
});

test("卡片回调的每个分支都必须带 toast（空对象会被飞书判 200671）", () => {
  const route = readFileSync(new URL("../app/api/feishu/events/route.ts", import.meta.url), "utf8");
  const code = route.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ").replace(/\s+/g, " ");

  /**
   * 2026-10-15 用户点「取消」报 `code: 200671`。原因是我当时返回 `{}` ——
   * 飞书的回调响应体要求至少带 `toast` 或 `card` 之一，两者都缺就报错。
   *
   * 这类"少一个字段"的退化不写守卫一定会再犯：代码照常编译、测试照常通过，
   * 只有用户点按钮时才知道。所以这里静态钉死。
   */
  assert.equal(/NextResponse\.json\(\{\s*\}\)/.test(code), false, "不能返回空对象 —— 飞书会判 200671");

  // 取消 / 未授权 / 执行成功 / 执行失败：四条路径都要经过带 toast 的构造器
  const responder = code.match(/function cardActionResponse\([\s\S]*?\n?\}/);
  assert.ok(responder, "必须通过 cardActionResponse 统一构造响应");
  assert.match(code, /function cardActionResponse\(toast:/, "toast 必须是必填参数");

  /**
   * 2026-10-16 实测：带 `card` 的回调响应会被判 **200672**（验签已通过、响应也送到了，
   * 是响应内容本身的问题）。所以卡片回调**只回 toast**、不碰卡片更新 ——
   * 与其赌一个猜出来的格式，不如用最保守的响应。按钮留在原地只是观感问题，
   * 真正要紧的「重复点击会不会重复执行」由一次性令牌兜住。
   */
  assert.equal(/cardActionResponse\([\s\S]{0,200}?,\s*resultCard/.test(code), false,
    "卡片回调响应不要带 card（200672）");

  assert.match(code, /newConfirmToken\(\)/, "生成确认卡片时必须带一次性令牌");
  assert.match(code, /token: newConfirmToken\(\)/, "令牌的 key 必须是 token");

  // 一次性令牌必须在执行之前消费
  const tokenAt = code.indexOf("consumeConfirmToken(value.token)");
  const execAt = code.indexOf("await executeWrite(");
  assert.ok(tokenAt > 0 && execAt > tokenAt, "令牌消费必须在 executeWrite 之前");

  // 四条分支都在
  for (const [label, needle] of [
    ["取消", '已取消，没有执行任何操作'],
    ["未授权", "未授权，操作没有执行"],
    ["执行成功", "已执行"],
    ["执行失败", "执行失败"],
  ]) {
    assert.ok(code.includes(needle), `缺少「${label}」分支的 toast 文案`);
  }

  // 取消必须真的不执行：command 为空时直接返回，不能落到 executeWrite
  const cancelAt = code.indexOf("已取消，没有执行任何操作");
  assert.ok(cancelAt > 0 && cancelAt < execAt, "取消分支必须在 executeWrite 之前返回");
});

test("一次性令牌：同一张卡片点第二次不得重复执行", async () => {
  const { consumeConfirmToken, newConfirmToken } = await loadApi();
  const t = newConfirmToken();
  assert.equal(consumeConfirmToken(t, 1000), true, "第一次应当放行");
  assert.equal(consumeConfirmToken(t, 1000), false, "第二次必须拒绝（用户手滑点两下）");
  assert.equal(consumeConfirmToken(t, 9000), false);

  // 不同卡片互不影响
  assert.equal(consumeConfirmToken(newConfirmToken(), 1000), true);

  // 没有令牌 = 不放行（不给「没令牌也能执行」留后门）
  assert.equal(consumeConfirmToken(undefined, 1000), false);
  assert.equal(consumeConfirmToken("", 1000), false);

  // 令牌用完即忘（TTL 30 分钟），不做成无界 Map
  assert.equal(consumeConfirmToken(t, 40 * 60 * 1000), true, "超期后不再视为已消费");
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
