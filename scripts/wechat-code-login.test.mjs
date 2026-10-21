import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

/**
 * 公众号验证码登录的核心逻辑。
 *
 * 这条链路的信任来源只有一个：**微信推送的签名**。签名错了，攻击者只要猜中
 * 一个 6 位码（100 万种）就能把自己的 openid 绑到别人的码上冒充登录。
 * 所以验签的用例最多。
 */
function load(relativePath) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}

const loadMp = () => load("../lib/server/wechat-mp.ts");

const TOKEN = "test-mp-token";
const sign = (parts) => createHash("sha1").update(parts.sort().join("")).digest("hex");

test("验签：微信的算法是 sha1(字典序排序后直接拼接)，不是 sha256", async () => {
  const { verifyWechatSignature } = await loadMp();
  const timestamp = "1700000000";
  const nonce = "abc123";

  const good = sign([TOKEN, timestamp, nonce]);
  assert.equal(good.length, 40, "sha1 是 40 位十六进制");
  assert.equal(verifyWechatSignature({ signature: good, timestamp, nonce, token: TOKEN }), true);

  // 参数顺序不影响结果（算法本身要排序）
  assert.equal(verifyWechatSignature({ signature: good, timestamp, nonce, token: TOKEN }), true);

  // 错误场景
  assert.equal(verifyWechatSignature({ signature: "deadbeef", timestamp, nonce, token: TOKEN }), false);
  assert.equal(verifyWechatSignature({ signature: good, timestamp, nonce, token: "wrong-token" }), false);
  assert.equal(verifyWechatSignature({ signature: good, timestamp: "1700000001", nonce, token: TOKEN }), false);
  assert.equal(verifyWechatSignature({ signature: good, timestamp, nonce: "other", token: TOKEN }), false);
  assert.equal(verifyWechatSignature({ signature: null, timestamp, nonce, token: TOKEN }), false);
  assert.equal(verifyWechatSignature({ signature: "", timestamp: "", nonce: "", token: TOKEN }), false);
});

test("验签：大小写不敏感（微信有时回大写十六进制）", async () => {
  const { verifyWechatSignature } = await loadMp();
  const timestamp = "1700000000";
  const nonce = "n1";
  const good = sign([TOKEN, timestamp, nonce]);
  assert.equal(verifyWechatSignature({ signature: good.toUpperCase(), timestamp, nonce, token: TOKEN }), true);
});

test("安全模式：签名要把 encrypt 一起排序，与明文模式不同", async () => {
  const { verifyWechatMsgSignature } = await loadMp();
  const timestamp = "1700000000";
  const nonce = "n1";
  const encrypt = "ENCRYPTEDBLOB";

  const good = sign([TOKEN, timestamp, nonce, encrypt]);
  assert.equal(verifyWechatMsgSignature({ signature: good, timestamp, nonce, encrypt, token: TOKEN }), true);
  // 用明文模式的签名（不含 encrypt）去验，必须失败 —— 两种算法不能混用
  const plainSignature = sign([TOKEN, timestamp, nonce]);
  assert.equal(
    verifyWechatMsgSignature({ signature: plainSignature, timestamp, nonce, encrypt, token: TOKEN }),
    false,
    "明文模式的签名不能用于安全模式",
  );
});

test("XML 取值：支持 CDATA、普通文本，取不到返回 null", async () => {
  const { xmlTag, parseMpMessage } = await loadMp();
  const xml = `<xml>
    <ToUserName><![CDATA[gh_abc]]></ToUserName>
    <FromUserName><![CDATA[oUser123]]></FromUserName>
    <CreateTime>1700000000</CreateTime>
    <MsgType><![CDATA[text]]></MsgType>
    <Content><![CDATA[ 959271 ]]></Content>
    <MsgId>123456789</MsgId>
  </xml>`;

  assert.equal(xmlTag(xml, "FromUserName"), "oUser123");
  assert.equal(xmlTag(xml, "Content"), "959271", "CDATA 内的空白要 trim");
  assert.equal(xmlTag(xml, "MsgType"), "text");
  assert.equal(xmlTag(xml, "NotThere"), null);
  assert.equal(xmlTag(xml, "../../etc/passwd"), null, "非法标签名要被清洗掉");

  const msg = parseMpMessage(xml);
  assert.equal(msg?.fromUser, "oUser123");
  assert.equal(msg?.msgType, "text");
  assert.equal(msg?.content, "959271");
  assert.equal(msg?.toUser, "gh_abc");
});

test("回复 XML：收发件人反序，内容做 XML 转义", async () => {
  const { textReplyXml } = await loadMp();
  const xml = textReplyXml("oUser123", "gh_abc", "内容含 < 和 & 时不能破坏 XML");
  assert.match(xml, /<ToUserName><!\[CDATA\[oUser123\]\]><\/ToUserName>/);
  assert.match(xml, /<FromUserName><!\[CDATA\[gh_abc\]\]><\/FromUserName>/);
  assert.match(xml, /&lt;/, "尖括号必须转义");
  assert.match(xml, /&amp;/, "& 必须转义");
  assert.equal(xml.includes("内容含 < 和"), false, "未转义的原文不能出现");
});

test("验证码规范化：全角、空格都能容错，非 6 位一律拒绝", async () => {
  const { normalizeSubmittedCode } = await load("../lib/server/wechat-code-pure.ts");
  assert.equal(normalizeSubmittedCode("959271"), "959271");
  assert.equal(normalizeSubmittedCode("  959271  "), "959271", "两端空白要容忍");
  assert.equal(normalizeSubmittedCode("959 271"), "959271", "中间的空白也容忍（用户常带空格）");
  assert.equal(normalizeSubmittedCode("９５９２７１"), "959271", "全角数字转半角");

  // 不该被接受
  assert.equal(normalizeSubmittedCode("12345"), null, "5 位不行");
  assert.equal(normalizeSubmittedCode("1234567"), null, "7 位不行");
  assert.equal(normalizeSubmittedCode("abcd12"), null);
  assert.equal(normalizeSubmittedCode(""), null);
  assert.equal(normalizeSubmittedCode("你好"), null);
});

test("生成验证码：6 位、可能有前导零、分布不退化", async () => {
  const { generateLoginCode } = await load("../lib/server/wechat-code-pure.ts");
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) {
    const code = generateLoginCode();
    assert.match(code, /^\d{6}$/, `必须是 6 位数字，实际 ${code}`);
    seen.add(code);
  }
  // 500 次里出现大量重复就说明随机源有问题（100 万空间，碰撞应极少）
  assert.ok(seen.size > 480, `随机性不足：500 次只有 ${seen.size} 个不同值`);
});

test("公众号回调端点：验签在最前，未验证不得绑定", () => {
  const route = readFileSync(new URL("../app/api/wechat/mp/route.ts", import.meta.url), "utf8");
  const code = route.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ").replace(/\s+/g, " ");

  // 验签必须发生在绑定之前 —— 反过来就等于谁都能绑
  const verifyAt = code.indexOf("verifyWechatSignature(");
  const bindAt = code.indexOf("bindCodeToOpenId(");
  assert.ok(verifyAt > 0 && bindAt > verifyAt, "必须先验签再绑定");

  // 两种模式都要验
  assert.match(code, /verifyWechatSignature\(\{ signature, timestamp, nonce, token \}\)/, "明文模式");
  assert.match(code, /verifyWechatMsgSignature\(\{ signature: msgSignature/, "安全模式");

  // 没配 token 必须整体拒绝，不能静默放行
  assert.match(code, /未配置 WECHAT_MP_TOKEN/);
  assert.match(code, /status: 503/);

  // 微信重投是常态：看不懂的消息要回 success（否则它会重推三次）
  assert.match(code, /return new Response\("success", \{ status: 200 \}\)/, "未知消息回 success");
});

test("换票端点：一次性消费 + 会话 cookie 的 salt/名字必须与 Auth.js 一致", () => {
  const route = readFileSync(new URL("../app/api/auth/wechat-code/poll/route.ts", import.meta.url), "utf8");
  const auth = readFileSync(new URL("../auth.ts", import.meta.url), "utf8");

  // 原子消费：WHERE status='bound' 的 UPDATE ... RETURNING
  assert.match(route, /consumeLoginCode\(/);
  assert.match(route, /salt: cookieName/, "salt 必须与 cookie 名一致，否则 auth() 读不出会话");
  assert.match(route, /__Secure-authjs\.session-token/, "https 下必须用 __Secure- 前缀");

  // maxAge 与 auth.ts 的 session.maxAge 保持一致
  assert.match(route, /const SESSION_MAX_AGE = 7 \* 24 \* 60 \* 60;/);
  assert.match(auth, /maxAge: 7 \* 24 \* 60 \* 60/);

  // email 约定必须与扫码登录一致，否则同一人会裂成两个账号
  assert.match(route, /@wechat\.user`/);
  assert.match(auth, /@wechat\.user`/);
});

test("验证码表：一次性 + 过期 + 唯一", () => {
  const schema = readFileSync(new URL("../db/schema.ts", import.meta.url), "utf8");
  const sql = readFileSync(new URL("../drizzle/0012_wechat_login_codes.sql", import.meta.url), "utf8");
  assert.match(schema, /wechatLoginCodes = pgTable\("wechat_login_codes"/);
  assert.match(schema, /uniqueIndex\("wechat_login_codes_code_unique"\)/);
  assert.match(schema, /consumedAt: timestamp/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "wechat_login_codes_code_unique"/);
  // 迁移必须可重入（CI 会重复应用）
  assert.match(sql, /CREATE TABLE IF NOT EXISTS/);
});
