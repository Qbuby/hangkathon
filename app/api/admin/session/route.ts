import { NextResponse } from "next/server";
import { databaseRequired, handleRouteError } from "@/lib/server/http";
import { currentUser, isAdminUser } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 管理端口守卫：客户端据此决定渲染登录引导、无权限提示还是面板。 */
export async function GET() {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const user = await currentUser();
    return NextResponse.json({
      user: user ? { email: user.email, name: user.name } : null,
      admin: await isAdminUser(user),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
