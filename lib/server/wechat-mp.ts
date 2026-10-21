/**
 * 微信公众号（订阅号）服务端对接。
 *
 * 这里只做两件事：验证微信推来的消息**确实来自微信**，以及从消息里取出
 * (openid, 用户发的文本)。不做网页授权、不生成带参二维码 ——
 * 那两样微信只对服务号开放（实测文档原文：「生成带参数二维码」仅认证服务号；
 * 「网页授权」仅服务号），而本账号是订阅号。
 *
 * ── 为什么必须验签 ─────────────────────────────────────────────────────
 * 这个回调 URL 是公网可访问的，任何人能往里 POST。如果不验签，攻击者只要知道
 * 某个人的 6 位验证码（或者暴力猜，只有 100 万种），就能把**任意 openid**
 * 绑到那条码上，从而冒充别人登录。所以签名校验是这条链路唯一的信任来源。
 *
 * 微信的签名算法与事件订阅那套**不一样**：
 *   1. 把 token、timestamp、nonce 三个值按**字典序**排序
 *   2. 直接拼接成一个字符串（不加密钥）
 *   3. sha1，与大写无关地比对 signature 参数
 * 注意是 **sha1**，不是 sha256 —— 与飞书事件那套（sha256 + Encrypt Key）完全不同，
 * 抄错会让所有真实消息被拒，而症状只是"公众号里发消息没反应"。
 */

import { createHash, createDecipheriv, timingSafeEqual } from "node:crypto";

const MP_API = "https://api.weixin.qq.com/cgi-bin";

/**
 * 校验微信推送签名：sha1(sort([token, timestamp, nonce]).join(""))。
 *
 * 用 timingSafeEqual 比对（长度不等直接返回 false —— 它要求两个 buffer 等长）。
 */
export function verifyWechatSignature(params: {
  signature?: string | null;
  timestamp?: string | null;
  nonce?: string | null;
  token: string;
}): boolean {
  const { signature, timestamp, nonce, token } = params;
  if (!signature || !timestamp || !nonce) return false;
  const expected = createHash("sha1").update([token, timestamp, nonce].sort().join("")).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.toLowerCase(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * 解密「安全模式」推送的 Encrypt 字段（AES-256-CBC）。
 *
 * 公众号后台可以选「明文模式 / 兼容模式 / 安全模式」。安全模式下消息体里只有
 * `<Encrypt>`，签名也不再用上面的算法，而是
 * `sha1(sort([token, timestamp, nonce, encrypt]).join(""))`。
 *
 * 两种模式都支持：明文模式下 AppSecret 都不是必需的，安全模式才需要（作为 AES 密钥）。
 * `msg_signature` 存在就按安全模式处理 —— 这是微信自己的约定。
 */
export function decryptWechatMessage(encodingAesKey: string, encrypted: string): string {
  const key = Buffer.from(`${encodingAesKey}=`, "base64");
  if (key.length !== 32) throw new Error("EncodingAESKey 长度不对（应为 43 字符 base64）");
  const raw = Buffer.from(encrypted, "base64");
  if (raw.length <= 16) throw new Error("Encrypt 字段长度异常");
  const iv = raw.subarray(0, 16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]);
  // 去 PKCS#7 填充
  const pad = plain[plain.length - 1] ?? 0;
  if (pad < 1 || pad > 32) throw new Error("填充字节异常");
  const unpadded = plain.subarray(0, plain.length - pad);
  // 结构：16 字节随机数 + 4 字节网络序长度 + 消息体 + appid
  const msgLen = unpadded.readUInt32BE(16);
  return unpadded.subarray(20, 20 + msgLen).toString("utf8");
}

/** 安全模式下的签名：多带一个 encrypt 参与排序。 */
export function verifyWechatMsgSignature(params: {
  signature?: string | null;
  timestamp?: string | null;
  nonce?: string | null;
  encrypt: string;
  token: string;
}): boolean {
  const { signature, timestamp, nonce, encrypt, token } = params;
  if (!signature || !timestamp || !nonce) return false;
  const expected = createHash("sha1").update([token, timestamp, nonce, encrypt].sort().join("")).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature.toLowerCase(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * 从微信推送的 XML 里取一个标签的值。
 *
 * **不用 XML 解析库**：消息结构极其固定（一层平铺的 `<Tag>value</Tag>`），
 * 而引入一个解析器只为这件事，反而多一处依赖与 XXE 面。这里用非贪婪匹配 +
 * 显式拒绝嵌套；取不到就返回 null，调用方按"不认识的格式"忽略。
 *
 * CDATA 包裹的值也支持（微信的文本消息体就是 CDATA）。
 */
export function xmlTag(xml: string, tag: string): string | null {
  const safeTag = tag.replace(/[^A-Za-z0-9_]/g, "");
  if (!safeTag) return null;
  const match = new RegExp(`<${safeTag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${safeTag}>`).exec(xml);
  if (!match) return null;
  const value = match[1] ?? match[2] ?? "";
  return value.trim();
}

/** 整条消息是不是"用户在公众号里发来的文本"。其他类型（事件、图片…）一律忽略。 */
export type MpTextMessage = {
  fromUser: string;
  toUser: string | null;
  msgType: string;
  content: string;
  createTime: string | null;
  msgId: string | null;
};

export function parseMpMessage(xml: string): MpTextMessage | null {
  const msgType = xmlTag(xml, "MsgType");
  const fromUser = xmlTag(xml, "FromUserName");
  if (!msgType || !fromUser) return null;
  return {
    fromUser,
    toUser: xmlTag(xml, "ToUserName"),
    msgType,
    content: xmlTag(xml, "Content") ?? "",
    createTime: xmlTag(xml, "CreateTime"),
    msgId: xmlTag(xml, "MsgId"),
  };
}

/**
 * 被动回复一条文本消息。
 *
 * 微信要求 5 秒内响应，否则会重试三次并把该消息丢弃。所以我们**同步**回这条 XML
 * （而不是先 200 再异步推送）—— 用户发完码立刻看到反馈，体验才对；
 * 而绑定动作本身只是一次 UPDATE，毫秒级。
 *
 * 注意 `FromUserName` / `ToUserName` 是**反过来**的：回复的收件人是原消息的发件人。
 */
export function textReplyXml(toUser: string, fromUser: string, content: string): string {
  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<xml><ToUserName><![CDATA[${toUser}]]></ToUserName><FromUserName><![CDATA[${fromUser}]]></FromUserName><CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${escape(content)}]]></Content></xml>`;
}

/* ────────────────────────── 公众号 API ────────────────────────── */

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * 取公众号 access_token —— **必须用 stable_token 接口**。
 *
 * 踩坑记录（2026-10-21 线上）：原先调的是老的 `/cgi-bin/token`，日志里持续报
 *   40001 invalid credential, access_token is invalid or not latest,
 *   could get access_token by getStableAccessToken
 * 后果不是「偶尔失败」，而是 **unionid 一直拿不到** —— 于是手机登录永远认不出
 * 电脑端的老账号，昵称也就一直是空的。表现完全静默：登录成功、只是没有名字。
 *
 * 两个接口的差别：
 *   · 老接口每次调用**签发新 token 并让旧的失效**（多实例/多进程互相踢）；
 *   · stable_token 是幂等的，force_refresh=false 时返回同一个 token，
 *     多实例共享也不会互相吊销。
 * 我们没有任何理由用老接口。
 */
async function requestMpToken(env: NodeJS.ProcessEnv, forceRefresh: boolean): Promise<string | null> {
  const appId = env.WECHAT_MP_ID;
  const secret = env.WECHAT_MP_SECRET;
  if (!appId || !secret) throw new Error("缺少 WECHAT_MP_ID / WECHAT_MP_SECRET");
  const res = await fetch(`${MP_API}/stable_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credential", appid: appId, secret, force_refresh: forceRefresh }),
    signal: AbortSignal.timeout(8000),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string };
  if (!data.access_token) {
    console.error(`[wechat-mp] 取 token 失败 errcode=${data.errcode} errmsg=${data.errmsg}`);
    return null;
  }
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + Math.max((data.expires_in ?? 7200) - 300, 60) * 1000,
  };
  return cachedToken.token;
}

async function getMpToken(env: NodeJS.ProcessEnv = process.env, forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const token = await requestMpToken(env, forceRefresh);
  if (!token) throw new Error("取公众号 access_token 失败");
  return token;
}

/**
 * 用 openid 换用户基本信息（含 **unionid**）。
 *
 * unionid 是关键：公众号（订阅号）和网站应用（扫码登录）绑在同一个开放平台账号下，
 * 同一个微信号在两个应用里的 openid 不同，但 **unionid 相同**。
 * 用它就能把「手机验证码登录」和「电脑扫码登录」认成同一个人。
 *
 * 注意：2021-12-27 起微信不再返回头像与昵称，只保证 openid / unionid 可用。
 * 所以这里不要依赖 nickname 做任何事 —— **昵称只存在于扫码登录时写下的 users 行里**，
 * 手机登录要显示昵称，靠的是按 unionid 命中那一行（见 wechat-identity.ts）。
 */
export async function getMpUserInfo(
  openId: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ openId: string; unionId: string | null; subscribed: boolean } | null> {
  const request = async (forceRefresh: boolean) => {
    const token = await getMpToken(env, forceRefresh);
    const res = await fetchImpl(
      `${MP_API}/user/info?access_token=${encodeURIComponent(token)}&openid=${encodeURIComponent(openId)}&lang=zh_CN`,
      { signal: AbortSignal.timeout(8000) },
    );
    return (await res.json()) as {
      openid?: string;
      unionid?: string;
      subscribe?: number;
      errcode?: number;
      errmsg?: string;
    };
  };

  try {
    let data = await request(false);
    // 40001/40014/42001：token 失效/过期。多实例或后台手动刷新都会遇到，
    // 强刷一次再试；只重试一次，避免把失效配置变成无限循环。
    if ([40001, 40014, 42001].includes(data.errcode ?? 0)) {
      console.warn(`[wechat-mp] token 失效（errcode=${data.errcode}），强刷后重试一次`);
      data = await request(true);
    }
    if (!data.openid) {
      console.error(`[wechat-mp] user/info 失败 errcode=${data.errcode} errmsg=${data.errmsg}`);
      return null;
    }
    return { openId: data.openid, unionId: data.unionid?.trim() || null, subscribed: data.subscribe === 1 };
  } catch (error) {
    // unionid 拿不到不算致命：老账号合并会退化成"按公众号 openid 建新号"，
    // 用户仍然能登录，只是不会和电脑端扫码的账号合并。所以这里只记日志。
    console.error("[wechat-mp] user/info 异常", error);
    return null;
  }
}
