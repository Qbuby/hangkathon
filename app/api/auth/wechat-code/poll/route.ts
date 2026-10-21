import { NextResponse } from "next/server";
import { encode } from "@auth/core/jwt";
import { databaseRequired, jsonError } from "@/lib/server/http";
import { consumeLoginCode, pollLoginCode } from "@/lib/server/wechat-code-login";
import { getWechatSessionIdentity } from "@/lib/server/wechat-identity";
import { enforceRateLimit, RULES } from "@/lib/server/rate-limit";

/**
 * 公众号验证码登录 —— 轮询与换票。
 *
 * 两条动作合在一个文件里（用 query 区分），因为它们共享同一套限流与错误处理：
 *   GET  ?code=959271            → 只查状态（高频、无副作用）
 *   POST ?code=959271            → 原子消费并**签发会话 cookie**（一次性）
 *
 * ── 为什么要在服务端签 cookie ────────────────────────────────────────────
 * 本站用的是 Auth.js 的 JWT 策略，会话就是一个加密的 cookie。
 * 公众号验证码不是 Auth.js 的 provider（它没有 OAuth 回调），所以没有
 * `signIn()` 可用 —— 这里直接用 `@auth/core/jwt` 的 `encode()` 生成同样格式的
 * token，再由本路由 Set-Cookie。**必须与 Auth.js 用同一套参数**，否则
 * `auth()` 读不出来（表现为"登录成功但立刻又是未登录"）。
 *
 * 三个参数必须对齐（这几项写错都会静默失败）：
 *   · salt   —— https 下是 `__Secure-authjs.session-token`，http 下是 `authjs.session-token`
 *   · secret —— AUTH_SECRET
 *   · cookie 名与 salt 一致，且 https 要带 `__Secure-` 前缀（否则浏览器拒绝写入）
 * 另外 encode() 会**用 now()+maxAge 覆盖 token 里的 exp**，所以过期时间靠 maxAge 传。
 */
export const dynamic = "force-dynamic";

/** 与 auth.ts 里 `session: { maxAge: 7 * 24 * 60 * 60 }` 保持一致。 */
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

function isHttps(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return proto === "https";
}

export async function GET(request: Request) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!/^\d{6}$/.test(code)) return jsonError(400, "验证码格式不正确");
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  await enforceRateLimit("read", `wechat-poll:${ip}`, RULES.read).catch(() => {});
  const result = await pollLoginCode(code);
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!/^\d{6}$/.test(code)) return jsonError(400, "验证码格式不正确");

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  await enforceRateLimit("signin", `wechat-consume:${ip}`, RULES.signin);

  const consumed = await consumeLoginCode(code);
  if (!consumed) return jsonError(409, "验证码还没完成确认，或者已经用过了");

  const secret = process.env.AUTH_SECRET;
  if (!secret) return jsonError(503, "服务端未配置 AUTH_SECRET");

  /**
   * 会话里的 `email` 必须是**命中那一行 users 的真实 email**，不能再用公众号 openid 现拼。
   *
   * 这是本次修 unionid 合并时踩到的关键点：当手机登录按 unionid 认到电脑端扫码建的
   * 老账号时，那行的 email 是**网站应用**的 `<openid>@wechat.user`。若这里仍用公众号
   * openid 拼 email，Auth.js 的 `ensureUser()` 会按 email upsert —— 直接又造出一行新用户，
   * 合并白做。同理 `name`/`image` 也必须取库里的，否则手机端会话永远拿不到昵称
   * （微信侧 2021-12-27 起不再返回昵称，昵称只存在于扫码时写下的那一行）。
   */
  const identity = await getWechatSessionIdentity(consumed.userId);
  if (!identity) return jsonError(409, "账号已不存在，请重新登录");

  const secure = isHttps(request);
  const cookieName = secure ? "__Secure-authjs.session-token" : "authjs.session-token";

  const token = await encode({
    token: { name: identity.name, email: identity.email, sub: identity.id, picture: identity.image },
    secret,
    salt: cookieName,
    maxAge: SESSION_MAX_AGE,
  });

  const response = NextResponse.json({ ok: true, email: identity.email, name: identity.name });
  response.cookies.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
