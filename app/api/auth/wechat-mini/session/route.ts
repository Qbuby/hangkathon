import { NextResponse } from "next/server";
import { databaseRequired, handleRouteError } from "@/lib/server/http";
import { currentUser } from "@/lib/server/users";

/**
 * 小程序冷启动时的身份探针。
 *
 * 为什么不直接用 /api/me：那个接口会顺带查报名与作品条数（三张表），
 * 而冷启动只需要知道"这个 token 还有效吗、我是谁"。同理也不用 /api/session ——
 * 它在 `authConfigured` 为 false 时会吞掉所有会话（返回 user:null），
 * 对只带 Bearer 的客户端不适用。
 *
 * 匿名返回 200 + user:null（与 /api/agent/session、/api/admin/session 同一约定），
 * 这样小程序可以无条件调用而不用区分 401。
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const user = await currentUser();
    return NextResponse.json({
      user: user ? { id: user.id, email: user.email, name: user.name, role: user.role } : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
