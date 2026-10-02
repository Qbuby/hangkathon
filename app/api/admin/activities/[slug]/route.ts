import { NextResponse } from "next/server";
import { AdminActionError, deleteActivity, setActivityVisibility } from "@/lib/server/admin";
import { databaseRequired, handleRouteError, jsonError } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/users";
import type { Visibility } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** 管理员改活动公开状态 / 删除活动（预置活动拒绝删除）。 */
export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    await requireAdmin();
    const { slug } = await params;
    const body = (await request.json().catch(() => null)) as { visibility?: string } | null;
    const visibility = body?.visibility as Visibility | undefined;
    if (!visibility) return jsonError(400, "缺少 visibility");
    await setActivityVisibility(slug, visibility);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminActionError) return jsonError(error.status, error.message);
    return handleRouteError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const blocked = databaseRequired();
  if (blocked) return blocked;
  try {
    await requireAdmin();
    const { slug } = await params;
    await deleteActivity(slug);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AdminActionError) return jsonError(error.status, error.message);
    return handleRouteError(error);
  }
}
