import { NextResponse } from "next/server";
import { hasDatabase } from "@/db";
import { ForbiddenError, UnauthorizedError } from "./users";

/** 路由层的统一出口：无数据库 503、未登录 401、无权限 403、其余 500。 */

export function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

/** 没有 DATABASE_URL 的部署（例如 Vercel 那份）不应该调用这些接口。 */
export function databaseRequired() {
  return hasDatabase() ? null : jsonError(503, "这个部署没有配置数据库");
}

export function handleRouteError(error: unknown) {
  if (error instanceof UnauthorizedError) return jsonError(401, "请先登录");
  if (error instanceof ForbiddenError) return jsonError(403, "无管理员权限");
  console.error("[api]", error);
  return jsonError(500, "服务端错误");
}
