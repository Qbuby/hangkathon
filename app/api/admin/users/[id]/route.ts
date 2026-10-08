import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/server/audit";
import { AdminActionError, deleteUser, setUserRole } from "@/lib/server/admin";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/users";

export const dynamic = "force-dynamic";

/** 管理员改用户角色（不能改自己）/ 删除用户（不能删自己；其发起的活动级联删除）。 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { role?: string } | null;
    if (!body?.role) return jsonError(400, "缺少 role");
    await setUserRole(admin.id, id, body.role);
    // 权限分配与变更必须留痕（检查表 7.2 / 7.3c）。
    await writeAudit(
      {
        category: "admin",
        action: "admin.user.role",
        user: admin,
        targetType: "user",
        targetId: id,
        detail: { role: body.role },
      },
      request,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminActionError) return jsonError(error.status, error.message);
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    await deleteUser(admin.id, id);
    await writeAudit(
      {
        category: "admin",
        action: "admin.user.delete",
        user: admin,
        targetType: "user",
        targetId: id,
        detail: { deletedUserId: id },
      },
      request,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminActionError) return jsonError(error.status, error.message);
    return handleRouteError(error);
  }
}
