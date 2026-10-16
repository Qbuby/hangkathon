/**
 * 飞书开放平台客户端（应用进程内用）。
 *
 * 与 `deploy/feishu-alert.mjs` 的关系：那一份在**宿主机**上跑（服务器没有 node，
 * 由 node 容器代跑），只做单向告警；这一份在**应用容器**里跑，做双向 —— 收事件、发回复、
 * 回卡片。两份共用同一组 FEISHU_APP_ID / APP_SECRET 凭据，但鉴权模型不同：
 * 群自定义机器人 webhook（`FEISHU_WEBHOOK_URL`，只能发）vs 自建应用
 * （App ID/Secret 换 tenant_access_token，能收能发）。**这两个是不同的机器人身份**，
 * 群里会显示成两个不同的机器人，别混淆。
 *
 * ── 为什么必须做加密与验签 ──────────────────────────────────────────────
 * `/api/feishu/events` 是一个**公网可访问**的 POST 端点。任何人都能往里打请求。
 * 如果不验签，等于把管理端口开到互联网上 —— 攻击者可以伪造一条"通过代理商申请"
 * 的事件。所以下面三件事一个都不能少：
 *   1. 解密（AES-256-CBC，密钥 = sha256(Encrypt Key)）
 *   2. 验签（sha256(timestamp + nonce + Encrypt Key + body)，与 X-Lark-Signature 比对）
 *   3. 时间窗校验（timestamp 与服务器时间差超过 5 分钟即拒 —— 否则抓包重放无限期有效）
 * 注意 Encrypt Key 与 Verification Token 是**两个不同的东西**：前者用于加解密与验签，
 * 后者只是配置里的一个串、不参与任何密码学。两者都要在飞书后台取。
 */

import { createHash, createDecipheriv, timingSafeEqual } from "node:crypto";

const API_BASE = "https://open.feishu.cn/open-apis";
/** 签名时间窗：飞书官方建议 ±1 小时是"不重放"的上限，这里收紧到 5 分钟。 */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/* ────────────────────────── 事件解密与验签 ────────────────────────── */

export type FeishuHeaders = {
  timestamp?: string | null;
  nonce?: string | null;
  signature?: string | null;
};

function sha256Hex(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * AES-256-CBC 解密。飞书把明文 JSON 用 Encrypt Key 加密后放进 body 的 `encrypt` 字段。
 * 密钥 = sha256(encryptKey) 的**原始 32 字节**（不是 hex 串），IV = 密文前 16 字节。
 */
export function decryptFeishuPayload(encryptKey: string, encrypted: string): string {
  const key = createHash("sha256").update(encryptKey).digest();
  const raw = Buffer.from(encrypted, "base64");
  if (raw.length <= 16) throw new Error("encrypt 字段长度异常");
  const iv = raw.subarray(0, 16);
  const body = raw.subarray(16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

/**
 * 把飞书的时间戳头解析成毫秒。**两种完全不同的格式**（2026-10-16 实测）：
 *
 *   - 事件回调（im.message.receive_v1）：`"1792132835"` —— 十位 Unix 秒
 *   - 卡片回调（card.action.trigger）：`"2026-10-16 14:41:47.224834685 +0800 CST m=+328043.243701041"`
 *     —— 带纳秒与单调时钟偏移的完整日期串
 *
 * 我一直假设是第一种，于是卡片回调全部被判「时间戳不是数字」→ 401 → 飞书那边
 * 看到的是 200671。**签名算法本身是对的**（sha256，64 位十六进制，两边一致），
 * 错的只是这一项的格式 —— 而这类"同一厂商、同一个头、两种格式"的差异，
 * 不打日志看真实值是无论如何猜不出来的。
 *
 * 第二种格式按**本地时区**解释（尾部带 `+0800`），所以这里交给 Date 解析，
 * 而不是自己拆字段 —— 自己拆要处理时区偏移，Date 已经做对了。
 */
export function parseFeishuTimestamp(raw: string): number | null {
  const text = raw.trim();
  if (/^\d{10,13}$/.test(text)) {
    // 十位=秒、十三位=毫秒
    const n = Number(text);
    return text.length <= 10 ? n * 1000 : n;
  }
  /**
   * 长格式：`2026-10-16 14:41:47.224834685 +0800 CST m=+328043.243701041`
   *
   * **不能直接丢给 Date.parse** —— 实测 V8 会把结尾的 `CST` 识别成
   * "美国中部时区（UTC-6）"，于是 `+0800` 被整个忽略，结果偏了 14 小时
   * （14:41+0800 应是 06:41Z，却解析成 20:41Z）。静默算错 14 小时，
   * 比解析失败危险得多：失败会报错，算错只会让时间窗判断失真。
   *
   * 所以自己把字段拆出来、拼成标准 ISO 8601（`...T14:41:47.224+08:00`）再解析 ——
   * 数字偏移才是权威，时区缩写一律丢弃。
   */
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?\s*([+-])(\d{2}):?(\d{2})/.exec(text);
  if (m) {
    const [, y, mo, d, h, mi, sec, frac, sign, offH, offM] = m;
    const ms = (frac ?? "").padEnd(3, "0").slice(0, 3); // 纳秒截断到毫秒
    const parsed = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${sec}.${ms}${sign}${offH}:${offM}`);
    if (Number.isFinite(parsed)) return parsed;
  }
  // 没有数字偏移的退化形态：剥掉时区缩写与单调时钟尾巴再交给 Date
  const cleaned = text
    .split(" m=")[0]
    .replace(/\s+[A-Za-z]{2,5}$/, "")
    .replace(/(\.\d{3})\d+/, "$1");
  const fallback = Date.parse(cleaned);
  return Number.isFinite(fallback) ? fallback : null;
}

/**
 * 校验请求签名。**任何一步失败都返回 false**，调用方一律当"未通过"处理。
 *
 * 用 timingSafeEqual 比较：普通字符串比较会按字节提前返回，长度或前缀差异能被计时侧信道量出来。
 * 这里的威胁模型是"管理端口公网可打"，值得多这一步。
 */
export function verifyFeishuSignature(
  headers: FeishuHeaders,
  rawBody: string,
  encryptKey: string,
  nowMs: number = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  const timestamp = headers.timestamp ?? "";
  const nonce = headers.nonce ?? "";
  const signature = headers.signature ?? "";
  if (!timestamp || !nonce || !signature) return { ok: false, reason: "缺少验签请求头" };

  const tsMs = parseFeishuTimestamp(timestamp);
  if (tsMs === null) return { ok: false, reason: `时间戳无法解析（实际值：${timestamp.slice(0, 60)}）` };
  // 防重放的第一道：时间窗。外网到服务器的延迟通常 < 1s，5 分钟足够宽松。
  if (Math.abs(nowMs - tsMs) > MAX_CLOCK_SKEW_MS) return { ok: false, reason: "时间戳超出 5 分钟窗口" };

  const expected = sha256Hex(`${timestamp}${nonce}${encryptKey}${rawBody}`);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "签名不匹配" };
  return { ok: true };
}

/**
 * **只解密、不验签**，返回明文 JSON —— 唯一用途是应答 `url_verification` 握手。
 *
 * 为什么需要它（2026-10-15 实测踩到）：
 *   开启加密策略后，飞书发来的地址校验请求是**加密但不带签名头**的
 *   （实测 `ua=Go-http-client/1.1`、body 只有 `{encrypt}`、
 *   `x-lark-request-timestamp/nonce/signature` 三个头全缺）。
 *   而 `parseInbound` 是「先验签后解密」，于是这个请求在解密之前就被挡掉了 ——
 *   报错是"缺少验签请求头"，飞书那边显示成"返回数据不是合法的JSON格式"。
 *
 *   这是个顺序错误：握手是**建立信任的第一步**，它本身不可能用
 *   还没建立起来的信任来证明自己。
 *
 * 放开验签是否安全：这个函数的结果**只用于回显 challenge**，不读库、不落状态、
 * 不返回任何站内数据。它确实是完整解密（需要真实密钥，解不开就是解不开），
 * 不是明文旁路。而真正的事件一律走 parseInbound，那里验签是强制的。
 */
export function peekDecrypted(rawBody: string, encryptKey: string): Record<string, unknown> | null {
  let outer: Record<string, unknown>;
  try {
    outer = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return null;
  }
  // 明文形态：本来就没加密，直接用（此时也不需要密钥）
  if (typeof outer.encrypt !== "string") return outer;
  try {
    return JSON.parse(decryptFeishuPayload(encryptKey, outer.encrypt)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 解析入站请求：验签 → （必要时）解密 → 返回事件 JSON。
 * 验签对象是**原始 body**（飞书签的就是它），所以解密必须发生在验签之后。
 */
export function parseInbound(
  rawBody: string,
  headers: FeishuHeaders,
  encryptKey: string,
  nowMs?: number,
): { ok: true; payload: Record<string, unknown> } | { ok: false; reason: string } {
  const verified = verifyFeishuSignature(headers, rawBody, encryptKey, nowMs);
  if (!verified.ok) return verified;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "body 不是合法 JSON" };
  }
  // 加密模式：外层只有 { encrypt }，真事件在里面
  const encrypted = parsed.encrypt;
  if (typeof encrypted === "string") {
    try {
      const plain = decryptFeishuPayload(encryptKey, encrypted);
      return { ok: true, payload: JSON.parse(plain) as Record<string, unknown> };
    } catch (error) {
      return { ok: false, reason: `解密失败：${String(error instanceof Error ? error.message : error)}` };
    }
  }
  return { ok: true, payload: parsed };
}

/* ────────────────────────── 发消息 ────────────────────────── */

let cachedToken: { token: string; expiresAt: number } | null = null;

/** tenant_access_token 有效期 2 小时，缓存到过期前 5 分钟，避免边界抖动导致批量失败。 */
async function getTenantToken(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.token;
  const appId = env.FEISHU_APP_ID;
  const appSecret = env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) throw new Error("缺少 FEISHU_APP_ID / FEISHU_APP_SECRET");
  const response = await fetch(`${API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(8000),
  });
  const data = (await response.json()) as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
  if (data.code !== 0 || !data.tenant_access_token) throw new Error(`取 token 失败 code=${data.code} msg=${data.msg}`);
  cachedToken = { token: data.tenant_access_token, expiresAt: now + Math.max((data.expire ?? 7200) - 300, 60) * 1000 };
  return cachedToken.token;
}

async function callMessageApi(path: string, body: unknown, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const token = await getTenantToken(env);
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const data = (await response.json().catch(() => null)) as { code?: number; msg?: string } | null;
  if (!response.ok || !data || data.code !== 0) {
    throw new Error(`飞书接口失败 ${response.status} code=${data?.code} msg=${data?.msg ?? ""}`);
  }
}

/** 在群里发一条纯文本消息。 */
export async function sendChatText(chatId: string, text: string, env?: NodeJS.ProcessEnv): Promise<void> {
  await callMessageApi(
    "/im/v1/messages?receive_id_type=chat_id",
    { receive_id: chatId, msg_type: "text", content: JSON.stringify({ text }) },
    env,
  );
}

/** 在群里发一张交互卡片（带按钮的那种）。 */
export async function sendChatCard(chatId: string, card: unknown, env?: NodeJS.ProcessEnv): Promise<void> {
  await callMessageApi(
    "/im/v1/messages?receive_id_type=chat_id",
    { receive_id: chatId, msg_type: "interactive", content: JSON.stringify(card) },
    env,
  );
}

/**
 * 回到触发命令的那条消息下面。
 *
 * 用 reply 而不是新发一条：群里多人时，回复挂在原消息下才不会把聊天刷成一片独立消息，
 * 也让"谁对哪句话下的指令"一眼可查。
 */
export async function replyToMessage(messageId: string, text: string, env?: NodeJS.ProcessEnv): Promise<void> {
  await callMessageApi(
    "/im/v1/messages/om_reply",
    { message_id: messageId, msg_type: "text", content: JSON.stringify({ text }) },
    env,
  );
}

/**
 * 飞书交互卡片。
 *
 * 刻意用宽松类型而不是逐字段建模：卡片的 schema 由飞书定义且会演进，
 * 我们只用到 schema/header/body/elements 这几处，**建模越细，升级时越容易被自己的类型卡住**。
 */
/**
 * 卡片结构说明（这段是 2026-10-15 拿真实接口试出来的，别凭直觉改）：
 *
 * - **必须写 `"schema": "2.0"`**。不写时飞书按 1.0 解析，而 1.0 的元素在**顶层**
 *   `elements`，于是 2.0 写法里的 `body.elements` 被整个忽略 ——
 *   表现是「标题能渲染、正文一片空白」，且接口返回 code=0、**没有任何报错**。
 * - **2.0 不支持 `note` 与 `action` 两个标签**。实测报错原文：
 *   `cards of schema V2 no longer support this capability ... unsupported tag note`。
 *   所以小字说明改用 `markdown`，按钮改成**直接作为 `body.elements` 的元素**
 *   （而不是 1.0 那种 `{tag:"action", actions:[...]}` 的容器）。
 *   （1.0 的写法也仍然可用，实测 code=0；我们统一走 2.0，别混着写。）
 */
export type FeishuCard = Record<string, unknown>;

const CARD_FOOTNOTE = "来自杭客松管理端 · 命令：@杭客松 帮助";

/** 一张纯文本卡片（无按钮），用于列表类结果。 */
export function textCard(title: string, lines: string[], template = "blue"): FeishuCard {
  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: title }, template },
    body: {
      elements: [
        { tag: "markdown", content: lines.join("\n") },
        { tag: "hr" },
        { tag: "markdown", content: `<font color='grey'>${CARD_FOOTNOTE}</font>` },
      ],
    },
  };
}

/**
 * 确认卡片：所有**写操作**都必须先过这一张，不允许「一句话直接执行」。
 *
 * 理由是这套东西的危险不在于鉴权（鉴权做对了），而在于**误操作**与**可被诱导**：
 * 群里有人贴了一段看起来像命令的文本、或者手滑多点一次，都不该立刻生效。
 * 卡片回调会再校验一次操作者身份，并且回调体由飞书签名，攻击者无法凭空构造。
 */
export function confirmCard(title: string, body: string, actionValue: Record<string, string>, danger = false): FeishuCard {
  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: title }, template: danger ? "red" : "orange" },
    body: {
      elements: [
        { tag: "markdown", content: body },
        // 2.0 里按钮直接当元素用；`action` 容器标签在 2.0 已不支持
        { tag: "button", text: { tag: "plain_text", content: danger ? "确认执行（不可撤销）" : "确认执行" }, type: danger ? "danger" : "primary", value: actionValue },
        { tag: "button", text: { tag: "plain_text", content: "取消" }, type: "default", value: { cancel: "1" } },
        { tag: "markdown", content: "<font color='grey'>这张卡片只对管理员有效；确认后同样写入审计日志。</font>" },
      ],
    },
  };
}


/** 卡片回调后把原卡片替换成终态，避免按钮被重复点击。 */
export function resultCard(title: string, lines: string[], ok: boolean): FeishuCard {
  return textCard(title, lines, ok ? "green" : "red");
}

/**
 * 事件去重（防飞书重投）。
 *
 * 飞书在没收到 2xx 时会**重复投递**同一条事件（同一 header.event_id），最多若干次。
 * 对「通过代理商申请」这种命令，重投一次就是执行两次。所以必须按 event_id 幂等。
 *
 * 进程内 LRU + 时间窗即可：应用是单容器单进程，重启后重放窗口自然清零，
 * 而飞书的重投间隔是秒级，跨重启的重复概率与影响都可忽略。
 */
const seenEvents = new Map<string, number>();
const SEEN_TTL_MS = 10 * 60 * 1000;
const SEEN_MAX = 500;

/** 返回 true 表示这是第一次见到该 event_id（应当处理）；false 表示是重投，应当忽略。 */
export function markEventOnce(eventId: string, nowMs: number = Date.now()): boolean {
  const now = nowMs;
  for (const [key, at] of seenEvents) {
    if (now - at > SEEN_TTL_MS) seenEvents.delete(key);
  }
  if (seenEvents.has(eventId)) return false;
  if (seenEvents.size >= SEEN_MAX) {
    // 超量时丢最早的一条，保证 Map 不无界增长（不保序是刻意的：去重窗口只有 10 分钟）
    const oldest = seenEvents.keys().next();
    if (!oldest.done) seenEvents.delete(oldest.value);
  }
  seenEvents.set(eventId, now);
  return true;
}
