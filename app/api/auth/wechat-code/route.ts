import { NextResponse } from "next/server";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { enforceRateLimit, RULES } from "@/lib/server/rate-limit";
import { issueLoginCode, LoginCodeError } from "@/lib/server/wechat-code-login";

/**
 * 发起公众号验证码登录：返回一个 6 位码给网页展示。
 *
 * 为什么不需要登录态：这正是登录入口本身。
 * 防滥用靠两层 —— 这里按 IP 限流，`issueLoginCode` 内部再按 IP 做每小时配额
 * （两层都要：前者挡瞬时爆破，后者挡慢速刷表）。
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "unknown";
    await enforceRateLimit("signin", `wechat-code:${ip}`, RULES.signin);
    const issued = await issueLoginCode(ip);
    return NextResponse.json({ code: issued.code, expiresAt: issued.expiresAt });
  } catch (error) {
    if (error instanceof LoginCodeError) return jsonError(error.status, error.message);
    return handleRouteError(error);
  }
}
