import { NextResponse } from "next/server";
import { getMyAgentApplication } from "@/lib/server/agents";
import { canPublishRole } from "@/lib/server/users";
import { currentUser } from "@/lib/server/users";
import { databaseRequired, handleRouteError } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * 发起活动的身份门禁探针：/create 页面据此决定渲染表单、登录引导还是代理商申请页。
 * 与 /api/admin/session 同构 —— 匿名也返回 200（user=null），不泄漏任何东西；
 * 对抗测试 B 组会断言匿名时 canPublish=false 且无邮箱。
 */
export async function GET() {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const user = await currentUser();
    return NextResponse.json({
      user: user ? { email: user.email, name: user.name } : null,
      role: user?.role ?? null,
      canPublish: canPublishRole(user?.role),
      application: user ? await getMyAgentApplication(user.id) : null,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}