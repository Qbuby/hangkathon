/**
 * 公众号验证码登录的业务逻辑（不碰 HTTP，便于单测）。
 *
 * 完整链路：
 *   1. 网页调用 `issueLoginCode()` → 生成 6 位码，10 分钟有效
 *   2. 用户把这 6 位数发给公众号
 *   3. 公众号回调调用 `bindCodeToOpenId()` → 记下 openid / unionid
 *   4. 网页轮询 `pollLoginCode()` → 看到 bound 就换登录态并置 consumed
 *
 * ── 为什么是"码"而不是扫码 ──────────────────────────────────────────────
 * 本账号是订阅号：微信不开放带参二维码（仅认证服务号）与网页授权（仅服务号）。
 * 但订阅号能**收消息**，所以把方向反过来 —— 让用户把码发过去。
 * 对用户来说只多一步"复制 6 位数并发给公众号"，但没有多装任何东西。
 */

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { resolveWechatUser } from "./wechat-identity";

/** 验证码有效期。够用户切到微信发一条消息，又不至于让泄露的码长期可用。 */
const CODE_TTL_MS = 10 * 60 * 1000;

/** 同一 IP 每小时最多发起的次数 —— 防止有人刷爆表。 */
export const ISSUE_LIMIT_PER_HOUR = 20;

/** 纯函数（生成码、规范化输入）见 wechat-code-pure.ts，这里 re-export 保持调用方不变。 */
export { generateLoginCode, normalizeSubmittedCode } from "./wechat-code-pure";
import { generateLoginCode } from "./wechat-code-pure";

export type IssuedCode = { code: string; expiresAt: string };

/**
 * 生成一条待绑定记录。
 *
 * 顺手清掉过期记录：这张表只服务于"正在登录的人"，历史数据没有价值，
 * 留着只会让 code 唯一索引越来越拥挤、碰撞重试次数变多。
 */
export async function issueLoginCode(ip: string | null): Promise<IssuedCode> {
  const db = getDb();
  const now = new Date();

  // 清过期：不阻塞主流程（失败也只是多几条垃圾行）
  await db
    .delete(schema.wechatLoginCodes)
    .where(lt(schema.wechatLoginCodes.expiresAt, now))
    .catch(() => {});

  // 限流：同一 IP 每小时上限
  if (ip) {
    const since = new Date(now.getTime() - 60 * 60 * 1000);
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.wechatLoginCodes)
      .where(and(eq(schema.wechatLoginCodes.ip, ip), gte(schema.wechatLoginCodes.createdAt, since)));
    if (Number(row?.count ?? 0) >= ISSUE_LIMIT_PER_HOUR) {
      throw new LoginCodeError(429, "发起登录太频繁，请稍后再试");
    }
  }

  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  // 唯一索引冲突时重试：100 万空间 + 10 分钟窗口，冲突极罕见，但重试比报错好
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateLoginCode();
    try {
      await db.insert(schema.wechatLoginCodes).values({ code, ip, expiresAt, status: "pending" });
      return { code, expiresAt: expiresAt.toISOString() };
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      if (!message.includes("wechat_login_codes_code_unique")) throw error;
    }
  }
  throw new LoginCodeError(500, "生成验证码失败，请重试");
}

export class LoginCodeError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "LoginCodeError";
  }
}

export type BindResult =
  | {
      ok: true;
      userId: string;
      alreadyBound: boolean;
      /** 本次绑定是否**新建**了站内用户（审计里区分"注册"与"登录"）。 */
      created?: boolean;
    }
  | { ok: false; reason: "not_found" | "expired" | "already_used" };

/**
 * 用户在公众号里发来 6 位码 → 把 openid 绑到这条记录上，并解析出站内用户。
 *
 * 幂等：同一个人发两次同一个码，第二次返回 alreadyBound（不报错，也不换用户）。
 * 这很重要 —— 微信在没收到响应时会**重投**，而重投不该导致任何状态变化。
 */
export async function bindCodeToOpenId(input: {
  code: string;
  openId: string;
  unionId: string | null;
}): Promise<BindResult> {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .select()
    .from(schema.wechatLoginCodes)
    .where(eq(schema.wechatLoginCodes.code, input.code))
    .limit(1);

  if (!row) return { ok: false, reason: "not_found" };
  if (row.expiresAt.getTime() < now.getTime()) return { ok: false, reason: "expired" };

  // 已经绑过：幂等返回。注意要把"别人抢先绑了同一个码"也挡住 ——
  // 否则后发的人会顶掉先发的人，变成抢登录。
  if (row.status !== "pending") {
    if (row.openId === input.openId) {
      return row.userId ? { ok: true, userId: row.userId, alreadyBound: true } : { ok: false, reason: "already_used" };
    }
    return { ok: false, reason: "already_used" };
  }

  // 身份解析统一走 wechat-identity：先按 unionid 认人（跨应用合并），再按占位邮箱，
  // 最后新建。返回值带 created，供上层记"首次登录即注册"的审计。
  const resolved = await resolveWechatUser({ openId: input.openId, unionId: input.unionId });

  await db
    .update(schema.wechatLoginCodes)
    .set({ status: "bound", openId: input.openId, unionId: input.unionId, userId: resolved.id })
    .where(and(eq(schema.wechatLoginCodes.code, input.code), eq(schema.wechatLoginCodes.status, "pending")));

  return { ok: true, userId: resolved.id, alreadyBound: false, created: resolved.created };
}

export type PollResult =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "ready"; userId: string; openId: string };

/**
 * 前端轮询：是否已经绑好、可以换登录态了。
 *
 * **不在这里消费** —— 真正的"取走"发生在 `/api/auth/wechat-code/consume`，
 * 那里会签发 cookie 并置 consumed。分开是为了让轮询可以被高频调用而不产生副作用。
 */
export async function pollLoginCode(code: string): Promise<PollResult> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(schema.wechatLoginCodes)
    .where(eq(schema.wechatLoginCodes.code, code))
    .limit(1);

  if (!row) return { status: "expired" };
  if (row.expiresAt.getTime() < Date.now()) return { status: "expired" };
  if (row.status === "bound" && row.userId && row.openId) {
    return { status: "ready", userId: row.userId, openId: row.openId };
  }
  if (row.status === "consumed") return { status: "expired" };
  return { status: "pending" };
}

/**
 * 取走登录态：原子地把 bound → consumed，并返回 userId。
 *
 * 用 `WHERE status = 'bound'` 的 UPDATE ... RETURNING 做**原子消费** ——
 * 两个并发请求只有一个能拿到行，另一个拿到空。这样即使有人拿着同一个码
 * 同时打两次，也只会换出一份登录态。
 */
export async function consumeLoginCode(code: string): Promise<{ userId: string; openId: string } | null> {
  const db = getDb();
  const now = new Date();
  const [row] = await db
    .update(schema.wechatLoginCodes)
    .set({ status: "consumed", consumedAt: now })
    .where(
      and(
        eq(schema.wechatLoginCodes.code, code),
        eq(schema.wechatLoginCodes.status, "bound"),
        gte(schema.wechatLoginCodes.expiresAt, now),
        sql`${schema.wechatLoginCodes.userId} is not null`,
      ),
    )
    .returning({
      userId: schema.wechatLoginCodes.userId,
      openId: schema.wechatLoginCodes.openId,
    });
  if (!row?.userId || !row.openId) return null;
  return { userId: row.userId, openId: row.openId };
}
