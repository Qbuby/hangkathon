import { NextResponse } from "next/server";
import { hasDatabase } from "@/db";
import { BlacklistedError } from "./blacklist";
import { ForbiddenError, UnauthorizedError } from "./users";

/** 路由层的统一出口：无数据库 503、未登录 401、无权限 403、黑名单 403、限流 429、其余 500。 */

export class RateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("请求过于频繁，请稍后再试");
    this.name = "RateLimitError";
  }
}

export function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

/** 没有 DATABASE_URL 的部署（例如 Vercel 那份）不应该调用这些接口。 */
export function databaseRequired() {
  return hasDatabase() ? null : jsonError(503, "这个部署没有配置数据库");
}

export function handleRouteError(error: unknown) {
  if (error instanceof UnauthorizedError) return jsonError(401, "请先登录");
  // ForbiddenError 允许自带消息（如发布权门禁的"只有代理商可以发布活动"），带不上来的才用默认文案
  if (error instanceof ForbiddenError) return jsonError(403, error.message);
  if (error instanceof BlacklistedError) {
    return jsonError(403, `账号已被列入黑名单：${error.reason}`);
  }
  if (error instanceof RateLimitError) {
    return NextResponse.json(
      { error: error.message },
      { status: 429, headers: { "retry-after": String(error.retryAfterSeconds) } },
    );
  }
  console.error("[api]", error);
  return jsonError(500, "服务端错误");
}