import { NextResponse } from "next/server";
import { encode } from "@auth/core/jwt";
import { writeAudit } from "@/lib/server/audit";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { enforceRateLimit, RULES } from "@/lib/server/rate-limit";
import { getWechatSessionIdentity, resolveWechatUser } from "@/lib/server/wechat-identity";
import { exchangeMiniProgramCode } from "@/lib/server/wechat-mini";

/**
 * 微信小程序登录：`wx.login()` 的 code → 站内会话。
 *
 * ── 与网页端两条登录路径的关系 ──────────────────────────────────────────
 * 三条通道（网站应用扫码 / 公众号验证码 / 小程序）最终都必须落到
 * **同一行 users** 上，靠的是 unionid 而不是各自的应用内 openid：
 *
 *   扫码    openid=A  unionid=U  ─┐
 *   公众号  openid=B  unionid=U  ─┼→ resolveWechatUser 按 U 查到同一行
 *   小程序  openid=C  unionid=U  ─┘
 *
 * 所以这里**绝不自己 insert users**，一律走 `resolveWechatUser`。
 * 这条约定由 scripts/wechat-mini.test.mjs 守着（历史上两条登录路径各建各的号，
 * 同一个人裂成三行，昵称与报名全丢）。
 *
 * ── 为什么同时返回 Bearer token 和 Set-Cookie ───────────────────────────
 * `wx.request` 不像浏览器那样自动保存并回放 cookie，所以小程序必须显式拿 token、
 * 之后放在 `Authorization: Bearer` 里（`lib/server/users.ts` 的 currentUser 有兜底）。
 * 同时下发 cookie 是为了 web-view 场景复用同一套逻辑，行为与公众号换票一致。
 */
export const dynamic = "force-dynamic";

/** 与 auth.ts 的 session.maxAge 保持一致。 */
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

function isHttps(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return proto === "https";
}

export async function POST(request: Request) {
  const blocked = databaseRequired();
  if (blocked) return blocked;

  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "unknown";
    // 与其它登录入口同一档：10 次/分钟/IP。小程序只在冷启动与 401 重登时调，
    // 正常用户一分钟内不会超过几次。
    await enforceRateLimit("signin", `wechat-mini:${ip}`, RULES.signin);

    const body = (await request.json().catch(() => null)) as { code?: string } | null;
    const code = body?.code?.trim() ?? "";
    if (!code) return jsonError(400, "缺少 code（小程序需先调用 wx.login）");

    const secret = process.env.AUTH_SECRET;
    if (!secret) return jsonError(503, "服务端未配置 AUTH_SECRET");

    let identity: { openId: string; unionId: string | null } | null;
    try {
      identity = await exchangeMiniProgramCode(code);
    } catch (error) {
      // 配置缺失：写清楚缺哪两项，而不是笼统 500
      console.error("[wechat-mini] 换取 openid 失败", error);
      return jsonError(503, "服务端未配置微信小程序凭据（WECHAT_MINI_ID / WECHAT_MINI_SECRET）");
    }
    if (!identity) return jsonError(401, "微信登录失败，请重试");

    // 唯一建号入口：按 unionid 认人、按占位邮箱兜底、必要时合并历史裂号。
    const resolved = await resolveWechatUser({ openId: identity.openId, unionId: identity.unionId });

    // 会话身份必须来自**命中那一行**的 email：合并后旧的占位邮箱已经不存在，
    // 现拼 `${openid}@wechat.user` 会让 ensureUser 又建一个新号（线上真踩过）。
    const sessionIdentity = await getWechatSessionIdentity(resolved.id);
    if (!sessionIdentity) return jsonError(409, "账号已不存在，请重新登录");

    const secure = isHttps(request);
    const cookieName = secure ? "__Secure-authjs.session-token" : "authjs.session-token";

    const token = await encode({
      token: {
        name: sessionIdentity.name,
        email: sessionIdentity.email,
        sub: sessionIdentity.id,
        picture: sessionIdentity.image,
      },
      secret,
      salt: cookieName,
      maxAge: SESSION_MAX_AGE,
    });

    // 小程序的登录不经过 Auth.js 的 events.signIn，所以这里自己留审计痕迹。
    await writeAudit(
      {
        category: "auth",
        action: "auth.wechat_mini.login",
        user: { id: sessionIdentity.id, email: sessionIdentity.email },
        ip,
        method: "POST",
        path: "/api/auth/wechat-mini",
        targetType: "user",
        targetId: sessionIdentity.id,
        result: "success",
        detail: {
          channel: "微信小程序",
          registered: resolved.created,
          merged: Boolean(resolved.merged),
          // 不记完整 openid；unionid 同样只记"有没有拿到"，不记值
          openIdPrefix: identity.openId.slice(0, 8),
          unionId: Boolean(identity.unionId),
        },
      },
      request,
    ).catch(() => {});

    const response = NextResponse.json({
      token,
      email: sessionIdentity.email,
      name: sessionIdentity.name,
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString(),
    });
    response.cookies.set(cookieName, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure,
      maxAge: SESSION_MAX_AGE,
    });
    return response;
  } catch (error) {
    return handleRouteError(error);
  }
}
