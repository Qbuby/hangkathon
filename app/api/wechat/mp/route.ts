import { databaseRequired } from "@/lib/server/http";
import { writeAudit } from "@/lib/server/audit";
import { bindCodeToOpenId, normalizeSubmittedCode } from "@/lib/server/wechat-code-login";
import {
  decryptWechatMessage,
  getMpUserInfo,
  parseMpMessage,
  textReplyXml,
  verifyWechatSignature,
  verifyWechatMsgSignature,
} from "@/lib/server/wechat-mp";

/**
 * 微信公众号消息回调（订阅号唯一能用的登录通道）。
 *
 * ── 这个端点的信任模型 ──────────────────────────────────────────────────
 * 公网可 POST，任何人能打。所以：
 *   1. **必须验签**。微信的签名是 `sha1(sort([token, timestamp, nonce]).join(""))`；
 *      不验签的话，攻击者猜中一个 6 位码（100 万种，配合无成本重试很快就中）
 *      就能把**自己的 openid** 绑到别人的码上，从而冒充别人登录。
 *   2. **未知/异常格式一律回 success**。微信对非 200 或非预期响应会重投三次；
 *      对"看不懂的消息"回一个空串 + 200 是正确做法，回 4xx 只会让他反复重推。
 *   3. **绑定动作幂等**。重投同一个 MsgId 不该产生任何状态变化。
 *
 * ── 明文模式 vs 安全模式 ────────────────────────────────────────────────
 * 公众号后台可以选三种模式。这里两种都支持：
 *   · 明文/兼容：query 带 signature，body 是明文 XML
 *   · 安全模式：query 带 msg_signature，body 里是 <Encrypt>；需要 AppSecret
 * 判断依据是 query 里出现哪个 —— 这是微信自己的约定，不是我们发明。
 */
export const dynamic = "force-dynamic";

/** 微信要求 5 秒内响应；超时会重试三次。所以这里全部同步处理。 */
export async function GET(request: Request) {
  // 首次配置服务器地址时，微信会发一个 GET 做校验：原样回 echostr 才算配好
  const url = new URL(request.url);
  const signature = url.searchParams.get("signature");
  const timestamp = url.searchParams.get("timestamp");
  const nonce = url.searchParams.get("nonce");
  const echostr = url.searchParams.get("echostr");
  const token = process.env.WECHAT_MP_TOKEN?.trim();
  if (!token || !echostr) return new Response("missing config", { status: 503 });

  const ok = verifyWechatSignature({ signature, timestamp, nonce, token });
  if (!ok) {
    console.error(`[wechat-mp] GET 验签失败 ip=${request.headers.get("x-forwarded-for") ?? "?"}`);
    return new Response("invalid signature", { status: 401 });
  }
  return new Response(echostr, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export async function POST(request: Request) {
  const blocked = databaseRequired();
  if (blocked) return blocked;

  const token = process.env.WECHAT_MP_TOKEN?.trim();
  if (!token) {
    console.error("[wechat-mp] 未配置 WECHAT_MP_TOKEN，拒绝所有推送");
    return new Response("not configured", { status: 503 });
  }

  const url = new URL(request.url);
  const raw = await request.text().catch(() => "");
  const timestamp = url.searchParams.get("timestamp");
  const nonce = url.searchParams.get("nonce");

  /**
   * 两种模式分流。`msg_signature` 存在 = 安全模式（带 Encrypt）。
   * 安全模式的签名要把 encrypt 一起参与排序，且解密需要 EncodingAESKey。
   */
  const msgSignature = url.searchParams.get("msg_signature");
  let xml = raw;

  if (msgSignature) {
    const aesKey = process.env.WECHAT_MP_AES_KEY?.trim();
    if (!aesKey) {
      console.error("[wechat-mp] 收到安全模式推送但未配置 WECHAT_MP_AES_KEY");
      return new Response("not configured", { status: 503 });
    }
    const encryptedTag = /<Encrypt>\s*(?:<!\[CDATA\[([\s\S]*?)\]\]>|([\s\S]*?))\s*<\/Encrypt>/.exec(raw);
    const encrypted = (encryptedTag?.[1] ?? encryptedTag?.[2] ?? "").trim();
    if (!encrypted) {
      console.error("[wechat-mp] 安全模式推送里没有 Encrypt 字段");
      return new Response("success", { status: 200 });
    }
    if (!verifyWechatMsgSignature({ signature: msgSignature, timestamp, nonce, encrypt: encrypted, token })) {
      console.error(`[wechat-mp] POST 安全模式验签失败 ip=${request.headers.get("x-forwarded-for") ?? "?"}`);
      return new Response("invalid signature", { status: 401 });
    }
    try {
      xml = decryptWechatMessage(aesKey, encrypted);
    } catch (error) {
      console.error("[wechat-mp] 解密失败", error);
      return new Response("success", { status: 200 });
    }
  } else {
    const signature = url.searchParams.get("signature");
    if (!verifyWechatSignature({ signature, timestamp, nonce, token })) {
      console.error(`[wechat-mp] POST 明文模式验签失败 ip=${request.headers.get("x-forwarded-for") ?? "?"}`);
      return new Response("invalid signature", { status: 401 });
    }
  }

  const message = parseMpMessage(xml);
  if (!message) return new Response("success", { status: 200 });

  // 只处理文本消息；关注/取关等事件目前不需要（登录不依赖带参二维码）
  if (message.msgType !== "text") {
    return new Response("success", { status: 200 });
  }

  const code = normalizeSubmittedCode(message.content);
  if (!code) {
    // 用户发了别的内容：回一句引导，但不做任何绑定
    return xmlResponse(
      textReplyXml(
        message.fromUser,
        message.toUser ?? "",
        "请把网页上显示的 6 位数字发给我，即可完成登录。\n例如：959271",
      ),
    );
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip");

  /**
   * 取 unionid：这是「新老账号统一」的关键。
   * 公众号与网站应用绑在同一个开放平台账号下 → 同一个微信号两边 openid 不同、
   * **unionid 相同**。拿到 unionid 才能和电脑端扫码登录的老账号认成同一个人。
   *
   * 拿不到也不阻断登录（退化成按公众号 openid 建号），但会记日志 ——
   * 这通常意味着 AppSecret 没配或接口权限没开。
   */
  const userInfo = await getMpUserInfo(message.fromUser);
  const unionId = userInfo?.unionId ?? null;

  const result = await bindCodeToOpenId({ code, openId: message.fromUser, unionId });

  if (!result.ok) {
    const reasonText =
      result.reason === "not_found"
        ? "没有找到这个验证码。请回到网页重新获取。"
        : result.reason === "expired"
          ? "这个验证码已经过期了，请回到网页重新获取。"
          : "这个验证码已经被使用过了。请回到网页重新获取。";
    await writeAudit({
      category: "auth",
      action: "auth.wechat_code.rejected",
      ip,
      method: "POST",
      path: "/api/wechat/mp",
      targetType: "wechat_login_code",
      targetId: code,
      result: "failed",
      detail: { reason: result.reason, openIdPrefix: message.fromUser.slice(0, 8) },
    }).catch(() => {});
    return xmlResponse(textReplyXml(message.fromUser, message.toUser ?? "", reasonText));
  }

  await writeAudit({
    category: "auth",
    action: "auth.wechat_code.bound",
    ip,
    method: "POST",
    path: "/api/wechat/mp",
    targetType: "wechat_login_code",
    targetId: code,
    result: "success",
    // 不记完整 openid：它是身份标识，日志里留前 8 位够排查了
    detail: { openIdPrefix: message.fromUser.slice(0, 8), unionId: Boolean(unionId), userId: result.userId },
  }).catch(() => {});

  return xmlResponse(
    textReplyXml(
      message.fromUser,
      message.toUser ?? "",
      "登录确认成功。请回到网页，页面会自动完成登录。\n如果没反应，点一下网页上的「我已完成」。",
    ),
  );
}

function xmlResponse(xml: string): Response {
  return new Response(xml, { status: 200, headers: { "content-type": "application/xml; charset=utf-8" } });
}
